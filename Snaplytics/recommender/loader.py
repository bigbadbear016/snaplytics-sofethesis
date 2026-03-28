# recommender/loader.py

"""
Loader + recommendation logic (final patched)

Behavior:
- Personalized: compute pkg_pred for candidate packages, select top-K packages by pkg_pred,
  then run greedy addon selection for each selected package and return those K package+addon sets.
- Popularity fallback: return top-K most popular packages (month-aware) with their top co-occurring addons.
- Defaults to top_k = 3 (can be overridden via CLI or function param).
"""
import os
import pickle
import argparse
import pandas as pd
import traceback
import math
from typing import Optional, Dict, List, Tuple

# -------------------------
# Config / Hyperparameters
# -------------------------
MODEL_PATH = "recommender/models/surprise_model.pkl"
PACKAGE_POP_PATH = "recommender/artifacts/month_package_popularity.csv"
ADDON_POP_PATH = "recommender/artifacts/month_addon_popularity.csv"
COOCC_PATH = "recommender/artifacts/month_package_addon_cooccurrence.csv"
MERGED_BOOKINGS_CSV = "recommender/data/merged_bookings.csv"

# Greedy selection hyperparameters (tune as needed)
MAX_ADDONS_PER_PACKAGE = 4
TOP_CANDIDATES_PER_PACKAGE = 12
MARGINAL_THRESHOLD = 0.01  # require positive marginal gain above this
SIZE_PENALTY_MULT = 0.25   # penalty per addon (simple linear penalty)


# -------------------------
# Model + artifact loaders
# -------------------------
def load_model(path: str = MODEL_PATH):
    if not os.path.exists(path):
        raise FileNotFoundError(f"Model file not found: {path}")
    with open(path, "rb") as f:
        return pickle.load(f)


def load_popularity_tables() -> Dict[str, pd.DataFrame]:
    """Load artifact CSVs if they exist. Returns dict with keys 'package','addon','cooccurrence'."""
    tables = {}
    if os.path.exists(PACKAGE_POP_PATH):
        tables['package'] = pd.read_csv(PACKAGE_POP_PATH)
    else:
        tables['package'] = pd.DataFrame(columns=['month','package_id','count'])
    if os.path.exists(ADDON_POP_PATH):
        tables['addon'] = pd.read_csv(ADDON_POP_PATH)
    else:
        tables['addon'] = pd.DataFrame(columns=['month','addon_id','count'])
    if os.path.exists(COOCC_PATH):
        tables['cooccurrence'] = pd.read_csv(COOCC_PATH)
    else:
        tables['cooccurrence'] = pd.DataFrame(columns=['month','package_id','addon_id','count'])
    return tables


# -------------------------
# Month inference
# -------------------------
def infer_user_month(user_id: int, bookings_csv: str = MERGED_BOOKINGS_CSV) -> Optional[str]:
    """
    Infer the user's latest booking month in YYYY-MM format from merged_bookings.csv.
    Returns None if file missing or user has no bookings.
    """
    if not os.path.exists(bookings_csv):
        print(f"[info] merged bookings CSV not found at {bookings_csv}; cannot infer user month.")
        return None
    try:
        df = pd.read_csv(bookings_csv, parse_dates=['session_date'], low_memory=False)
    except Exception as e:
        print(f"[warning] failed to read {bookings_csv}: {e}")
        return None
    user_col = 'customer_id' if 'customer_id' in df.columns else ('user_id' if 'user_id' in df.columns else None)
    if user_col is None:
        print("[warning] no user column found in merged bookings to infer month")
        return None
    user_rows = df[df[user_col].astype(str) == str(user_id)].copy()
    if user_rows.empty:
        return None
    user_rows['month'] = user_rows['session_date'].dt.to_period('M').astype(str)
    user_rows = user_rows.sort_values('session_date', ascending=False)
    return str(user_rows.iloc[0]['month'])


