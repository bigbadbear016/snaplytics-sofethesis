import json
from datetime import date
from pathlib import Path

import numpy as np
from django.conf import settings
from django.core.management.base import BaseCommand
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    matthews_corrcoef,
    precision_score,
    recall_score,
    roc_auc_score,
)
from xgboost import XGBClassifier

from backend.models import RenewalShadowPrediction
from backend.models import RenewalTrainingRequest
from backend.renewal_shadow import SHADOW_MODEL_VERSION


FEATURES = (
    "total_bookings",
    "avg_booking_value",
    "total_spent",
    "days_since_previous_booking",
    "distinct_packages",
    "has_missing_booking_date",
)


class Command(BaseCommand):
    help = "Train a monthly renewal challenger from mature shadow outcomes."

    def add_arguments(self, parser):
        parser.add_argument("--source-model-version", default=SHADOW_MODEL_VERSION)
        parser.add_argument("--min-rows", type=int, default=100)
        parser.add_argument("--min-positives", type=int, default=20)
        parser.add_argument("--request-id", type=int)

    def handle(self, *args, **options):
        training_request = None
        if options["request_id"]:
            training_request = RenewalTrainingRequest.objects.get(
                pk=options["request_id"],
                status=RenewalTrainingRequest.STATUS_APPROVED,
            )
        rows = list(
            RenewalShadowPrediction.objects.filter(
                model_version=options["source_model_version"],
                actual_renewal__isnull=False,
            )
            .order_by("customer_id", "-snapshot_date")
            .values("customer_id", "snapshot_date", "feature_snapshot", "actual_renewal")
        )
        latest_by_customer = {}
        for row in rows:
            latest_by_customer.setdefault(row["customer_id"], row)
        rows = sorted(latest_by_customer.values(), key=lambda row: row["snapshot_date"])

        positive_count = sum(bool(row["actual_renewal"]) for row in rows)
        if len(rows) < options["min_rows"] or positive_count < options["min_positives"]:
            self.stdout.write(
                self.style.WARNING(
                    f"Not enough mature data: {len(rows)} rows and "
                    f"{positive_count} renewals. No model was trained."
                )
            )
            return

        split_at = max(1, int(len(rows) * 0.8))
        train_rows, test_rows = rows[:split_at], rows[split_at:]
        if not test_rows or len({bool(row["actual_renewal"]) for row in test_rows}) < 2:
            self.stdout.write(
                self.style.WARNING(
                    "The chronological test set does not contain both classes. "
                    "No model was trained."
                )
            )
            return

        def matrix(source_rows):
            return np.array(
                [
                    [
                        float(row["feature_snapshot"].get(feature) or 0.0)
                        for feature in FEATURES
                    ]
                    for row in source_rows
                ],
                dtype=float,
            )

        x_train = matrix(train_rows)
        y_train = np.array([int(row["actual_renewal"]) for row in train_rows])
        x_test = matrix(test_rows)
        y_test = np.array([int(row["actual_renewal"]) for row in test_rows])
        negatives = int((y_train == 0).sum())
        positives = int((y_train == 1).sum())
        if not positives:
            self.stdout.write(self.style.WARNING("Training data has no renewals."))
            return

        model = XGBClassifier(
            n_estimators=200,
            max_depth=3,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            scale_pos_weight=negatives / positives,
            eval_metric="logloss",
            random_state=42,
        )
        model.fit(x_train, y_train)
        probabilities = model.predict_proba(x_test)[:, 1]
        predictions = (probabilities >= 0.5).astype(int)
        metrics = {
            "rows": len(rows),
            "train_rows": len(train_rows),
            "test_rows": len(test_rows),
            "test_positives": int(y_test.sum()),
            "accuracy": float(accuracy_score(y_test, predictions)),
            "precision": float(precision_score(y_test, predictions, zero_division=0)),
            "recall": float(recall_score(y_test, predictions, zero_division=0)),
            "mcc": float(matthews_corrcoef(y_test, predictions)),
            "pr_auc": float(average_precision_score(y_test, probabilities)),
            "roc_auc": float(roc_auc_score(y_test, probabilities)),
            "always_no_accuracy": float((y_test == 0).mean()),
            "features": list(FEATURES),
            "source_model_version": options["source_model_version"],
            "trained_at": date.today().isoformat(),
        }

        models_dir = Path(settings.BASE_DIR) / "renewal" / "models"
        outputs_dir = Path(settings.BASE_DIR) / "renewal" / "outputs"
        models_dir.mkdir(parents=True, exist_ok=True)
        outputs_dir.mkdir(parents=True, exist_ok=True)
        artifact_name = f"renewal_challenger_{date.today().isoformat()}"
        model_path = models_dir / f"{artifact_name}.json"
        metrics_path = outputs_dir / f"{artifact_name}_metrics.json"
        model.save_model(str(model_path))
        metrics["model_path"] = str(model_path)
        metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        if training_request:
            training_request.candidate_model_path = str(model_path)
            training_request.metrics = metrics
            training_request.save(update_fields=["candidate_model_path", "metrics"])
        self.stdout.write(self.style.SUCCESS(f"Candidate saved: {model_path}"))
        self.stdout.write(json.dumps(metrics, indent=2))
