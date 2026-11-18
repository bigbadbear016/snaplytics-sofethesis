# backend/loyalty_utils.py
from __future__ import annotations

import math
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from backend.models import Booking, Customer, LoyaltySettings, Package


def get_loyalty_settings() -> LoyaltySettings:
    row, _ = LoyaltySettings.objects.get_or_create(
        pk=1,
        defaults={
            "pesos_per_point_earn": Decimal("100"),
            "pesos_per_point_redeem": Decimal("50"),
        },
    )
    return row


def _quantize_balance(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def earn_points_from_booking_total(
    total_peso: float | None,
    settings_row: LoyaltySettings | None = None,
) -> Decimal:
    settings_row = settings_row or get_loyalty_settings()
    rate = settings_row.pesos_per_point_earn or Decimal("100")
    if rate <= 0:
        rate = Decimal("100")
    if total_peso is None:
        return Decimal("0.0")
    try:
        t = Decimal(str(total_peso))
    except Exception:
        return Decimal("0.0")
    if t <= 0 or math.isnan(float(t)):
        return Decimal("0.0")
    earned = t / rate
    return _quantize_balance(earned)


def effective_package_price(pkg: Package) -> Decimal:
    """
    Same rule as kiosk/package cards: use promo only when it is a positive sale price.
    If promo is unset or 0, fall back to list price (promo_price=0 must not zero out claims).
    """
    promo = pkg.promo_price
    if promo is not None:
        try:
            p = Decimal(str(promo))
            if p > 0:
                return p
        except Exception:
            pass
    try:
        return Decimal(str(pkg.price or 0))
    except Exception:
        return Decimal("0")


def claim_points_for_package(
    pkg: Package,
    settings_row: LoyaltySettings | None = None,
) -> Decimal:
    settings_row = settings_row or get_loyalty_settings()
    rate = settings_row.pesos_per_point_redeem or Decimal("50")
    if rate <= 0:
        rate = Decimal("50")
    price = effective_package_price(pkg)
    if price <= 0:
        return Decimal("0.0")
    n = (price / rate).to_integral_value(rounding=ROUND_CEILING)
    return Decimal(n).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def cheapest_claim_cost(settings_row: LoyaltySettings | None = None) -> Decimal | None:
    """Fewest points that claim any active package; None when nothing is claimable."""
    settings_row = settings_row or get_loyalty_settings()
    costs = [
        claim_points_for_package(pkg, settings_row)
        for pkg in Package.objects.filter(deleted_at__isnull=True)
    ]
    return min((c for c in costs if c > 0), default=None)


def refund_loyalty_claim(booking_id: int) -> Decimal:
    """
    Give back the points a claimed booking spent (deny, delete, or cancel).
    Idempotent: returns the points refunded, 0 if nothing to refund.
    """
    with transaction.atomic():
        booking = Booking.objects.select_for_update().filter(pk=booking_id).first()
        if not booking or not booking.loyalty_claim or not booking.customer_id:
            return Decimal("0.0")
        pts = booking.loyalty_points_spent or Decimal("0")
        if pts <= 0:
            return Decimal("0.0")
        customer = Customer.objects.select_for_update().get(pk=booking.customer_id)
        customer.loyalty_points = _quantize_balance(
            (customer.loyalty_points or Decimal("0")) + pts
        )
        update = ["loyalty_points", "last_updated"]
        if customer.package_id == booking.package_id:
            customer.package_id = None  # claimed package no longer stands
            update.append("package_id")
        customer.last_updated = timezone.now()
        customer.save(update_fields=update)
        booking.loyalty_points_spent = Decimal("0.0")
        booking.save(update_fields=["loyalty_points_spent"])
        return pts


def maybe_credit_booking(booking_id: int) -> None:
    """
    Idempotent: credits customer's loyalty_points once when booking is BOOKED.
    """
    with transaction.atomic():
        booking = (
            Booking.objects.select_related("customer")
            .select_for_update()
            .filter(pk=booking_id)
            .first()
        )
        if not booking or not booking.customer_id:
            return
        if booking.session_status != "BOOKED":
            return
        if booking.loyalty_points_credited:
            return

        settings_row = get_loyalty_settings()
        pts = earn_points_from_booking_total(booking.total_price, settings_row)

        customer = Customer.objects.select_for_update().get(
            pk=booking.customer_id
        )
        new_bal = _quantize_balance(
            (customer.loyalty_points or Decimal("0")) + pts
        )
        customer.loyalty_points = new_bal
        customer.last_updated = timezone.now()
        customer.save(update_fields=["loyalty_points", "last_updated"])

        booking.loyalty_points_credited = True
        booking.save(update_fields=["loyalty_points_credited"])



def claimable_package_costs(
    settings_row: LoyaltySettings | None = None,
) -> list[tuple[Package, Decimal]]:
    """Every claimable package with its point cost, cheapest first.

    Uses the same rules as the claim endpoint: any package that isn't deleted
    and has a positive price.
    """
    settings_row = settings_row or get_loyalty_settings()
    rows = []
    for pkg in Package.objects.filter(deleted_at__isnull=True).defer("image_url"):
        cost = claim_points_for_package(pkg, settings_row)
        if cost > 0:
            rows.append((pkg, cost))
    rows.sort(key=lambda r: (r[1], r[0].name or ""))
    return rows


def eligible_customers(customer_ids=None) -> list[dict]:
    """Customers whose balance claims at least one package, most points first.

    Each row: customer, points, and the packages (with costs) they can claim
    right now. Pass customer_ids to re-check a specific set (e.g. before emailing).
    """
    costs = claimable_package_costs()
    if not costs:
        return []
    min_cost = costs[0][1]
    qs = Customer.objects.filter(
        deleted_at__isnull=True, loyalty_points__gte=min_cost
    ).only("customer_id", "full_name", "email", "loyalty_points")
    if customer_ids is not None:
        qs = qs.filter(pk__in=list(customer_ids))
    out = []
    for c in qs.order_by("-loyalty_points", "full_name"):
        pts = c.loyalty_points or Decimal("0")
        affordable = [(p, cost) for p, cost in costs if cost <= pts]
        if not affordable:
            continue
        out.append({"customer": c, "points": pts, "packages": affordable})
    return out


def _earn_at_rate(total_peso, rate: Decimal) -> Decimal:
    """Points one booking total earns at a given pesos-per-point rate."""
    row = LoyaltySettings(pesos_per_point_earn=rate)
    return earn_points_from_booking_total(total_peso, row)


def _candidate_earn_rates(*extra) -> set[Decimal]:
    """Every earn rate this studio has used: current, default, and the history in Action Logs."""
    from backend.models import ActionLog

    rates = {Decimal("100")}
    rates.update(Decimal(str(r)) for r in extra if r is not None)
    for meta in ActionLog.objects.filter(action_type="loyalty_settings_updated").values_list("metadata", flat=True):
        for key in ("previous_pesos_per_point_earn", "pesos_per_point_earn"):
            try:
                v = Decimal(str((meta or {}).get(key)))
            except Exception:
                continue
            if v > 0:
                rates.add(v)
    return {r for r in rates if r > 0}


def detect_balance_basis_rate(saved_rate=None) -> tuple[Decimal | None, int, int]:
    """Which earn rate the stored balances actually reflect.

    The saved setting is not proof: the rate may have been changed in the past
    without re-pricing anyone. For each rate this studio has used, count the
    customers whose balance equals (points their completed bookings earn at that
    rate) minus (points spent on claims); the rate that fits the most customers
    wins, ties going to the saved rate. Returns (rate, matching, customers_checked).
    """
    earned_rows: dict[int, list] = {}
    for cid, total in Booking.objects.filter(
        loyalty_points_credited=True, customer_id__isnull=False
    ).values_list("customer_id", "total_price"):
        earned_rows.setdefault(cid, []).append(total)
    if not earned_rows:
        return (Decimal(str(saved_rate)) if saved_rate else None), 0, 0
    spent: dict[int, Decimal] = {}
    for cid, sp in Booking.objects.filter(loyalty_claim=True, loyalty_points_spent__gt=0).values_list(
        "customer_id", "loyalty_points_spent"
    ):
        spent[cid] = spent.get(cid, Decimal("0")) + sp
    balances = dict(
        Customer.objects.filter(pk__in=list(earned_rows)).values_list("customer_id", "loyalty_points")
    )
    saved = Decimal(str(saved_rate)) if saved_rate else None

    def hits_at(rate: Decimal) -> int:
        n = 0
        for cid, totals in earned_rows.items():
            ledger = sum((_earn_at_rate(t, rate) for t in totals), Decimal("0")) - spent.get(cid, Decimal("0"))
            if abs((balances.get(cid) or Decimal("0")) - ledger) <= Decimal("0.1"):
                n += 1
        return n

    checked = len(earned_rows)
    saved_hits = hits_at(saved) if saved else 0
    best, best_hits = saved, saved_hits
    for rate in sorted(_candidate_earn_rates(saved) - {saved}):
        hits = hits_at(rate)
        # Only overrule the saved rate on a clear majority, never on a coincidence
        if hits > best_hits and hits * 2 > checked:
            best, best_hits = rate, hits
    return best, best_hits, checked


def recalculate_balances_for_earn_rate(
    saved_rate: Decimal, new_rate: Decimal, dry_run: bool = False, new_redeem_rate=None
) -> dict:
    """Re-price customers' points after the earn and/or claim rate changes.

    Earned points: balances are moved from the earn rate they actually reflect
    (detected, see detect_balance_basis_rate — not simply the saved setting) to
    new_rate; each customer changes by what their completed bookings earn at
    new_rate minus what they earn at that basis rate.

    Claimed packages (when new_redeem_rate is given): every claim that still holds
    points is re-priced at the new claim rate from its package's current price.
    The booking's points spent is updated and the customer gets back (or pays) the
    difference.

    Any other adjustment stays as it is, so this is safe to run repeatedly (a
    no-op once everything matches) — except where a balance would go below zero,
    which is floored at 0 and reported.

    Returns a summary: basis rate, claims re-priced, customers
    affected/increased/decreased/floored and a few before → after examples.
    With dry_run=True nothing is written.
    """
    new_rate = Decimal(str(new_rate))
    basis, basis_hits, checked = detect_balance_basis_rate(saved_rate)
    summary = {
        "affected": 0, "increased": 0, "decreased": 0, "floored": 0, "examples": [],
        "basis_rate": float(basis) if basis else None,
        "basis_matches": basis_hits,
        "customers_checked": checked,
        "claims_repriced": 0,
    }

    deltas: dict[int, Decimal] = {}
    if basis and basis > 0 and new_rate > 0 and basis != new_rate:
        for cid, total in Booking.objects.filter(
            loyalty_points_credited=True, customer_id__isnull=False
        ).values_list("customer_id", "total_price"):
            diff = _earn_at_rate(total, new_rate) - _earn_at_rate(total, basis)
            if diff:
                deltas[cid] = deltas.get(cid, Decimal("0")) + diff

    # Claims: re-price at the new claim rate (refunded claims hold 0 points: skipped)
    repriced_claims = []
    if new_redeem_rate is not None and Decimal(str(new_redeem_rate)) > 0:
        redeem_row = LoyaltySettings(pesos_per_point_redeem=Decimal(str(new_redeem_rate)))
        for b in Booking.objects.filter(
            loyalty_claim=True, loyalty_points_spent__gt=0, customer_id__isnull=False, package__isnull=False
        ).select_related("package").only("id", "customer_id", "loyalty_points_spent", "package"):
            new_cost = claim_points_for_package(b.package, redeem_row)
            if new_cost <= 0 or new_cost == b.loyalty_points_spent:
                continue
            # Cheaper claim → points back; dearer claim → more points taken
            deltas[b.customer_id] = deltas.get(b.customer_id, Decimal("0")) + (b.loyalty_points_spent - new_cost)
            b.loyalty_points_spent = new_cost
            repriced_claims.append(b)
    summary["claims_repriced"] = len(repriced_claims)

    deltas = {cid: d for cid, d in deltas.items() if d}
    if not deltas:
        if repriced_claims and not dry_run:
            Booking.objects.bulk_update(repriced_claims, ["loyalty_points_spent"], batch_size=500)
        return summary

    with transaction.atomic():
        qs = Customer.objects.filter(pk__in=list(deltas))
        if not dry_run:
            qs = qs.select_for_update()
        changed = []
        now = timezone.now()
        for c in qs.only("customer_id", "full_name", "loyalty_points", "deleted_at").order_by("-loyalty_points"):
            before = c.loyalty_points or Decimal("0")
            raw = before + deltas[c.customer_id]
            after = _quantize_balance(max(raw, Decimal("0")))
            if after == before:
                continue
            summary["affected"] += 1
            summary["increased" if after > before else "decreased"] += 1
            if raw < 0:
                summary["floored"] += 1
            if c.deleted_at is None and len(summary["examples"]) < 5:
                summary["examples"].append(
                    {"id": c.customer_id, "name": c.full_name or "", "before": float(before), "after": float(after)}
                )
            c.loyalty_points = after
            c.last_updated = now
            changed.append(c)
        if changed and not dry_run:
            Customer.objects.bulk_update(changed, ["loyalty_points", "last_updated"], batch_size=500)
        if repriced_claims and not dry_run:
            Booking.objects.bulk_update(repriced_claims, ["loyalty_points_spent"], batch_size=500)
    return summary