# -------------------------
# ID normalization helpers
# -------------------------
def _model_raw_user_type(algo):
    """Return the Python type used for raw user ids in the model trainset. Default str if unknown."""
    try:
        ts = algo.trainset
        raw = ts.to_raw_uid(0)
        return type(raw)
    except Exception:
        return str


def _model_raw_item_type(algo):
    """Return the Python type used for raw item ids in the model trainset. Default str if unknown."""
    try:
        ts = algo.trainset
        raw = ts.to_raw_iid(0)
        return type(raw)
    except Exception:
        return str


def normalize_raw_user_id(algo, raw_user):
    """
    Convert raw_user (int or str) to the type used by the model's trainset.
    If conversion fails, return raw_user as-is.
    """
    target_type = _model_raw_user_type(algo)
    if isinstance(raw_user, target_type):
        return raw_user
    try:
        if target_type is int:
            return int(raw_user)
        elif target_type is str:
            return str(raw_user)
        else:
            return target_type(raw_user)
    except Exception:
        return raw_user


def normalize_raw_item_id(algo, raw_item):
    """
    Convert raw_item to the model's raw item type. Keeps 'addon::X' intact when needed.
    """
    target_type = _model_raw_item_type(algo)
    if isinstance(raw_item, target_type):
        return raw_item
    try:
        if target_type is int:
            return int(raw_item)
        elif target_type is str:
            return str(raw_item)
        else:
            return target_type(raw_item)
    except Exception:
        return raw_item


# -------------------------
# Model-aware helpers
# -------------------------
def is_known_user(algo, raw_user_id) -> bool:
    """
    Robust check: normalize raw_user_id to model type and then test.
    """
    if algo is None:
        return False
    try:
        uid = normalize_raw_user_id(algo, raw_user_id)
        algo.trainset.to_inner_uid(uid)
        return True
    except Exception:
        try:
            alt = str(raw_user_id) if not isinstance(raw_user_id, str) else int(raw_user_id)
            alt = normalize_raw_user_id(algo, alt)
            algo.trainset.to_inner_uid(alt)
            return True
        except Exception:
            return False


def predict_est(algo, user_id, raw_item_id) -> Optional[float]:
    """Return estimated score or None if predict fails. raw_item_id is passed in the model's raw type or 'addon::X'."""
    try:
        u = normalize_raw_user_id(algo, user_id)
        i = normalize_raw_item_id(algo, raw_item_id)
        p = algo.predict(u, i)
        return float(p.est)
    except Exception:
        try:
            # try string fallback
            p = algo.predict(str(user_id), str(raw_item_id))
            return float(p.est)
        except Exception:
            return None


# -------------------------
# Helpers to build candidate pool per package
# -------------------------
def candidates_for_package(package_id: str,
                           addon_pop_df: pd.DataFrame,
                           coocc_df: pd.DataFrame,
                           top_m: int = TOP_CANDIDATES_PER_PACKAGE) -> List[str]:
    """
    Build a ranked candidate list of addon ids for a given package.
    Strategy:
     - top co-occurring addons for that package (if coocc available)
     - fallback to global/top addon_pop list
    Returns up to top_m addon ids as strings (deduped).
    """
    candidates = []
    pkg = str(package_id)
    if not coocc_df.empty and {'package_id', 'addon_id', 'count'}.issubset(coocc_df.columns):
        # pick top addons by cooccurrence with the package (most relevant)
        s = coocc_df[coocc_df['package_id'].astype(str) == pkg].sort_values('count', ascending=False)
        candidates.extend(s['addon_id'].astype(str).tolist())
    if not addon_pop_df.empty and 'addon_id' in addon_pop_df.columns:
        # add popular addons if not already present
        pop_list = addon_pop_df.sort_values('count', ascending=False)['addon_id'].astype(str).tolist()
        for a in pop_list:
            if a not in candidates:
                candidates.append(a)
    # dedupe preserving order
    seen = set()
    out = []
    for a in candidates:
        if a in seen:
            continue
        seen.add(a)
        out.append(a)
        if len(out) >= top_m:
            break
    return out


