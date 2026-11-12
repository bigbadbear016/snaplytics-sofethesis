from django.core.management.base import BaseCommand

from backend.renewal_shadow import (
    SHADOW_MODEL_VERSION,
    record_shadow_predictions,
)


class Command(BaseCommand):
    help = "Record non-customer-facing renewal predictions from live booking data."

    def add_arguments(self, parser):
        parser.add_argument("--model-version", default=SHADOW_MODEL_VERSION)
        parser.add_argument("--threshold", type=float, default=0.5)

    def handle(self, *args, **options):
        threshold = options["threshold"]
        if not 0 <= threshold <= 1:
            raise ValueError("--threshold must be between 0 and 1.")
        created, updated = record_shadow_predictions(
            model_version=options["model_version"],
            threshold=threshold,
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Shadow predictions recorded: {created} created, {updated} updated."
            )
        )
