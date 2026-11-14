from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, Q

from backend.models import RenewalShadowPrediction
from backend.renewal_model import live_model_version


class Command(BaseCommand):
    help = "Report metrics for mature, non-customer-facing renewal predictions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--model-version",
            default=None,
            help="Default: the live XGBoost model version.",
        )

    def handle(self, *args, **options):
        model_version = options["model_version"] or live_model_version()
        if not model_version:
            raise CommandError("No live model loads; pass --model-version.")
        self.stdout.write(f"Model version: {model_version}")
        qs = RenewalShadowPrediction.objects.filter(
            model_version=model_version,
            actual_renewal__isnull=False,
        )
        totals = qs.aggregate(
            total=Count("id"),
            tp=Count("id", filter=Q(predicted_renewal=True, actual_renewal=True)),
            fp=Count("id", filter=Q(predicted_renewal=True, actual_renewal=False)),
            fn=Count("id", filter=Q(predicted_renewal=False, actual_renewal=True)),
            tn=Count("id", filter=Q(predicted_renewal=False, actual_renewal=False)),
        )
        total = totals["total"]
        if not total:
            self.stdout.write("No mature shadow predictions are available yet.")
            return

        tp, fp, fn, tn = (totals[key] for key in ("tp", "fp", "fn", "tn"))
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        accuracy = (tp + tn) / total
        # Always-no is right for every customer who did not renew (TN + FP).
        baseline = (tn + fp) / total
        self.stdout.write(f"Mature predictions: {total}")
        self.stdout.write(f"Accuracy: {accuracy:.4f}")
        self.stdout.write(f"Always-no baseline: {baseline:.4f}")
        self.stdout.write(f"Precision: {precision:.4f}")
        self.stdout.write(f"Recall: {recall:.4f}")
        self.stdout.write(f"Confusion matrix: TP={tp} FP={fp} TN={tn} FN={fn}")
