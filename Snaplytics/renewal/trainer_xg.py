# -----------------------------
# Imports
# -----------------------------
import pandas as pd
import numpy as np
from xgboost import XGBClassifier
import os

# -----------------------------
# LOAD TRAIN DATA ONLY
# -----------------------------
df = pd.read_csv("renewal/processed/train.csv")

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

# -----------------------------
# FEATURES / TARGET
# -----------------------------
X_train = df.drop(columns=["renewed_within_365"])
X_train = X_train.apply(pd.to_numeric, errors="coerce").fillna(0)

y_train = df["renewed_within_365"].astype(int)

# -----------------------------
# CLASS IMBALANCE
# -----------------------------
neg, pos = np.bincount(y_train)
scale_pos_weight = neg / pos

print("neg:", neg, "pos:", pos, "scale_pos_weight:", scale_pos_weight)

# -----------------------------
# MODEL
# -----------------------------
xgb_full = XGBClassifier(
    n_estimators=300,
    max_depth=4,
    learning_rate=0.1,
    subsample=0.9,
    colsample_bytree=0.8,
    eval_metric="logloss",
    scale_pos_weight=scale_pos_weight,
    random_state=42
)

# -----------------------------
# TRAIN
# -----------------------------
xgb_full.fit(X_train, y_train)

# -----------------------------
# SAVE MODEL
# -----------------------------
os.makedirs("renewal/models", exist_ok=True)
xgb_full.save_model("renewal/models/xgb_renewal.json")

print("Model saved to renewal/models/xgb_renewal.json")