# -------------------------
# Subset scoring & greedy selection
# -------------------------
def pairwise_cooc(coocc_df: pd.DataFrame, a: str, b: str) -> float:
    """Return cooccurrence count (or 0) between addon a and b (either ordering)."""
    if coocc_df.empty or not {'addon_id', 'package_id', 'count'}.issubset(coocc_df.columns):
        # We may not have addon-addon coocc table; return 0
        return 0.0
    # coocc_df here is package-addon coocc; for addon-addon we try to find rows where package_id == a and addon_id == b
    # The original artifacts don't include addon-addon cooc, so default 0.
    return 0.0


def package_addon_cooc(coocc_df: pd.DataFrame, pkg: str, addon: str) -> float:
    """Return package-addon cooccurrence count for pkg and addon, or 0 if not found."""
    if coocc_df.empty or not {'package_id', 'addon_id', 'count'}.issubset(coocc_df.columns):
        return 0.0
    row = coocc_df[(coocc_df['package_id'].astype(str) == str(pkg)) & (coocc_df['addon_id'].astype(str) == str(addon))]
    if row.empty:
        return 0.0
    return float(row['count'].iloc[0])


# Helper for loyal package
def get_user_package_history_pct(user_id, package_id, bookings_csv=MERGED_BOOKINGS_CSV) -> float:
    """
    Returns the fraction of user's past bookings that included this package.
    e.g., 4 bookings, 4 are 'Delight' -> 1.0
    Returns 0.0 if no history.
    """
    if not os.path.exists(bookings_csv):
        return 0.0
    try:
        df = pd.read_csv(bookings_csv, parse_dates=['session_date'], low_memory=False)
        user_col = 'customer_id' if 'customer_id' in df.columns else ('user_id' if 'user_id' in df.columns else None)
        if user_col is None:
            return 0.0
        user_rows = df[df[user_col].astype(str) == str(user_id)]
        if user_rows.empty:
            return 0.0
        total_bookings = len(user_rows)
        package_count = (user_rows['package_id'].astype(str) == str(package_id)).sum()
        return package_count / total_bookings
    except Exception:
        return 0.0


def subset_score_for_user(algo,
                          user_id,
                          package_id,
                          addon_list: List[str],
                          coocc_df: pd.DataFrame,
                          alpha: float = 0.6,
                          hist_boost_mult: float = 1.0) -> float:
    """
    Simple scoring for a package + set(addons).
    score = alpha * pkg_pred + (1-alpha) * sum(addon_preds) + coocc bonuses - size penalty
    This is intentionally simple and fast; you can replace it with more sophisticated formulae.
    """
    pkg_pred = predict_est(algo, user_id, package_id)
    if pkg_pred is None:
        pkg_pred = 0.0
    addon_preds = [predict_est(algo, user_id, f"addon::{a}") or 0.0 for a in addon_list]
    sum_addon = sum(addon_preds)
    pkg_cooc_bonus = sum(package_addon_cooc(coocc_df, package_id, a) for a in addon_list)
    pair_bonus = 0.0
    size_penalty = SIZE_PENALTY_MULT * len(addon_list)

    base_score = alpha * pkg_pred + (1 - alpha) * sum_addon + 0.001 * pkg_cooc_bonus + pair_bonus - size_penalty

    # --- HISTORICAL PACKAGE BOOST ---
    hist_pct = get_user_package_history_pct(user_id, package_id)
    hist_boost = hist_boost_mult * hist_pct  # tune weight
    total_score = base_score + hist_boost

    return float(total_score)


