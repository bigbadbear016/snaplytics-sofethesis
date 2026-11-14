from django.core.management.base import BaseCommand

from backend.renewal_shadow import evaluate_mature_shadow_predictions


class Command(BaseCommand):
    help = "Resolve mature shadow predictions against subsequent live bookings."

    def add_arguments(self, parser):
        parser.add_argument(
            "--model-version",
            default=None,
            help="Only resolve this version. Default: every version.",
        )

    def handle(self, *args, **options):
        evaluated = evaluate_mature_shadow_predictions(
            model_version=options["model_version"]
        )
        self.stdout.write(
            self.style.SUCCESS(f"Mature shadow predictions evaluated: {evaluated}.")
        )
