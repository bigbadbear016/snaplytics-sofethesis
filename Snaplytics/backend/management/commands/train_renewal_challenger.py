import json
from datetime import date
from pathlib import Path

import numpy as np
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
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
from backend.management.commands.train_renewal_xgboost import MONOTONE, PARAMS
from backend.renewal_model import FEATURES, live_model_version


class Command(BaseCommand):
    help = "Train a monthly renewal challenger from mature shadow outcomes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--source-model-version",
            default=None,
            help="Default: the live XGBoost model version.",
        )
        parser.add_argument("--min-rows", type=int, default=100)
        parser.add_argument("--min-positives", type=int, default=20)
        parser.add_argument("--request-id", type=int)

    def handle(self, *args, **options):
        options["source_model_version"] = (
            options["source_model_version"] or live_model_version()
        )
        if not options["source_model_version"]:
            raise CommandError("No live model loads; pass --source-model-version.")
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
            .values(
                "customer_id",
                "snapshot_date",
                "feature_snapshot",
                "actual_renewal",
                "probability",
                "predicted_renewal",
            )
        )
        latest_by_customer = {}
        for row in rows:
            snapshot = row["feature_snapshot"] or {}
            # Customers with no bookings always get 0% from the live model, and
            # predictions saved before the model existed lack its inputs.
            if not snapshot.get("total_bookings") or any(
                snapshot.get(feature) is None for feature in FEATURES
            ):
                continue
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
                        float(row["feature_snapshot"][feature])
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
        if not int((y_train == 1).sum()):
            self.stdout.write(self.style.WARNING("Training data has no renewals."))
            return

        # Same inputs and settings as the live model (train_renewal_xgboost).
        model = XGBClassifier(
            monotone_constraints="(" + ",".join(map(str, MONOTONE)) + ")", **PARAMS
        )
        model.fit(x_train, y_train)
        probabilities = model.predict_proba(x_test)[:, 1]
        # Flag as many customers as the share that renewed in training.
        threshold = float(
            np.quantile(model.predict_proba(x_train)[:, 1], 1 - y_train.mean())
        )
        predictions = (probabilities >= threshold).astype(int)
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

        # Score the live model on the same test rows, using what it saved at
        # prediction time (its probability and its own yes/no group).
        live_probabilities = np.array(
            [float(row["probability"]) for row in test_rows], dtype=float
        )
        live_predictions = np.array(
            [int(bool(row["predicted_renewal"])) for row in test_rows]
        )
        metrics["live_model"] = {
            "version": options["source_model_version"],
            "precision": float(
                precision_score(y_test, live_predictions, zero_division=0)
            ),
            "recall": float(recall_score(y_test, live_predictions, zero_division=0)),
            "mcc": float(matthews_corrcoef(y_test, live_predictions)),
            "pr_auc": float(average_precision_score(y_test, live_probabilities)),
            "roc_auc": float(roc_auc_score(y_test, live_probabilities)),
        }
        # A candidate is kept only if it ranks renewers better than the live
        # model (PR-AUC, which suits rare renewals) and is not worse on MCC.
        beats_live_model = (
            metrics["pr_auc"] > metrics["live_model"]["pr_auc"]
            and metrics["mcc"] >= metrics["live_model"]["mcc"]
        )
        metrics["beats_live_model"] = beats_live_model

        models_dir = Path(settings.BASE_DIR) / "renewal" / "models"
        outputs_dir = Path(settings.BASE_DIR) / "renewal" / "outputs"
        outputs_dir.mkdir(parents=True, exist_ok=True)
        artifact_name = f"renewal_challenger_{date.today().isoformat()}"
        metrics_path = outputs_dir / f"{artifact_name}_metrics.json"
        model_path = None
        if beats_live_model:
            models_dir.mkdir(parents=True, exist_ok=True)
            model_path = models_dir / f"{artifact_name}.json"
            model.save_model(str(model_path))
        metrics["model_path"] = str(model_path) if model_path else None
        metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        if training_request:
            training_request.candidate_model_path = str(model_path) if model_path else None
            training_request.metrics = metrics
            training_request.save(update_fields=["candidate_model_path", "metrics"])
        if beats_live_model:
            self.stdout.write(self.style.SUCCESS(f"Candidate saved: {model_path}"))
        else:
            self.stdout.write(
                self.style.WARNING(
                    "Candidate did not beat the live model on PR-AUC and MCC. "
                    f"No model was saved. Metrics: {metrics_path}"
                )
            )
        self.stdout.write(json.dumps(metrics, indent=2))
