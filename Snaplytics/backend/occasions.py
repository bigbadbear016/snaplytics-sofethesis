"""
Occasion type for categories and packages (Graduation, Christmas, ...).

The renewal model learns from these fixed types instead of package names, so a new
"Christmas Package 2027" behaves like past Christmas packages from day one.

On save, a keyword guess fills the type immediately (never blank). After the save
commits, Groq refines the guess in a background thread. A type picked by staff is
locked (occasion_locked) and never overwritten.
"""
import logging
import re
import threading

from django.db import transaction

from .groq_client import GroqUnavailable, chat_json

logger = logging.getLogger(__name__)

# key -> label. "general" means no specific occasion (e.g. price-tier packages).
# Adding a type: also add it to LABELS in electron-app/scripts/api-client.js, run
# makemigrations + migrate, then train_renewal_xgboost right away: the model's inputs
# come from this list, so the old model stops loading until it is retrained.
OCCASIONS = {
    "graduation": "Graduation",
    "christmas": "Christmas / holiday",
    "valentines": "Valentine's",
    "birthday": "Birthday",
    "family": "Family",
    "couple": "Couple",
    "maternity": "Maternity",
    "newborn": "Newborn / baby",
    "wedding": "Wedding / prenup",
    "general": "General",
}
OCCASION_CHOICES = list(OCCASIONS.items())

# First match wins, so specific occasions come before broad ones like "family".
_KEYWORDS = [
    ("graduation", r"grad|toga|moving.?up|recognition|diploma|commencement"),
    ("christmas", r"christmas|xmas|holiday|noel|pasko|new.?year"),
    ("valentines", r"valentine|hearts? day"),
    ("maternity", r"maternity|pregnan|bump|preggy"),
    ("newborn", r"newborn|baby|infant|christening|baptism|binyag|cake.?smash"),
    ("wedding", r"wedding|prenup|pre-?nup|engagement|bridal|kasal"),
    ("birthday", r"birthday|bday|b-day|debut|\b18th\b|\b7th\b|turning"),
    ("couple", r"couple|duo|partner|anniversary|\blove\b"),
    ("family", r"family|barkada|group|reunion|squad|friends"),
]


def guess_occasion(*texts):
    """Instant keyword guess from a name (and optional extra text); 'general' when unclear."""
    blob = " ".join(str(t or "") for t in texts).lower()
    for key, pattern in _KEYWORDS:
        if re.search(pattern, blob):
            return key
    return "general"


def classify_with_ai(name, extra=""):
    """Groq's pick among OCCASIONS for one item; None when Groq is unavailable or unsure."""
    system = (
        "You tag photo-studio packages and categories with the occasion they are for. "
        "Pick exactly one key from: " + ", ".join(OCCASIONS) + ". "
        "Use 'general' for price-tier or all-purpose names (e.g. 'Delight', 'Premium', "
        "'Regular') that do not say what the shoot is for. "
        'Reply only with JSON: {"occasion": "<key>"}'
    )
    user = f"Name: {str(name)[:200]}\n" + (f"Details: {str(extra)[:600]}" if extra else "")
    try:
        result = chat_json(system, user, max_tokens=60)
    except GroqUnavailable as exc:
        logger.info("Occasion AI unavailable, keeping keyword guess: %s", exc)
        return None
    key = str(result.get("occasion") or "").strip().lower()
    return key if key in OCCASIONS else None


def _refine_in_background(model, pk, name, extra):
    def run():
        key = classify_with_ai(name, extra)
        if key:
            # update(): no save() signals/recursion; skip if staff locked it meanwhile
            model.objects.filter(pk=pk, occasion_locked=False).update(occasion=key)

    threading.Thread(target=run, daemon=True).start()


def auto_tag(instance, name_changed, extra=""):
    """
    Called from Category/Package.save() before the row is written.
    Fills a keyword guess now and schedules the Groq refinement after commit.
    """
    if instance.occasion_locked:
        return
    if not (name_changed or not instance.occasion):
        return
    instance.occasion = guess_occasion(instance.name, extra)
    model, name = type(instance), instance.name
    # pk is only known after the insert, so read it inside the callback
    transaction.on_commit(
        lambda: instance.pk and _refine_in_background(model, instance.pk, name, extra)
    )
