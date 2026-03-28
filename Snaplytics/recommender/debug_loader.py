# diagnose_model.py  (save under ml/recommender/)
import os, pickle, pandas as pd, traceback

MODEL = "recommender/models/surprise_model.pkl"
CSV = "recommender/data/surprise_ratings_with_neg.csv"
CSV2 = "recommender/data/surprise_ratings.csv"

def run():
    print("=== DIAGNOSE MODEL ===")
    print("cwd:", os.getcwd())
    print("model path:", MODEL, "exists:", os.path.exists(MODEL))
    print("ratings_with_neg exists:", os.path.exists(CSV))
    print("ratings exists:", os.path.exists(CSV2))
    print()

    if not os.path.exists(MODEL):
        print("[ERROR] model file missing:", MODEL)
    else:
        try:
            m = pickle.load(open(MODEL, "rb"))
            ts = getattr(m, "trainset", None)
            print("Loaded model type:", type(m))
            if ts is None:
                print("[WARN] Model has no trainset attribute.")
            else:
                print("trainset.n_users:", ts.n_users, "trainset.n_items:", ts.n_items)
                sample = list(range(min(30, ts.n_users)))
                raw_sample = [ts.to_raw_uid(i) for i in sample]
                print("sample known raw user ids (first 30):", raw_sample)
                # show types of raw uids
                print("sample raw uid types:", list({type(x).__name__ for x in raw_sample}))
        except Exception as e:
            print("[ERROR] failed to load model:", e)
            traceback.print_exc()

    print()
    if os.path.exists(CSV):
        try:
            df = pd.read_csv(CSV)
            print("CSV (with neg) rows:", len(df))
            print("CSV unique users (count):", df['user_id'].nunique())
            print("CSV sample users (first 30 as str):", df['user_id'].drop_duplicates().astype(str).head(30).tolist())
            print("CSV sample items (first 30):", df['item_id'].drop_duplicates().astype(str).head(30).tolist())
            print("CSV rating values (counts):")
            print(df['rating'].value_counts().to_dict())
        except Exception as e:
            print("[ERROR] failed reading CSV:", CSV, e)
            traceback.print_exc()
    else:
        print("[INFO] no augmented ratings CSV (surprise_ratings_with_neg.csv) found.")

    print()
    # compare intersection if both model and csv exist
    try:
        if os.path.exists(MODEL) and os.path.exists(CSV):
            m = pickle.load(open(MODEL, "rb"))
            ts = getattr(m, "trainset", None)
            if ts is not None:
                df = pd.read_csv(CSV)
                csv_u = set(map(str, df['user_id'].unique().tolist()))
                model_u = set([ts.to_raw_uid(i) for i in range(ts.n_users)])
                inter = csv_u & model_u
                print("CSV unique users:", len(csv_u), "Model users:", ts.n_users, "Intersection size:", len(inter))
                print("Example intersection (up to 20):", list(inter)[:20])
            else:
                print("[INFO] model has no trainset; cannot compute intersection.")
    except Exception as e:
        print("[ERROR] during intersection check:", e)
        traceback.print_exc()

    print("=== END DIAGNOSE ===")

if __name__ == '__main__':
    run()
