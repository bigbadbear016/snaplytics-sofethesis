from django.core.management.base import BaseCommand

from backend.models import RenewalShadowRun
from backend.renewal_model import live_model_version
from backend.renewal_shadow import record_shadow_predictions


class Command(BaseCommand):
    help = "Record non-customer-facing renewal predictions from the live XGBoost model."

    def handle(self, *args, **options):
        try:
            model_version, created, updated = record_shadow_predictions()
        except Exception as exc:
            RenewalShadowRun.objects.create(
                model_version=live_model_version() or "unavailable",
                status=RenewalShadowRun.STATUS_FAILED,
                error_message=str(exc),
            )
            raise
        RenewalShadowRun.objects.create(
            model_version=model_version,
            status=RenewalShadowRun.STATUS_SUCCESS,
            created_count=created,
            updated_count=updated,
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"{model_version}: shadow predictions recorded: "
                f"{created} created, {updated} updated."
            )
        )
