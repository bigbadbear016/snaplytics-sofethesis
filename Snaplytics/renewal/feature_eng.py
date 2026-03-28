import pandas as pd
import numpy as np

# Load merged raw dataset
df = pd.read_csv("renewal/raw/merged_bookings.csv")
#Drop Irrelevant Columns
drop_cols = [
    "full_name",
    "email",
    "contact_number",
    "instagram_handle",
    "registration_date",
    "consent",
    "created_at",
    "last_updated",
    "created_at_customer",
    "last_updated_customer",
    "created_at_package",
    "last_updated_package",
    "notes",
    "inclusions",
    "included_portraits",
    "freebies",
    "promo_price_condition",
    "booking_id",      # duplicate after merge
    "id_package"       # duplicate package id from packages table
]

df = df.drop(columns=[col for col in drop_cols if col in df.columns])
# Fix booleans + missing data
df["is_first_time"] = df["is_first_time"].fillna(0).astype(int)
df["previous_session_counts"] = df["previous_session_counts"].fillna(0).astype(int)
df["renewed_within_365"] = df["renewed_within_365"].fillna(False).astype(int)
#Convert dates + engineer time features

# Fix datetime
df["session_date"] = pd.to_datetime(df["session_date"], errors="coerce")

# Day of week (0=Mon, 6=Sun)
df["session_dayofweek"] = df["session_date"].dt.dayofweek

# Month (captures seasonality)
df["session_month"] = df["session_date"].dt.month

# Weekend flag
df["is_weekend"] = df["session_dayofweek"].isin([5, 6]).astype(int)
#Convert booleans & categories
df["is_first_time"] = df["is_first_time"].astype(int)
df["renewed_within_365"] = df["renewed_within_365"].astype(int)
#Spending behavior features
# Ratio relative to average customer spend
df["spend_ratio"] = df["total_price"] / (df["total_price"].mean() + 1e-9)

# Addon usage intensity
df["addon_intensity"] = df["addon_quantity"] / (df["total_price"] + 1)
#Payment features
df["uses_gcash"] = (df["gcash_payment"] > 0).astype(int)
df["uses_cash"] = (df["cash_payment"] > 0).astype(int)
#Package features
# package_id already exists, but name/category are richer
df["package_name"] = df["name"].astype(str)
df["package_category"] = df["category"].astype(str)
#Select final columns BEFORE encoding
keep_cols = [
    # Booking-level
    "session_dayofweek", "session_month", "is_weekend",
    "total_price", "gcash_payment", "cash_payment",
    "discounts", "session_status",

    # Customer-level
    "acquisition_source", "is_first_time", "previous_session_counts",

    # Addon-level
    "total_addon_cost", "addon_quantity", "addon_intensity",

    # Package-level
    "package_id", "package_name", "package_category",

    # Engineered
    "spend_ratio",
    
    # Target
    "renewed_within_365"
]

df = df[keep_cols]
#One-hot encode categorical variables
categorical_cols = [
    "session_status",
    "acquisition_source",
    "package_category",
    "package_name"
]

df = pd.get_dummies(df, columns=categorical_cols, drop_first=True)

df.to_csv("renewal/processed/final_prepared.csv", index=False)
print("Saved final_prepared.csv!")