def greedy_select_addons_for_package(algo,
                                     user_id,
                                     package_id,
                                     candidate_addons: List[str],
                                     coocc_df: pd.DataFrame,
                                     max_addons: int = MAX_ADDONS_PER_PACKAGE,
                                     marginal_threshold: float = MARGINAL_THRESHOLD,
                                     alpha: float = 0.6) -> Tuple[List[str], float]:
    """
    Greedy selection:
     - start with empty set
     - at each step, evaluate marginal gain of adding each remaining candidate
       (gain = new_subset_score - current_subset_score)
     - pick the addon with highest positive marginal gain > threshold
     - stop when no positive gain or max_addons reached
    Returns (selected_addon_list, final_score)
    """
    selected = []
    remaining = list(candidate_addons)
    current_score = subset_score_for_user(algo, user_id, package_id, selected, coocc_df, alpha=alpha)
    while remaining and len(selected) < max_addons:
        best_gain = -math.inf
        best_add = None
        best_score_after = current_score
        for a in remaining:
            score_after = subset_score_for_user(algo, user_id, package_id, selected + [a], coocc_df, alpha=alpha)
            gain = score_after - current_score
            if gain > best_gain:
                best_gain = gain
                best_add = a
                best_score_after = score_after
        if best_add is None:
            break
        if best_gain <= marginal_threshold:
            break
        # accept best_add
        selected.append(best_add)
        remaining.remove(best_add)
        current_score = best_score_after
    return selected, current_score


# -------------------------
# Month table preparation
# -------------------------
def prepare_month_tables(tables: Dict[str, pd.DataFrame], month: Optional[str]):
    """
    Return package_pop (for month), addon_pop (for month), coocc (for month).
    If month is None, returns aggregated/global tables (summing over months).
    """
    pkg = tables.get('package', pd.DataFrame())
    co = tables.get('cooccurrence', pd.DataFrame())
    addon = tables.get('addon', pd.DataFrame())

    if month is not None:
        if 'month' in pkg.columns:
            pkg_month = pkg[pkg['month'] == month].sort_values('count', ascending=False)
        else:
            pkg_month = pkg.sort_values('count', ascending=False)
        if 'month' in co.columns:
            co_month = co[co['month'] == month].sort_values('count', ascending=False)
        else:
            co_month = co.sort_values('count', ascending=False) if not co.empty else co
        if 'month' in addon.columns:
            addon_month = addon[addon['month'] == month].sort_values('count', ascending=False)
        else:
            addon_month = addon.sort_values('count', ascending=False) if not addon.empty else addon
        return pkg_month, addon_month, co_month
    else:
        if not pkg.empty and {'month', 'package_id', 'count'}.issubset(pkg.columns):
            pkg_agg = pkg.groupby('package_id', as_index=False)['count'].sum().sort_values('count', ascending=False)
            pkg_agg = pkg_agg[['package_id', 'count']]
        else:
            pkg_agg = pkg.copy()

        if not addon.empty and {'month', 'addon_id', 'count'}.issubset(addon.columns):
            addon_agg = addon.groupby('addon_id', as_index=False)['count'].sum().sort_values('count', ascending=False)
            addon_agg = addon_agg[['addon_id', 'count']]
        else:
            addon_agg = addon.copy()

        if not co.empty and {'month', 'package_id', 'addon_id', 'count'}.issubset(co.columns):
            co_agg = co.groupby(['package_id', 'addon_id'], as_index=False)['count'].sum()
        else:
            co_agg = co.copy()

        return pkg_agg, addon_agg, co_agg

def prepare_month_tables_with_fallback(tables: Dict[str, pd.DataFrame], month: Optional[str]):
    """
    Try to get tables for the given month.
    If no packages/addons exist for that month, fallback to previous month.
    If still empty, use aggregated/global tables.
    """
    def get_month_tables(m: str):
        pkg, addon, co = prepare_month_tables(tables, m)
        if pkg.empty and addon.empty:
            return None  # signal no data
        return pkg, addon, co

    if month is not None:
        tables_month = get_month_tables(month)
        if tables_month is not None:
            return tables_month

        # fallback to previous month
        try:
            prev_month = pd.Period(month, freq="M") - 1
            prev_month_str = str(prev_month)
            tables_prev_month = get_month_tables(prev_month_str)
            if tables_prev_month is not None:
                print(f"[info] No data for {month}, falling back to previous month {prev_month_str}")
                return tables_prev_month
        except Exception:
            pass  # if month string invalid, skip fallback

        print(f"[warning] No popularity data for month {month}, using aggregated/global tables")
        return prepare_month_tables(tables, None)
    else:
        return prepare_month_tables(tables, None)


