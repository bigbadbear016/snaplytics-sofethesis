"""Customer and popular recommendations, renewal prediction, and recommender rebuilds."""

from datetime import datetime

from backend.models import Addon, Booking, BookingAddon, Customer, Package
from backend.renewal_utils import (
    ACCEPTED_BOOKING_STATUSES as RENEWAL_BOOKING_STATUSES,
    recompute_customer_renewal_profile,
)
from django.db.models import Avg, Count, Q, Sum
from django.shortcuts import get_object_or_404
from recommender.explanations import build_explanation, CardEvidence
from recommender.service import get_recommendations
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from ._common import (
    _get_request_sender_label,
    _get_request_user,
    _is_admin_or_owner_user,
    _now_iso,
    _write_action_log,
    ACCEPTED_BOOKING_STATUSES,
    logger,
)
from ..serializers import AddonSerializer, PackageSerializer


# RECOMMENDATIONS  (unchanged — already correct architecture)
# ═══════════════════════════════════════════════════════════════════════════════


def get_global_popular_packages(k=3):
    popular = (
        Package.objects.annotate(
            booking_count=Count(
                "booking",
                filter=Q(booking__session_status__in=ACCEPTED_BOOKING_STATUSES),
            )
        )
        .filter(booking_count__gt=0, deleted_at__isnull=True, is_archived=False)
        .order_by("-booking_count")[:k]
    )
    if not popular.exists():
        popular = Package.objects.filter(deleted_at__isnull=True, is_archived=False)[:k]
    return list(popular)


def get_popular_addons_for_package(package_id, top_m=3):
    addon_stats = (
        BookingAddon.objects.filter(
            booking__package_id=package_id,
            booking__session_status__in=ACCEPTED_BOOKING_STATUSES,
        )
        .values("addon_id")
        .annotate(
            total_quantity=Sum("addon_quantity"),
            booking_count=Count("booking_id"),
        )
        .order_by("-total_quantity")[:top_m]
    )
    addon_ids = [s["addon_id"] for s in addon_stats]
    return Addon.objects.filter(id__in=addon_ids, deleted_at__isnull=True)


def build_recommendation_response(customer, recommendations, target_date, k=3):
    total_bookings = Booking.objects.filter(
        customer=customer, session_status__in=ACCEPTED_BOOKING_STATUSES
    ).count()
    result = []
    for rec in recommendations[:k]:
        try:
            package_id = int(float(rec.get("package_id")))
        except (TypeError, ValueError, Package.DoesNotExist):
            continue  # skip invalid recommendations
        addon_ids = rec.get("addon_ids", [])
        try:
            package = Package.objects.filter(
                id=package_id, deleted_at__isnull=True, is_archived=False
            ).first()
            if package is None:
                raise Package.DoesNotExist
            package_data = PackageSerializer(package).data
            if addon_ids:
                addons_qs = Addon.objects.filter(
                    id__in=addon_ids, deleted_at__isnull=True
                )
                addons_list = AddonSerializer(addons_qs, many=True).data
            else:
                addons_list = AddonSerializer(
                    get_popular_addons_for_package(package_id, top_m=2), many=True
                ).data
            base_price = package.promo_price or package.price
            total_price = base_price + sum(a["price"] for a in addons_list)
            result.append(
                {
                    "package": package_data,
                    "addons": addons_list,
                    "base_price": base_price,
                    "total_price": total_price,
                    "score": rec.get("score", 0),
                    "source": rec.get("source", "unknown"),
                    **generate_recommendation_explanation(
                        rec,
                        package_data,
                        addons_list,
                        total_bookings,
                    ),
                }
            )
        except Package.DoesNotExist:
            logger.warning(f"Package {package_id} not found")
            continue

    # fill remaining slots with popular packages
    if len(result) < k:
        for package in get_global_popular_packages(k - len(result)):
            if any(r["package"]["id"] == package.id for r in result):
                continue
            package_data = PackageSerializer(package).data
            addons_list = AddonSerializer(
                get_popular_addons_for_package(package.id, top_m=2), many=True
            ).data
            base_price = package.promo_price or package.price
            total_price = base_price + sum(a["price"] for a in addons_list)
            result.append(
                {
                    "package": package_data,
                    "addons": addons_list,
                    "base_price": base_price,
                    "total_price": total_price,
                    "score": 0,
                    "source": "popular_fallback",
                    **generate_recommendation_explanation(
                        {
                            "score": 0,
                            "source": "popular_fallback",
                        },
                        package_data,
                        addons_list,
                        total_bookings,
                    ),
                }
            )

    return {
        "customer_id": customer.customer_id,
        "customer_name": customer.full_name or "Customer",
        "customer_email": customer.email or "",
        "target_date": target_date,
        "total_bookings": total_bookings,
        "recommendations": result,
        "key_factors": generate_key_factors(customer, result),
    }


