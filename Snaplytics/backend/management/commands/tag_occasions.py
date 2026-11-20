"""
Tag existing categories and packages with an occasion type (backend.occasions).

New or renamed items are tagged automatically on save; run this once for rows that
existed before, or with --force to re-tag everything that staff has not locked.

    python manage.py tag_occasions            # untagged rows only
    python manage.py tag_occasions --force    # re-tag all unlocked rows
    python manage.py tag_occasions --no-ai    # keyword guess only (no Groq calls)
"""
from django.core.management.base import BaseCommand

from backend.models import Category, Package
from backend.occasions import OCCASIONS, classify_with_ai, guess_occasion


class Command(BaseCommand):
    help = "Tag categories and packages with an occasion type (Groq, keyword fallback)."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Re-tag all unlocked rows.")
        parser.add_argument("--no-ai", action="store_true", help="Keyword guess only.")

    def handle(self, *args, force=False, no_ai=False, **options):
        for model, extra_of in (
            (Category, lambda obj: ""),
            (Package, lambda obj: f"category: {obj.category}"),
        ):
            qs = model.objects.filter(occasion_locked=False, deleted_at__isnull=True)
            if not force:
                qs = qs.filter(occasion="")
            counts = {}
            for obj in qs:
                extra = extra_of(obj)
                key = (None if no_ai else classify_with_ai(obj.name, extra)) or guess_occasion(obj.name, extra)
                # update(): skip save() so this does not schedule a second AI pass
                model.objects.filter(pk=obj.pk).update(occasion=key)
                counts[key] = counts.get(key, 0) + 1
                self.stdout.write(f"  {model.__name__} {obj.name!r} -> {OCCASIONS[key]}")
            summary = ", ".join(f"{OCCASIONS[k]}: {n}" for k, n in sorted(counts.items())) or "nothing to tag"
            self.stdout.write(self.style.SUCCESS(f"{model.__name__}: {summary}"))