# -------------------------
# Popularity fallback
# -------------------------
def _popularity_fallback(pkg_pop: pd.DataFrame, addon_pop: pd.DataFrame, coocc: pd.DataFrame, top_k: int = 3):
    """
    Build top_k recommendations using package popularity + package-addon cooccurrence.
    Returns {"user_id": None, "source":"popularity_fallback", "recommendations": [((pkg, [addons]), score), ...]}
    """
    results = []
    seen = set()

    if 'package_id' in pkg_pop.columns:
        pkg_iter = pkg_pop.sort_values('count', ascending=False).itertuples(index=False) 
    elif pkg_pop.shape[1] >= 2:
        pkg_iter = pkg_pop.iloc[:, :2].sort_values(by=pkg_pop.columns[1], ascending=False).itertuples(index=False)
    else:
        pkg_iter = iter([])

    for row in pkg_iter:
        if len(row) == 3:
            _, pkg, cnt = row
        else:
            pkg, cnt = row[0], row[1]

        # get top addons via cooccurrence or addon_pop
        top_adds = []
        if coocc is not None and not coocc.empty and {'package_id', 'addon_id', 'count'}.issubset(coocc.columns):
            s = coocc[coocc['package_id'].astype(str) == str(pkg)].sort_values('count', ascending=False).head(MAX_ADDONS_PER_PACKAGE)
            top_adds = s['addon_id'].astype(str).tolist()
        elif addon_pop is not None and not addon_pop.empty and 'addon_id' in addon_pop.columns:
            top_adds = addon_pop.head(MAX_ADDONS_PER_PACKAGE)['addon_id'].astype(str).tolist()

        pair_key = (str(pkg), tuple(top_adds))
        if pair_key in seen:
            continue
        seen.add(pair_key)
        # crude score: coocc sum or package count
        pair_score = int(cnt) if cnt is not None else 0
        results.append(((str(pkg), top_adds), float(pair_score)))
        if len(results) >= top_k:
            break

    return {"user_id": None, "source": "popularity_fallback", "recommendations": results[:top_k]}