def generate_recommendation_explanation(
    recommendation, package_data, addons, total_bookings
):
    """Adapt database response data into deterministic explanation evidence."""
    package_name = (
        package_data.get("name")
        or package_data.get("package_name")
        or f"Package {package_data.get('id', '')}"
    )
    category = package_data.get("category") or package_data.get("category_name")
    if isinstance(category, dict):
        category = category.get("name")
    score = recommendation.get("score", 0)
    try:
        numeric_score = float(score)
    except (TypeError, ValueError):
        numeric_score = 0.0
    try:
        package_id = int(package_data.get("id", 0))
    except (TypeError, ValueError):
        package_id = 0
    try:
        base_price = float(package_data.get("promo_price") or package_data.get("price") or 0)
        regular_price = float(package_data.get("price") or 0)
    except (TypeError, ValueError):
        base_price = regular_price = 0.0
    total_price = base_price + sum(float(addon.get("price") or 0) for addon in addons)
    return build_explanation(
        CardEvidence(
            source=recommendation.get("source", "unknown"),
            package_id=package_id,
            package_name=package_name,
            package_category=category,
            score=numeric_score,
            total_bookings=total_bookings,
            addon_names=[
                addon.get("name") or addon.get("addon_name") or "selected add-on"
                for addon in addons
            ],
            base_price=base_price,
            total_price=total_price,
            promo_active=bool(regular_price and base_price < regular_price),
        )
    )


def generate_key_factors(customer, recommendations):
    factors = []
    total_bookings = Booking.objects.filter(
        customer=customer, session_status__in=ACCEPTED_BOOKING_STATUSES
    ).count()
    if total_bookings == 0:
        factors.append("First-time customer - showing popular packages")
        factors.append("Recommendations based on overall booking trends")
    else:
        factors.append(f"Based on {total_bookings} previous booking(s)")
        preferred = (
            Booking.objects.filter(
                customer=customer, session_status__in=ACCEPTED_BOOKING_STATUSES
            )
            .values("package__category")
            .annotate(count=Count("id"))
            .order_by("-count")
            .first()
        )
        if preferred and preferred["package__category"]:
            factors.append(f"Preference for {preferred['package__category']} packages")
    sources = [r.get("source", "") for r in recommendations]
    if "customer_booking_history" in sources:
        factors.append("Package loyalty from this customer's booking history")
    elif "loader" in sources or "collaborative_filtering" in sources:
        factors.append("Collaborative filtering based on similar customers")
    elif "popular_package_monthly" in sources:
        factors.append("Seasonal popularity trends considered")
    if any(len(r.get("addons", [])) > 0 for r in recommendations):
        factors.append("Add-ons selected based on popular combinations")
    return factors[:5]


