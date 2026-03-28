import pandas as pd
from sklearn.model_selection import train_test_split
import os

INPUT_PATH = "renewal/processed/final_prepared.csv"
OUTPUT_DIR = "renewal/processed"
TARGET_COL = "renewed_within_365"
TEST_SIZE = 0.2
RANDOM_STATE = 42

df = pd.read_csv(INPUT_PATH)

X = df.drop(columns=[TARGET_COL])
y = df[TARGET_COL].astype(int)

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=TEST_SIZE,
    random_state=RANDOM_STATE,
    stratify=y
)


train_df = pd.concat([X_train, y_train], axis=1)
test_df = pd.concat([X_test, y_test], axis=1)

os.makedirs(OUTPUT_DIR, exist_ok=True)

train_df.to_csv(f"{OUTPUT_DIR}/train.csv", index=False)
test_df.to_csv(f"{OUTPUT_DIR}/test.csv", index=False)

print("Train/Test split completed")
print(f"Train set shape: {train_df.shape}")
print(f"Test set shape:  {test_df.shape}")
print(f"Renewal rate (train): {train_df[TARGET_COL].mean():.3f}")
print(f"Renewal rate (test):  {test_df[TARGET_COL].mean():.3f}")