# -------------------------
# Main recommendation flow
# -------------------------
def recommend_for_user(algo,
                       user_id,
                       popularity_tables,
                       month: Optional[str] = None,
                       alpha: float = 0.6,
                       top_k: int = 3):
    """
    Recommend package + addon sets for user.
    - If user unknown -> month/popularity fallback.
    - If known -> personalized greedy selection across top packages by pkg_pred (highest alpha term).
    Returns {"user_id": ..., "source": ..., "recommendations": [((package_id, [addons]), score), ...]}
    """
    pkg_pop, addon_pop, coocc = prepare_month_tables_with_fallback(popularity_tables, month)

    if 'package_id' in pkg_pop.columns:
        packages = pkg_pop['package_id'].astype(str).unique().tolist()
    else:
        packages = pkg_pop.iloc[:, 0].astype(str).unique().tolist() if not pkg_pop.empty else []

    if 'addon_id' in addon_pop.columns:
        addons_global = addon_pop['addon_id'].astype(str).unique().tolist()
    else:
        if not coocc.empty and 'addon_id' in coocc.columns:
            addons_global = coocc['addon_id'].astype(str).unique().tolist()
        else:
            addons_global = []

    if len(packages) == 0:
        print("[warning] no packages in candidate pool for month:", month)
    if len(addons_global) == 0:
        print("[warning] no addons in candidate pool for month:", month)

    if algo is None:
        print("[info] no model loaded -> using popularity fallback")
        return _popularity_fallback(pkg_pop, addon_pop, coocc, top_k)

    if not is_known_user(algo, user_id):
        print(f"[info] user {user_id} unknown to model -> using month-based popularity fallback (month={month})")
        return _popularity_fallback(pkg_pop, addon_pop, coocc, top_k)

    # -------------------------
    # Personalized flow (pick top-K packages by pkg_pred, then do greedy addon selection per package)
    # -------------------------
    pkg_scores = []
    max_packages_scored = 200
    packages_to_consider = packages[:max_packages_scored]

    # compute package prediction (pkg_pred) for every candidate package
    for p in packages_to_consider:
        pkg_pred = predict_est(algo, user_id, p) or 0.0

        # historical boost for dominant packages
        hist_pct = get_user_package_history_pct(user_id, p)
        pkg_pred += hist_pct  # simple additive boost

        # store tuple
        pkg_scores.append((str(p), float(pkg_pred)))

    # sort by pkg_pred descending and pick top_k packages
    pkg_scores.sort(key=lambda x: x[1], reverse=True)
    top_packages = [p for p, _ in pkg_scores[:top_k]]

    # ensure 100%-booked historical packages are included
    user_hist_top = [p for p in packages if get_user_package_history_pct(user_id, p) >= 0.5]
    for h in user_hist_top:
        if h not in top_packages:
            top_packages.append(h)

    personalized_results = []
    for p in top_packages:
        # build candidate addon pool for this package
        candidate_addons = candidates_for_package(p, addon_pop, coocc, top_m=TOP_CANDIDATES_PER_PACKAGE)
        if not candidate_addons:
            final_selected, final_score = [], subset_score_for_user(algo, user_id, p, [], coocc, alpha=alpha)
        else:
            final_selected, final_score = greedy_select_addons_for_package(
                algo, user_id, p, candidate_addons, coocc,
                max_addons=MAX_ADDONS_PER_PACKAGE,
                marginal_threshold=MARGINAL_THRESHOLD,
                alpha=alpha
            )
        # append ((package_id, [addons]), score)
        personalized_results.append(((str(p), final_selected), final_score))

    # sort by final score descending
    personalized_results.sort(key=lambda x: x[1], reverse=True)

    # limit to top_k results
    final_recs = personalized_results[:top_k]

    return {"user_id": user_id, "source": "personalized_by_pkg_pred", "recommendations": final_recs}



# -------------------------
# CLI
# -------------------------
def cli_main(user_id: int, month: Optional[str], top_k: int = 3, alpha: float = 0.6):
    print("[info] Starting loader CLI")
    algo = None
    try:
        if os.path.exists(MODEL_PATH):
            algo = load_model(MODEL_PATH)
            print("[info] loaded model from", MODEL_PATH, "type:", type(algo))
        else:
            print("[warning] model file not found at", MODEL_PATH, "- will use popularity fallback only")
    except Exception as e:
        print("[error] failed to load model:", e)
        traceback.print_exc()
        algo = None

    tables = load_popularity_tables()

    chosen_month = month
    if chosen_month is None:
        inferred = infer_user_month(user_id)
        if inferred is not None:
            chosen_month = inferred
            print(f"[info] inferred user {user_id} month -> {chosen_month}")
        else:
            pkg_table = tables.get('package', pd.DataFrame())
            if 'month' in pkg_table.columns and not pkg_table.empty:
                chosen_month = pkg_table['month'].max()
                print(f"[info] no user month found; using latest month from artifacts -> {chosen_month}")
            else:
                chosen_month = None
                print("[info] no month context available; using aggregated popularity")

    rec = recommend_for_user(
    algo,
    user_id,
    tables,
    month=chosen_month,
    alpha=alpha,
    top_k=top_k
    )

    # Always attach user_id
    rec['user_id'] = user_id

    # Only hide month_used for personalized CF
    if rec.get('source') == 'personalized_by_pkg_pred':
        rec.pop('month_used', None)

    print("RECOMMENDATION RESULT:")
    print(rec)
    return rec



if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--user", type=int, required=True, help="user_id to generate recs for")
    p.add_argument("--month", type=str, default=None, help="month context (YYYY-MM). If not provided, will infer from user's latest booking.")
    p.add_argument("--topk", type=int, default=3)  # default to 3
    p.add_argument("--alpha", type=float, default=0.6)
    args = p.parse_args()
    cli_main(user_id=args.user, month=args.month, top_k=args.topk, alpha=args.alpha)