@api_view(["GET"])
@permission_classes([AllowAny])
def customer_recommendations(request, customer_id):
    try:
        customer = get_object_or_404(
            Customer.objects.filter(deleted_at__isnull=True),
            customer_id=customer_id,
        )
        target_date_str = request.GET.get("date")
        k = int(request.GET.get("k", 3))
        if target_date_str:
            for fmt in ("%Y-%m-%d", "%Y-%m"):
                try:
                    target_date = datetime.strptime(target_date_str, fmt).date()
                    break
                except ValueError:
                    continue
            else:
                return Response(
                    {"detail": "Invalid date format. Use YYYY-MM-DD or YYYY-MM"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            target_date = datetime.now().date()
        recommendations = get_recommendations(customer_id, target_date, k)
        response_data = build_recommendation_response(
            customer, recommendations, target_date.strftime("%Y-%m-%d"), k
        )
        logger.info(
            f"Returning {len(response_data['recommendations'])} "
            f"recommendations for customer {customer_id}"
        )
        return Response(response_data, status=status.HTTP_200_OK)
    except Exception as e:
        logger.exception(f"Error in recommendations for {customer_id}")
        return Response(
            {"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(["GET"])
def customer_renewal_prediction(request, customer_id):
    customer = get_object_or_404(
        Customer.objects.filter(deleted_at__isnull=True),
        customer_id=customer_id,
    )
    bookings_qs = Booking.objects.filter(
        customer=customer, session_status__in=RENEWAL_BOOKING_STATUSES
    )
    renewal = recompute_customer_renewal_profile(customer)

    avg_booking_value = float(
        bookings_qs.aggregate(v=Avg("total_price")).get("v") or 0.0
    )
    total_spent = float(
        bookings_qs.aggregate(v=Sum("total_price")).get("v") or 0.0
    )

    total_bookings = int(renewal.total_bookings or 0)
    booking_frequency = float(renewal.booking_frequency or 0.0)
    preferred_package_type = (
        str(renewal.preferred_package_type).strip()
        if renewal.preferred_package_type is not None
        else ""
    )

    # Explicit no-booking guardrail: no history => 0% renewal probability.
    if total_bookings == 0:
        probability = 0.0
    else:
        base_prob = 0.05
        base_prob += min(booking_frequency / 8.0, 0.4)
        base_prob += min(total_bookings / 10.0, 0.25)
        base_prob += min((avg_booking_value or 0.0) / 15000.0, 0.15)
        if renewal.renewed_within_366:
            base_prob += 0.15
        probability = max(0.0, min(base_prob, 0.99))

    if probability >= 0.7:
        band = "very_likely"
        status_text = "Very likely to renew"
    elif probability >= 0.5:
        band = "likely"
        status_text = "Likely to renew"
    elif probability >= 0.3:
        band = "unlikely"
        status_text = "Needs follow-up"
    else:
        band = "very_unlikely"
        status_text = "At risk of not renewing"

    preferred = (
        bookings_qs.values("package__category")
        .annotate(count=Count("id"))
        .order_by("-count")
        .first()
    )
    factors = []
    if total_bookings > 0:
        factors.append(f"{total_bookings} completed booking(s)")
    else:
        factors.append("No booking history yet")
    if preferred and preferred.get("package__category"):
        factors.append(f"Prefers {preferred['package__category']} package category")
    if avg_booking_value > 0:
        factors.append(f"Average booking value: ₱{avg_booking_value:,.2f}")
    factors.append("Renewal profile rebuilt from live booking records")

    if not preferred_package_type and preferred and preferred.get("package__category"):
        preferred_package_type = str(preferred["package__category"]).strip()

    return Response(
        {
            "customer_id": customer.customer_id,
            "customer_name": customer.full_name or "Customer",
            "renewal_probability": round(probability, 4),
            "predicted_renewal": probability >= 0.5,
            "renewal_band": band,
            "status_text": status_text,
            "total_bookings": total_bookings,
            "booking_frequency": round(booking_frequency, 2),
            "preferred_package_type": preferred_package_type or "N/A",
            "avg_booking_value": round(avg_booking_value, 2),
            "total_spent": round(total_spent, 2),
            "key_factors": factors[:5],
            "generated_at": _now_iso(),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def popular_recommendations(request):
    """
    GET /api/recommendations/popular/?k=3

    Returns top-K globally popular package+addon combos based on real booking
    history. Uses the same response shape as customer_recommendations so the
    frontend can use one unified card renderer.

    Response:
    {
      "recommendations": [
        {
          "package":     { ...PackageSerializer fields... },
          "addons":      [ { ...AddonSerializer fields... }, ... ],
          "base_price":  float,
          "total_price": float,
          "score":       int,          # booking_count for this package
          "source":      "popularity"
        },
        ...
      ],
      "count": 3,
      "generated_at": "2025-..."
    }
    """
    k = int(request.GET.get("k", 3))

    popular_pkgs = get_global_popular_packages(k)

    result = []
    for pkg in popular_pkgs:
        try:
            package_data = PackageSerializer(pkg).data
            addons_qs    = get_popular_addons_for_package(pkg.id, top_m=4)
            addons_list  = AddonSerializer(addons_qs, many=True).data
            base_price   = float(pkg.promo_price or pkg.price or 0)
            addon_total  = sum(float(a.get("price") or 0) for a in addons_list)
            booking_count = getattr(pkg, "booking_count", 0)
            result.append({
                "package":     package_data,
                "addons":      addons_list,
                "base_price":  base_price,
                "total_price": round(base_price + addon_total, 2),
                "score":       int(booking_count),
                "source":      "popularity",
                **generate_recommendation_explanation(
                    {
                        "score": int(booking_count),
                        "source": "popularity",
                    },
                    package_data,
                    addons_list,
                    0,
                ),
            })
        except Exception as e:
            logger.warning(f"popular_recommendations: skipping pkg {pkg.id}: {e}")
            continue

    return Response({
        "recommendations": result,
        "count":           len(result),
        "generated_at":    _now_iso(),
    }, status=status.HTTP_200_OK)


def _rebuild_recommender_exports_and_artifacts():
    """
    Internal helper used by both:
      - POST /api/recommendations/rebuild/
      - POST /api/analytics/model-metrics/recompute-recommendation/
    """
    import os, csv
    from django.db.models import F
    from recommender.popularity_builder import build_monthly_popularity
    import recommender.service as svc

    BOOKINGS_CSV      = "recommender/data/merged_bookings.csv"
    BOOKING_ADDONS_CSV = "recommender/data/booking_addons.csv"
    ARTIFACTS_DIR      = "recommender/artifacts"

    os.makedirs("recommender/data", exist_ok=True)
    os.makedirs(ARTIFACTS_DIR,      exist_ok=True)

    # ── 1. Export bookings from DB → CSV ────────────────────────────────────
    # "customer_id" clashes with Django's auto FK column on Booking.customer,
    # so we alias it as "cust_pk" and remap when writing the CSV row.
    bookings_qs = (
        Booking.objects.filter(session_status__in=ACCEPTED_BOOKING_STATUSES)
        .select_related("customer", "package")
        .values(
            booking_id = F("id"),
            cust_pk    = F("customer__customer_id"),   # alias avoids clash
            pkg_id     = F("package__id"),
            s_date     = F("session_date"),
            s_status   = F("session_status"),
        )
    )
    with open(BOOKINGS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "booking_id", "customer_id", "package_id",
            "session_date", "session_status",
        ])
        writer.writeheader()
        for row in bookings_qs:
            writer.writerow({
                "booking_id":     row["booking_id"],
                "customer_id":    row["cust_pk"],           # remap → CSV column
                "package_id":     row["pkg_id"],
                "session_date":   str(row["s_date"]) if row["s_date"] else None,
                "session_status": row["s_status"] or "",
            })

    # ── 2. Export booking_addons from DB → CSV ───────────────────────────────
    # booking_id and addon_id would clash with Django's auto FK columns on
    # BookingAddon.booking and BookingAddon.addon, so we read them directly
    # via select_related and build plain dicts instead.
    ba_rows = (
        BookingAddon.objects
        .select_related("booking", "addon")
        .only("booking_id", "addon_id", "addon_quantity")
    )
    with open(BOOKING_ADDONS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["booking_id", "addon_id", "addon_quantity"])
        writer.writeheader()
        for ba in ba_rows:
            writer.writerow({
                "booking_id":     ba.booking_id,
                "addon_id":       ba.addon_id,
                "addon_quantity":  ba.addon_quantity or 0,
            })

    # ── 3. Rebuild popularity artifact CSVs ─────────────────────────────────
    # Validate the CSV we just wrote parses cleanly before passing to builder.
    # Rows with no session_date are dropped because popularity is month-keyed.
    import pandas as _pd
    _bk = _pd.read_csv(BOOKINGS_CSV, low_memory=False)
    _bk["session_date"] = _pd.to_datetime(_bk["session_date"], errors="coerce")
    _bk = _bk.dropna(subset=["session_date"])
    _bk.to_csv(BOOKINGS_CSV, index=False)   # overwrite with clean version
    del _bk, _pd

    build_monthly_popularity(BOOKINGS_CSV, BOOKING_ADDONS_CSV, ARTIFACTS_DIR)

    # ── 4. Bust in-memory service caches ─────────────────────────────────────
    svc._popular_packages_cache = None
    svc._popular_combos_cache   = None
    svc._addon_counts_cache      = None

    return {
        "status":              "ok",
        "message":             "Popularity artifacts rebuilt and caches cleared.",
        "bookings_exported":   bookings_qs.count(),
        "customers_exported":  Customer.objects.count(),
    }


@api_view(["POST"])
def rebuild_popularity(request):
    """
    POST /api/recommendations/rebuild/
    """
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"detail": "Only ADMIN or OWNER can rebuild recommendation artifacts."},
            status=status.HTTP_403_FORBIDDEN,
        )
    try:
        payload = _rebuild_recommender_exports_and_artifacts()
    except Exception as e:
        logger.exception("rebuild_popularity failed")
        return Response(
            {"detail": f"Artifact rebuild failed: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    _write_action_log(
        request,
        "recommendation_rebuild",
        f"{_get_request_sender_label(request)} rebuilt recommendation popularity artifacts",
        metadata={"status": payload.get("status"), "bookings_exported": payload.get("bookings_exported")},
    )
    return Response(payload, status=status.HTTP_200_OK)
