from django.core.management.base import BaseCommand
from django.utils import timezone

from backend.models import RenewalTrainingRequest, RenewalTrainingSettings
from backend.renewal_shadow import SHADOW_MODEL_VERSION


class Command(BaseCommand):
    help = "Create a pending renewal training request for admin review."

    def add_arguments(self, parser):
        parser.add_argument("--source-model-version", default=SHADOW_MODEL_VERSION)

    def handle(self, *args, **options):
        settings_row = RenewalTrainingSettings.objects.first()
        if settings_row and settings_row.automatic_training_enabled:
            request = RenewalTrainingRequest.objects.create(
                source_model_version=options["source_model_version"],
                status=RenewalTrainingRequest.STATUS_APPROVED,
                reviewed_at=timezone.now(),
                notes="Automatic monthly training started.",
            )
            self.stdout.write(
                self.style.SUCCESS("Automatic training is enabled; starting challenger training.")
            )
            from django.core.management import call_command
            call_command(
                "train_renewal_challenger",
                source_model_version=options["source_model_version"],
                request_id=str(request.id),
            )
            return
        request, created = RenewalTrainingRequest.objects.get_or_create(
            source_model_version=options["source_model_version"],
            status=RenewalTrainingRequest.STATUS_PENDING,
        )
        message = "created" if created else "already pending"
        self.stdout.write(self.style.SUCCESS(f"Training request {message}: {request.id}"))
