"""Dashboard analytics and recommender model metrics."""

import csv
import math
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from backend.models import Booking, Customer
from django.conf import settings
from django.db.models import Count, Sum
from django.db.models.functions import Coalesce, TruncMonth
from recommender.service import get_recommendations
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ._common import (
    _build_model_metrics_response,
    _file_sha256,
    _get_request_sender_label,
    _get_request_user,
    _is_admin_or_owner_user,
    _is_staff_admin_or_owner_user,
    _write_action_log,
    ACCEPTED_BOOKING_STATUSES,
    logger,
)
from .recommendations import (
    _rebuild_recommender_exports_and_artifacts,
    build_recommendation_response,
)


@api_view(["GET"])
def dashboard_analytics(request):
    """
    GET /api/analytics/dashboard/

    Returns all chart data for the dashboard in one round-trip:

    {
      "risk_overview": {
          "very_unlikely": int,   # customers with low booking frequency, not renewed
          "unlikely":      int,   # low-ish frequency, renewed
          "likely":        int,   # moderate frequency, not renewed
          "very_likely":   int,   # high frequency, renewed
          "booking_rate":  float  # ratio of renewed customers / total with renewal records
      },
      "booking_trends": {
          "labels":   ["2024-10", "2024-11", ...],  # last 12 months YYYY-MM
          "bookings": [12, 8, ...],                  # total bookings per month
          "revenue":  [12500.0, 9800.0, ...]         # total revenue per month
      },
      "package_popularity": {
          "labels":   ["Jan 2025", "Feb 2025", ...],  # last 6 months
          "packages": ["Delight", "Ecstasy", ...],    # top-N package names
          "datasets": [                                # one per package
              {"label": "Delight", "data": [4, 6, 3, 5, 8, 7]},
              ...
          ]
      }
    }
    """
    request_user = _get_request_user(request)
    if not _is_staff_admin_or_owner_user(request_user):
        return Response(
            {"detail": "Only STAFF, ADMIN, or OWNER can access dashboard analytics."},
            status=status.HTTP_403_FORBIDDEN,
        )
    from backend.models import Renewal
    from django.utils import timezone
    from datetime import timedelta
    from dateutil.relativedelta import relativedelta
    import calendar

    # ── 1. RISK OVERVIEW ─────────────────────────────────────────────────────
    # Segment customers using Renewal records.
    # Axis A: renewed_within_366 (True/False)
    # Axis B: booking_frequency quartile (above/below median)
    # If no Renewal records yet, fall back to raw booking-count segmentation.

    renewal_qs = Renewal.objects.all()
    risk_data = {"very_unlikely": 0, "unlikely": 0, "likely": 0, "very_likely": 0, "booking_rate": 0.0}

    if renewal_qs.exists():
        # Compute median booking_frequency across all renewal records
        freqs = list(renewal_qs.values_list("booking_frequency", flat=True))
        freqs_sorted = sorted(f for f in freqs if f is not None)
        if freqs_sorted:
            mid = len(freqs_sorted) // 2
            median_freq = (
                (freqs_sorted[mid - 1] + freqs_sorted[mid]) / 2
                if len(freqs_sorted) % 2 == 0
                else freqs_sorted[mid]
            )
        else:
            median_freq = 1.0

        for r in renewal_qs:
            freq = r.booking_frequency or 0
            renewed = bool(r.renewed_within_366)
            high_freq = freq >= median_freq
            if not renewed and not high_freq:
                risk_data["very_unlikely"] += 1
            elif not renewed and high_freq:
                risk_data["unlikely"] += 1
            elif renewed and not high_freq:
                risk_data["likely"] += 1
            else:
                risk_data["very_likely"] += 1

        total_with_records = renewal_qs.count()
        renewed_count = renewal_qs.filter(renewed_within_366=True).count()
        risk_data["booking_rate"] = round(renewed_count / total_with_records, 2) if total_with_records else 0.0

    else:
        # Fallback: segment by raw booking count tiers (no Renewal table data)
        cust_booking_counts = (
            Customer.objects
            .annotate(bc=Count("bookings"))
            .values_list("bc", flat=True)
        )
        counts = sorted(cust_booking_counts)
        total = len(counts)
        if total:
            q1 = counts[total // 4]
            q3 = counts[(3 * total) // 4]
            for bc in counts:
                if bc <= q1:
                    risk_data["very_unlikely"] += 1
                elif bc <= q3:
                    risk_data["unlikely"] += 1
                else:
                    risk_data["likely"] += 1
            # very_likely = customers with bookings above q3 + repeat bookings
            risk_data["very_likely"] = max(0, risk_data["likely"] - total // 5)
            total_booked = sum(1 for bc in counts if bc > 0)
            risk_data["booking_rate"] = round(total_booked / total, 2) if total else 0.0

    # ── 2–3. BOOKING TRENDS + PACKAGE POPULARITY (optional date_from / date_to) ─
    from collections import defaultdict
    from django.utils.dateparse import parse_date

    now = timezone.now()
    twelve_months_ago = now - timedelta(days=365)
    six_months_ago = now - relativedelta(months=6)

    date_from_s = (request.query_params.get("date_from") or "").strip()
    date_to_s = (request.query_params.get("date_to") or "").strip()
    df = parse_date(date_from_s) if date_from_s else None
    dt = parse_date(date_to_s) if date_to_s else None
    use_custom_range = df is not None and dt is not None
    if use_custom_range and df > dt:
        df, dt = dt, df
    if use_custom_range and (dt - df).days > 730:
        return Response(
            {"detail": "date range cannot exceed 730 days"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if use_custom_range:
        trend_start = timezone.make_aware(datetime.combine(df, datetime.min.time()))
        trend_end = timezone.make_aware(datetime.combine(dt, datetime.max.time()))
        pop_filter_start = trend_start
        pop_filter_end = trend_end
    else:
        trend_start = twelve_months_ago
        trend_end = now
        pop_filter_start = six_months_ago
        pop_filter_end = now

    booking_base = Booking.objects.annotate(
        event_date=Coalesce("session_date", "created_at")
    ).filter(event_date__gte=trend_start, event_date__lte=trend_end)

    monthly_bookings = (
        booking_base.annotate(month=TruncMonth("event_date"))
        .values("month")
        .annotate(
            booking_count=Count("id"),
            revenue=Sum("total_price"),
        )
        .order_by("month")
    )

    month_map = {
        row["month"].strftime("%Y-%m"): row
        for row in monthly_bookings
        if row["month"]
    }

    trend_labels, trend_bookings, trend_revenue = [], [], []
    if use_custom_range:
        cur = df.replace(day=1)
        end_m = dt.replace(day=1)
        while cur <= end_m:
            key = cur.strftime("%Y-%m")
            trend_labels.append(cur.strftime("%b %Y"))
            row = month_map.get(key)
            trend_bookings.append(row["booking_count"] if row else 0)
            trend_revenue.append(round(row["revenue"] or 0, 2) if row else 0.0)
            cur = cur + relativedelta(months=1)
    else:
        for i in range(11, -1, -1):
            m = now - relativedelta(months=i)
            key = m.strftime("%Y-%m")
            trend_labels.append(m.strftime("%b %Y"))
            row = month_map.get(key)
            trend_bookings.append(row["booking_count"] if row else 0)
            trend_revenue.append(round(row["revenue"] or 0, 2) if row else 0.0)

    booking_trends = {
        "labels":   trend_labels,
        "bookings": trend_bookings,
        "revenue":  trend_revenue,
    }

    package_popularity = {"labels": [], "packages": [], "datasets": []}
    PALETTE = ["#165166", "#9BB5BC", "#4F9BB8", "#E8A838", "#6BA38A"]

    pkg_qs = (
        Booking.objects.annotate(event_date=Coalesce("session_date", "created_at"))
        .filter(
            event_date__gte=pop_filter_start,
            event_date__lte=pop_filter_end,
            package__isnull=False,
        )
    )
    pkg_monthly = (
        pkg_qs.annotate(month=TruncMonth("event_date"))
        .values("month", "package__id", "package__name")
        .annotate(count=Count("id"))
        .order_by("month", "-count")
    )

    pkg_totals = {}
    current_month_counts = {}
    current_month_key = now.strftime("%Y-%m")
    for row in pkg_monthly:
        pid = row["package__id"]
        if pid is None:
            continue
        pkg_totals[pid] = pkg_totals.get(pid, 0) + row["count"]
        if row["month"] and row["month"].strftime("%Y-%m") == current_month_key:
            current_month_counts[pid] = current_month_counts.get(pid, 0) + row["count"]

    top_pkg_ids = []
    for pid, _ in sorted(current_month_counts.items(), key=lambda kv: kv[1], reverse=True):
        if pid not in top_pkg_ids:
            top_pkg_ids.append(pid)
        if len(top_pkg_ids) >= 5:
            break
    for pid in sorted(pkg_totals, key=pkg_totals.get, reverse=True):
        if pid not in top_pkg_ids:
            top_pkg_ids.append(pid)
        if len(top_pkg_ids) >= 5:
            break

    if use_custom_range:
        recent_month_keys = []
        pop_labels = []
        cur = df.replace(day=1)
        end_m = dt.replace(day=1)
        while cur <= end_m:
            recent_month_keys.append(cur.strftime("%Y-%m"))
            pop_labels.append(cur.strftime("%b '%y"))
            cur = cur + relativedelta(months=1)
    else:
        recent_month_keys = [
            (now - relativedelta(months=i)).strftime("%Y-%m")
            for i in range(5, -1, -1)
        ]
        pop_labels = [
            datetime.strptime(mk, "%Y-%m").strftime("%b '%y")
            for mk in recent_month_keys
        ]

    month_pkg_counts = defaultdict(lambda: defaultdict(int))
    pkg_names = {}
    for row in pkg_monthly:
        if row["package__id"] in top_pkg_ids and row["month"]:
            mk = row["month"].strftime("%Y-%m")
            month_pkg_counts[mk][row["package__id"]] = row["count"]
            pkg_names[row["package__id"]] = row["package__name"]

    datasets = []
    for idx, pid in enumerate(top_pkg_ids):
        data_points = [
            month_pkg_counts[mk].get(pid, 0)
            for mk in recent_month_keys
        ]
        datasets.append(
            {
                "label": pkg_names.get(pid, f"Pkg #{pid}"),
                "data": data_points,
                "backgroundColor": PALETTE[idx % len(PALETTE)],
            }
        )

    package_popularity = {
        "labels": pop_labels,
        "packages": [pkg_names.get(pid, f"Pkg #{pid}") for pid in top_pkg_ids],
        "datasets": datasets,
    }

    applied_from = date_from_s if use_custom_range else twelve_months_ago.date().isoformat()
    applied_to = date_to_s if use_custom_range else now.date().isoformat()

    return Response({
        "risk_overview":       risk_data,
        "booking_trends":      booking_trends,
        "package_popularity":  package_popularity,
        "filters": {
            "date_from": applied_from,
            "date_to":   applied_to,
            "custom":    use_custom_range,
        },
    }, status=status.HTTP_200_OK)


def _parse_recommender_csv_value(value):
    if value is None:
        return value
    text = str(value).strip()
    if text == "":
        return text
    try:
        num = float(text)
        if num.is_integer() and ("." not in text):
            return int(num)
        return num
    except (TypeError, ValueError):
        return text


def _read_single_row_metrics(path_obj):
    if not path_obj.exists():
        return None
    with open(path_obj, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        row = next(reader, None)
        if not row:
            return None
        parsed = {}
        for k, v in row.items():
            try:
                parsed[k] = float(v)
            except (TypeError, ValueError):
                parsed[k] = v
        return parsed


def _mean_of_field(rows, field):
    vals = []
    for row in rows:
        try:
            vals.append(float(row.get(field, 0) or 0))
        except (TypeError, ValueError):
            continue
    return (sum(vals) / len(vals)) if vals else 0.0


def _std_of_field(rows, field):
    vals = []
    for row in rows:
        try:
            vals.append(float(row.get(field, 0) or 0))
        except (TypeError, ValueError):
            continue
    if not vals:
        return 0.0
    mean = sum(vals) / len(vals)
    variance = sum((x - mean) ** 2 for x in vals) / len(vals)
    return variance ** 0.5


def _read_recommender_summary(path_obj):
    if not path_obj.exists():
        return None

    rows = []
    with open(path_obj, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            parsed_row = {k: _parse_recommender_csv_value(v) for k, v in row.items()}
            rows.append(parsed_row)

    if not rows:
        return None

    columns = list(rows[0].keys())
    numeric_fields = []
    for col in columns:
        if all(isinstance(r.get(col), (int, float)) for r in rows if r.get(col) != ""):
            numeric_fields.append(col)

    user_count = len(rows)
    hit3_count = sum(
        1 for r in rows if str(r.get("hit@3", "0")).strip() in ("1", "1.0", "True", "true")
    )
    hit5_count = sum(
        1 for r in rows if str(r.get("hit@5", "0")).strip() in ("1", "1.0", "True", "true")
    )

    summary = {
        "rows_evaluated": user_count,
        "ndcg_at_3": _mean_of_field(rows, "ndcg@3"),
        "ndcg_at_5": _mean_of_field(rows, "ndcg@5"),
        "hit_rate_at_3": _mean_of_field(rows, "hit@3"),
        "hit_rate_at_5": _mean_of_field(rows, "hit@5"),
        "users_with_hit_at_3": hit3_count,
        "users_with_hit_at_5": hit5_count,
        "user_coverage_at_3": (hit3_count / user_count) if user_count else 0.0,
        "user_coverage_at_5": (hit5_count / user_count) if user_count else 0.0,
    }
    summary["ndcg_at_3_std"] = _std_of_field(rows, "ndcg@3")
    summary["ndcg_at_5_std"] = _std_of_field(rows, "ndcg@5")
    summary["hit_rate_at_3_percent"] = summary["hit_rate_at_3"] * 100.0
    summary["hit_rate_at_5_percent"] = summary["hit_rate_at_5"] * 100.0

    return {
        "summary": summary,
        "details": {
            "columns": columns,
            "numeric_fields": numeric_fields,
            "rows": rows,
        },
    }


def _build_live_recommender_summary():
    candidates = list(
        Customer.objects.annotate(booking_count=Count("bookings"))
        .filter(booking_count__gte=2)
        .only("customer_id")
    )
    if not candidates:
        return None

    ndcg3_vals, ndcg5_vals = [], []
    hit3_vals, hit5_vals = [], []

    for customer in candidates:
        recent_booking = (
            Booking.objects.filter(
                customer=customer,
                package__isnull=False,
                session_status__in=ACCEPTED_BOOKING_STATUSES,
            )
            .annotate(event_date=Coalesce("session_date", "created_at"))
            .order_by("-event_date", "-id")
            .first()
        )
        if not recent_booking or not recent_booking.package_id:
            continue

        recs = get_recommendations(customer.customer_id, datetime.now().date(), k=5)
        payload = build_recommendation_response(
            customer,
            recs,
            datetime.now().strftime("%Y-%m-%d"),
            k=5,
        )
        pkg_ids = [
            int(r["package"]["id"])
            for r in payload.get("recommendations", [])
            if r.get("package") and r["package"].get("id") is not None
        ]
        if not pkg_ids:
            continue

        target = int(recent_booking.package_id)

        def ndcg_at(k):
            top = pkg_ids[:k]
            if target not in top:
                return 0.0
            rank = top.index(target) + 1
            return 1.0 / math.log2(rank + 1)

        hit3 = 1.0 if target in pkg_ids[:3] else 0.0
        hit5 = 1.0 if target in pkg_ids[:5] else 0.0

        ndcg3_vals.append(ndcg_at(3))
        ndcg5_vals.append(ndcg_at(5))
        hit3_vals.append(hit3)
        hit5_vals.append(hit5)

    rows = len(hit5_vals)
    if rows == 0:
        return None

    users_with_hit3 = int(sum(hit3_vals))
    users_with_hit5 = int(sum(hit5_vals))
    return {
        "rows_evaluated": rows,
        "ndcg_at_3": float(sum(ndcg3_vals) / rows),
        "ndcg_at_5": float(sum(ndcg5_vals) / rows),
        "hit_rate_at_3": float(sum(hit3_vals) / rows),
        "hit_rate_at_5": float(sum(hit5_vals) / rows),
        "users_with_hit_at_3": users_with_hit3,
        "users_with_hit_at_5": users_with_hit5,
        "user_coverage_at_3": float(users_with_hit3 / rows),
        "user_coverage_at_5": float(users_with_hit5 / rows),
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dashboard_model_metrics(request):
    """
    GET /api/analytics/model-metrics/
    Returns evaluation artifacts for renewal and recommendation models.
    """
    request_user = _get_request_user(request)
    if not _is_staff_admin_or_owner_user(request_user):
        return Response(
            {"detail": "Only STAFF, ADMIN, or OWNER can access model metrics."},
            status=status.HTTP_403_FORBIDDEN,
        )
    base_dir = Path(settings.BASE_DIR)
    # Written by `manage.py train_renewal_xgboost`: fair time-separated test of
    # the live XGBoost model. There is no separate baseline model; the file
    # includes the always-no baseline accuracy.
    renewal_saved_path = base_dir / "renewal" / "outputs" / "renewal_xgboost_live_metrics.csv"
    renewal_engineered_path = renewal_saved_path
    recommender_path = base_dir / "recommender" / "results" / "evaluation_results.csv"
    allow_live_fallback = (
        str(request.query_params.get("live_fallback", "0")).strip().lower()
        in ("1", "true", "yes")
    )

    try:
        renewal_saved = _read_single_row_metrics(renewal_saved_path)
        renewal_engineered = None
        recommender_payload = _read_recommender_summary(recommender_path)
        recommender_summary = recommender_payload["summary"] if recommender_payload else None
        recommender_details = recommender_payload["details"] if recommender_payload else None
        if recommender_summary and allow_live_fallback:
            signal_sum = (
                float(recommender_summary.get("ndcg_at_3", 0) or 0)
                + float(recommender_summary.get("ndcg_at_5", 0) or 0)
                + float(recommender_summary.get("hit_rate_at_3", 0) or 0)
                + float(recommender_summary.get("hit_rate_at_5", 0) or 0)
            )
            if signal_sum == 0:
                try:
                    live_summary = _build_live_recommender_summary()
                except Exception as exc:
                    logger.warning(
                        "dashboard_model_metrics live recommender fallback failed: %s",
                        exc,
                    )
                    live_summary = None
                if live_summary:
                    recommender_summary = live_summary
                    recommender_details = None
    except Exception as exc:
        logger.exception("dashboard_model_metrics failed to load metrics")
        renewal_saved = None
        renewal_engineered = None
        recommender_summary = None
        recommender_details = None
        return Response(
            _build_model_metrics_response(
                base_dir,
                renewal_saved_path,
                renewal_engineered_path,
                recommender_path,
                renewal_saved,
                renewal_engineered,
                recommender_summary,
                recommender_details,
                error=exc,
            ),
            status=status.HTTP_200_OK,
        )

    return Response(
        _build_model_metrics_response(
            base_dir,
            renewal_saved_path,
            renewal_engineered_path,
            recommender_path,
            renewal_saved,
            renewal_engineered,
            recommender_summary,
            recommender_details,
        ),
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def recompute_recommendation_model_metrics(request):
    """
    POST /api/analytics/model-metrics/recompute-recommendation/
    Re-runs recommender evaluation and regenerates:
      recommender/results/evaluation_results.csv
    """
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"detail": "Only ADMIN or OWNER can recompute recommendation metrics."},
            status=status.HTTP_403_FORBIDDEN,
        )
    try:
        import surprise  # noqa: F401
    except ImportError:
        return Response(
            {
                "detail": (
                    "Optional recommender-model training is not installed. "
                    "Install Snaplytics/requirements-ml.txt to enable it."
                ),
                "optional_requirements": "Snaplytics/requirements-ml.txt",
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    base_dir = Path(settings.BASE_DIR)
    scripts = [
        base_dir / "recommender" / "data_builder.py",
        base_dir / "recommender" / "create_train_test_split.py",
        base_dir / "recommender" / "trainer.py",
        base_dir / "recommender" / "evaluate_model.py",
    ]
    output_path = base_dir / "recommender" / "results" / "evaluation_results.csv"

    missing = [str(p) for p in scripts if not p.exists()]
    if missing:
        return Response(
            {"detail": "One or more recommender scripts are missing.", "missing": missing},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    before_hash = _file_sha256(output_path)
    before_mtime = output_path.stat().st_mtime if output_path.exists() else None

    # First, rebuild popularity artifacts/exports from live DB.
    try:
        rebuild_payload = _rebuild_recommender_exports_and_artifacts()
    except Exception as exc:
        logger.exception(
            "recompute_recommendation_model_metrics: prerequisite rebuild failed"
        )
        return Response(
            {
                "detail": "Failed to rebuild recommendation data/artifacts before evaluation.",
                "rebuild_error": str(exc),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    pipeline_results = []
    try:
        for script_path in scripts:
            proc = subprocess.run(
                [sys.executable, str(script_path)],
                cwd=str(base_dir),
                capture_output=True,
                text=True,
                timeout=300,
            )
            stage = script_path.name
            pipeline_results.append(
                {
                    "stage": stage,
                    "returncode": proc.returncode,
                    "stdout_tail": proc.stdout[-1200:],
                    "stderr_tail": proc.stderr[-1200:],
                }
            )
            if proc.returncode != 0:
                logger.error(
                    "recompute_recommendation_model_metrics stage failed (%s): %s",
                    stage,
                    proc.stderr.strip() or proc.stdout.strip(),
                )
                return Response(
                    {
                        "detail": f"Recommendation pipeline failed at {stage}.",
                        "pipeline": pipeline_results,
                    },
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
    except subprocess.TimeoutExpired:
        return Response(
            {
                "detail": "Recommendation pipeline timed out.",
                "pipeline": pipeline_results,
            },
            status=status.HTTP_504_GATEWAY_TIMEOUT,
        )
    except Exception as exc:
        logger.exception("recompute_recommendation_model_metrics failed to start")
        return Response(
            {"detail": f"Failed to start evaluation: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    after_hash = _file_sha256(output_path)
    after_mtime = output_path.stat().st_mtime if output_path.exists() else None
    changed = bool(before_hash != after_hash or before_mtime != after_mtime)

    # Quick post-run sanity stats from regenerated CSV.
    rows = 0
    nonzero = {"ndcg@3": 0, "hit@3": 0, "ndcg@5": 0, "hit@5": 0}
    if output_path.exists():
        with open(output_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows += 1
                for k in nonzero.keys():
                    try:
                        if float(row.get(k, 0) or 0) != 0:
                            nonzero[k] += 1
                    except (TypeError, ValueError):
                        continue

    response_payload = {
            "status": "ok",
            "message": "Recommendation pipeline completed (data→split→train→evaluate).",
            "rebuild": rebuild_payload,
            "output_file": str(output_path.relative_to(base_dir)),
            "rows": rows,
            "nonzero_counts": nonzero,
            "changed": changed,
            "before_hash": before_hash,
            "after_hash": after_hash,
            "before_mtime": before_mtime,
            "after_mtime": after_mtime,
            "pipeline": pipeline_results,
    }
    _write_action_log(
        request,
        "recommendation_metrics_recomputed",
        f"{_get_request_sender_label(request)} recomputed recommendation model metrics",
        metadata={"rows": rows, "changed": changed},
    )
    return Response(response_payload, status=status.HTTP_200_OK)


# ═══════════════════════════════════════════════════════════════════════════════
