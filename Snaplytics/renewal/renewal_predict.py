import argparse
import pandas as pd
import numpy as np
from xgboost import XGBClassifier
import shap
import xgboost as xgb

# -----------------------------
# CONFIG
# -----------------------------
MODEL_PATH = "renewal/models/xgb_renewal.json"
DATA_PATH = "renewal/processed/final_prepared.csv"
THRESHOLD = 0.6   # tune this later

# -----------------------------
# LOAD MODEL
# -----------------------------
def load_model():
    model = XGBClassifier()
    model.load_model(MODEL_PATH)
    return model

def explain_single_customer_xgb(model, X_single):
    """
    Uses XGBoost's native SHAP (pred_contribs)
    """
    contribs = model.get_booster().predict(
        xgb.DMatrix(X_single),
        pred_contribs=True
    )

    # Last column is the bias term
    shap_values = contribs[0][:-1]
    bias = contribs[0][-1]

    explanation_df = pd.DataFrame({
        "feature": X_single.columns,
        "shap_value": shap_values
    })

    explanation_df["impact"] = explanation_df["shap_value"].abs()
    explanation_df = explanation_df.sort_values(
        "impact", ascending=False
    )

    return explanation_df, bias


# -----------------------------
# SINGLE CUSTOMER PREDICTION
# -----------------------------
def predict_single_customer(row_index: int):
    df = pd.read_csv(DATA_PATH)

    if row_index < 0 or row_index >= len(df):
        raise ValueError(f"row_index must be between 0 and {len(df)-1}")

    # Keep original row for display
    original_row = df.iloc[row_index].copy()

    # Drop target if present
    if "renewed_within_365" in df.columns:
        df = df.drop(columns=["renewed_within_365"])

    # Drop raw package name if still present
    if "package_name" in df.columns:
        df = df.drop(columns=["package_name"])

    # Clean discounts if still present
    if "discounts" in df.columns:
        df["discounts"] = (
            df["discounts"].astype(str)
            .str.replace("rf", "", regex=False)
            .str.replace("%", "", regex=False)
            .str.replace("[^0-9\-.]", "", regex=True)
        )
        df["discounts"] = pd.to_numeric(df["discounts"], errors="coerce").fillna(0)

    # Ensure numeric
    X = df.apply(pd.to_numeric, errors="coerce").fillna(0)

    # Select single row
    X_single = X.iloc[[row_index]]

    model = load_model()

    # Prediction
    proba = model.predict_proba(X_single)[0, 1]
    prediction = int(proba >= THRESHOLD)

    # Explainability (XGBoost native SHAP)
    explanations_df, bias = explain_single_customer_xgb(model, X_single)

    return {
        "row_index": row_index,
        "renewal_probability": float(proba),
        "predicted_renewal": prediction,
        "threshold": THRESHOLD,
        "bias": float(bias),
        "raw_features": original_row.to_dict(),
        "explanations": explanations_df
    }


    
# -----------------------------
# CLI
# -----------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Predict renewal for a single customer")
    parser.add_argument(
        "--row_index",
        type=int,
        required=True,
        help="Row index of the customer in final_prepared.csv"
    )

    args = parser.parse_args()

    result = predict_single_customer(args.row_index)

    print("\n=== SINGLE CUSTOMER RENEWAL PREDICTION ===")
    print(f"Row Index: {result['row_index']}")
    print(f"Renewal Probability: {result['renewal_probability']:.4f}")
    print(f"Decision Threshold: {result['threshold']}")
    print(f"Predicted Renewal: {result['predicted_renewal']}")

    print("\nTop reasons:")
    top_reasons = result["explanations"].head(5)
    for _, row in top_reasons.iterrows():
        direction = "increases renewal" if row["shap_value"] > 0 else "decreases renewal"
        print(
            f"{row['feature']}: {direction} ({row['shap_value']:+.4f})"
        )
