import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from xgboost import XGBClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    matthews_corrcoef,
    roc_auc_score,
    classification_report,
    confusion_matrix,
)
import os


# -----------------------------
# CORE METRICS
# -----------------------------
def evaluate_model(y_true, y_pred, y_proba):
    return {
        "accuracy": accuracy_score(y_true, y_pred),
        "precision": precision_score(y_true, y_pred),
        "recall": recall_score(y_true, y_pred),
        "f1": f1_score(y_true, y_pred),
        "mcc": matthews_corrcoef(y_true, y_pred),
        "roc_auc": roc_auc_score(y_true, y_proba),
    }


# -----------------------------
# LOAD MODEL
# -----------------------------
def load_xgb_model(model_path: str):
    model = XGBClassifier()
    model.load_model(model_path)
    return model


# -----------------------------
# LOAD + PREP DATA
# -----------------------------
def load_test_data(csv_path: str):
    df = pd.read_csv(csv_path)

    y = df["renewed_within_365"].astype(int)
    X = df.drop(columns=["renewed_within_365"])

    X = X.apply(pd.to_numeric, errors="coerce").fillna(0)

    return X, y


# -----------------------------
# MAIN EVALUATION FUNCTION
# -----------------------------
def evaluate_saved_model(
    model_path: str,
    test_data_path: str,
    threshold: float = 0.5,
    output_dir: str = "renewal/outputs"
):
    os.makedirs(output_dir, exist_ok=True)

    # Load model + data
    model = load_xgb_model(model_path)
    X, y_true = load_test_data(test_data_path)

    # Predict
    y_proba = model.predict_proba(X)[:, 1]
    y_pred = (y_proba >= threshold).astype(int)

    # Metrics
    metrics = evaluate_model(y_true, y_pred, y_proba)

    print("\n=== XGBoost SAVED MODEL PERFORMANCE ===")
    for k, v in metrics.items():
        print(f"{k.upper()}: {v:.4f}")

    print("\nClassification Report:\n")
    print(classification_report(y_true, y_pred))

    # Confusion matrix
    cm = confusion_matrix(y_true, y_pred)
    plt.figure(figsize=(5, 4))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues")
    plt.title("Confusion Matrix (Saved Model)")
    plt.xlabel("Predicted")
    plt.ylabel("Actual")
    plt.tight_layout()
    plt.show()

    # Save metrics
    pd.DataFrame([metrics]).to_csv(
        f"{output_dir}/xgboost_saved_model_results.csv",
        index=False
    )

    # Feature importance
    booster = model.get_booster()
    importance_dict = booster.get_score(importance_type="gain")

    importance_df = (
        pd.DataFrame({
            "feature": importance_dict.keys(),
            "importance": importance_dict.values()
        })
        .sort_values("importance", ascending=False)
    )

    plt.figure(figsize=(8, 6))
    plt.barh(
        importance_df["feature"].head(20),
        importance_df["importance"].head(20)
    )
    plt.gca().invert_yaxis()
    plt.xlabel("Gain Importance")
    plt.title("Top 20 Feature Importances (Saved Model)")
    plt.tight_layout()
    plt.show()

    return metrics

if __name__ == "__main__":
    evaluate_saved_model("renewal/models/xgb_renewal.json", "renewal/processed/final_prepared.csv")
