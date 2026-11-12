from django.core.management.base import BaseCommand

from backend.renewal_shadow import (
    SHADOW_MODEL_VERSION,
    record_shadow_predictions,
)
from backend.models import RenewalShadowRun


class Command(BaseCommand):
    help = "Record non-customer-facing renewal predictions from live booking data."

    def add_arguments(self, parser):
        parser.add_argument("--model-version", default=SHADOW_MODEL_VERSION)
        parser.add_argument("--threshold", type=float, default=0.5)

    def handle(self, *args, **options):
        threshold = options["threshold"]
        if not 0 <= threshold <= 1:
            raise ValueError("--threshold must be between 0 and 1.")
        try:
            created, updated = record_shadow_predictions(
                model_version=options["model_version"],
                threshold=threshold,
            )
        except Exception as exc:
            RenewalShadowRun.objects.create(
                model_version=options["model_version"],
                status=RenewalShadowRun.STATUS_FAILED,
                error_message=str(exc),
            )
            raise
        RenewalShadowRun.objects.create(
            model_version=options["model_version"],
            status=RenewalShadowRun.STATUS_SUCCESS,
            created_count=created,
            updated_count=updated,
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Shadow predictions recorded: {created} created, {updated} updated."
            )
        )
