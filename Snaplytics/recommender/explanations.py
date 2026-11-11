"""Deterministic, per-source explanation templates for recommendation cards."""

from dataclasses import dataclass, field
from typing import List, Optional

THIN_EVIDENCE_MAX = 2
KIOSK_MAX_CHARS = 120


@dataclass
class CardEvidence:
    source: str
    package_id: int
    package_name: str
    package_category: Optional[str] = None
    score: float = 0.0
    total_bookings: int = 0
    addon_names: List[str] = field(default_factory=list)
    base_price: float = 0.0
    total_price: float = 0.0
    promo_active: bool = False


def _pick(variants, package_id):
    return variants[package_id % len(variants)]


def _join(names):
    names = list(names)
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def _peso(value):
    return f"\u20b1{value:,.0f}"


def _trim(text, limit=KIOSK_MAX_CHARS):
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "\u2026"


def _addon_sentence(evidence, history_based):
    if not evidence.addon_names:
        return ""
    names = _join(evidence.addon_names)
    if history_based:
        return f" We added {names}, the add-ons you picked most often with it."
    return f" Popular add-ons with it: {names}."


def _price_sentence(evidence):
    if not evidence.total_price:
        return ""
    sentence = f" Total: {_peso(evidence.total_price)}"
    if (
        evidence.addon_names
        and evidence.base_price
        and evidence.total_price != evidence.base_price
    ):
        sentence += f" ({_peso(evidence.base_price)} package + add-ons)"
    sentence += "."
    if evidence.promo_active:
        sentence += " Promo price applied."
    return sentence


def _history(evidence):
    package_bookings = (
        round(evidence.score * evidence.total_bookings)
        if evidence.total_bookings
        else 0
    )
    thin = evidence.total_bookings <= THIN_EVIDENCE_MAX
    kiosk_variants = (
        f"{evidence.package_name} is a favorite of yours.",
        f"You've chosen {evidence.package_name} before.",
        f"Welcome back: {evidence.package_name} fits your past bookings.",
    )
    kiosk = (
        f"Based on your last booking: {evidence.package_name}."
        if thin
        else _pick(kiosk_variants, evidence.package_id)
    )
    if thin:
        detail = (
            f"{evidence.package_name} is suggested from limited history: "
            f"{package_bookings} of {evidence.total_bookings} accepted booking(s). "
            "Treat this as a weak signal."
        )
    else:
        detail = (
            f"{evidence.package_name} is this customer's most-booked package: "
            f"{package_bookings} of {evidence.total_bookings} accepted bookings "
            f"({evidence.score:.0%})."
        )
    detail += _addon_sentence(evidence, history_based=True)
    detail += _price_sentence(evidence)
    factors = [
        {"type": "history_share", "value": round(evidence.score, 4)},
        {"type": "package_bookings", "value": package_bookings},
        {"type": "total_bookings", "value": evidence.total_bookings},
        {"type": "thin_evidence", "value": thin},
    ]
    return kiosk, detail, factors


def _popularity(evidence):
    kiosk = _pick(
        (
            f"{evidence.package_name} is one of our most booked packages.",
            f"Popular choice: {evidence.package_name}.",
        ),
        evidence.package_id,
    )
    booking_count = int(evidence.score)
    detail = (
        f"{evidence.package_name} ranks among the top packages by accepted "
        f"bookings across all customers ({booking_count} bookings)."
    )
    detail += _addon_sentence(evidence, history_based=False)
    detail += _price_sentence(evidence)
    return kiosk, detail, [{"type": "popularity_count", "value": booking_count}]


def _popular_fallback(evidence):
    kiosk = "A popular pick to get you started."
    detail = (
        "This customer has no (or too little) accepted booking history, so "
        f"{evidence.package_name} was filled in from global popularity."
    )
    detail += _addon_sentence(evidence, history_based=False)
    detail += _price_sentence(evidence)
    factors = [
        {"type": "fallback", "value": True},
        {"type": "popularity_count", "value": int(evidence.score)},
    ]
    return kiosk, detail, factors


def _generic(evidence):
    kiosk = f"{evidence.package_name} is suggested based on booking data."
    detail = (
        f"{evidence.package_name} was selected from booking data "
        f"(source: {evidence.source})."
    )
    detail += _addon_sentence(evidence, history_based=False)
    detail += _price_sentence(evidence)
    return kiosk, detail, [{"type": "source", "value": evidence.source}]


_BUILDERS = {
    "customer_booking_history": _history,
    "popularity": _popularity,
    "popular_fallback": _popular_fallback,
    "popularity_fallback": _popular_fallback,
}

SOURCE_LABELS = {
    "customer_booking_history": "Booking Loyalty",
    "popularity": "Popular Choice",
    "popular_fallback": "Popular Choice",
    "popularity_fallback": "Popular Choice",
}


def build_explanation(evidence: CardEvidence) -> dict:
    kiosk, detail, factors = _BUILDERS.get(evidence.source, _generic)(evidence)
    return {
        "explanation": _trim(kiosk),
        "explanation_detail": detail,
        "explanation_factors": factors,
        "source_label": SOURCE_LABELS.get(evidence.source, "Suggested"),
    }
