# recommender/data_builder.py

import os
import pandas as pd


BOOKINGS_CSV = "recommender/data/merged_bookings.csv"
BOOKING_ADDONS_CSV = "recommender/data/booking_addons.csv"
OUT_RATINGS = "recommender/data/surprise_ratings_booking.csv"


def build_booking_aware_ratings(bookings_csv, booking_addons_csv, out_path):
    bookings = pd.read_csv(bookings_csv, parse_dates=["session_date"], low_memory=False)
    addons = pd.read_csv(booking_addons_csv, low_memory=False)

    user_col = "customer_id" if "customer_id" in bookings.columns else "user_id"

    # ---- Booking → user mapping (1 row per booking)
    booking_map = (
        bookings.sort_values("session_date", ascending=False)
        .drop_duplicates(subset=["booking_id"], keep="first")[
            ["booking_id", user_col, "session_date", "package_id"]
        ]
        .rename(columns={user_col: "user_id"})
    )

    # ---- Package interaction (1 per booking)
    pkg_rows = booking_map[
        ["booking_id", "user_id", "package_id", "session_date"]
    ].copy()
    pkg_rows["item_id"] = pkg_rows["package_id"].astype(str)

    # ---- Addon interactions (many per booking)
    addons = addons.merge(
        booking_map[["booking_id", "user_id", "session_date"]],
        on="booking_id",
        how="inner",
    )
    addon_rows = addons[["booking_id", "user_id", "addon_id", "session_date"]].copy()
    addon_rows["item_id"] = addon_rows["addon_id"].apply(lambda x: f"addon::{x}")

    # ---- Combine
    interactions = pd.concat(
        [
            pkg_rows[["booking_id", "user_id", "item_id", "session_date"]],
            addon_rows[["booking_id", "user_id", "item_id", "session_date"]],
        ],
        ignore_index=True,
    )

    interactions["rating"] = 1
    interactions["user_id"] = interactions["user_id"].astype(str)
    interactions["item_id"] = interactions["item_id"].astype(str)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    interactions.to_csv(out_path, index=False)
    print("WROTE:", out_path)

    return interactions


if __name__ == "__main__":
    build_booking_aware_ratings(BOOKINGS_CSV, BOOKING_ADDONS_CSV, OUT_RATINGS)

