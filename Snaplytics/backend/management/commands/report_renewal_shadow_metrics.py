from django.core.management.base import BaseCommand
from django.db.models import Count, Q

from backend.models import RenewalShadowPrediction
from backend.renewal_shadow import SHADOW_MODEL_VERSION


class Command(BaseCommand):
    help = "Report metrics for mature, non-customer-facing renewal predictions."

    def add_arguments(self, parser):
        parser.add_argument("--model-version", default=SHADOW_MODEL_VERSION)

    def handle(self, *args, **options):
        qs = RenewalShadowPrediction.objects.filter(
            model_version=options["model_version"],
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
        baseline = (tn + fn) / total
        self.stdout.write(f"Mature predictions: {total}")
        self.stdout.write(f"Accuracy: {accuracy:.4f}")
        self.stdout.write(f"Always-no baseline: {baseline:.4f}")
        self.stdout.write(f"Precision: {precision:.4f}")
        self.stdout.write(f"Recall: {recall:.4f}")
        self.stdout.write(f"Confusion matrix: TP={tp} FP={fp} TN={tn} FN={fn}")
