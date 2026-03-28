import pandas as pd
import logging
from datetime import datetime, date
import re


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def detect_format(df):
    headers = df.iloc[0].values
    col_list = [x for x in headers]
    if col_list[0] == "Session Date":
        return "booking"
    return "consent"


def transform_consent(df):
    df = df.copy()
    df.columns = df.iloc[0]
    df = df[1:]
    df = df.dropna(how="all")
    df.columns = (
        df.columns.str.lower()
        .str.replace(" ", "_")
        .str.replace(r"[^a-z0-9_]", "", regex=True)
    )
    out = pd.DataFrame({
        "full_name": df.get("full_name", ""),
        "email": df.get("email_address", df.get("email", "")),
        "contact_number": df.get("contact_number", ""),
        "instagram_handle": df.get("instagram_username_optional", ""),
        "acquisition_source": df.get("booking_or_walkin"),
        "is_first_time": df.get("is_it_your_first_time_here_if_not_how_many_times_did_you_already_had_a_photo_session_with_us"),
        "registration_date": df.get("timestamp"),
        "consent": df.get("by_checking_the_i_agree_box_i_hereby_grant_permission_and_give_consent_to_heigen_studio_for_releasing_myour_photos_on_public__social_media_platforms"),
        "package": df.get("package_")
    })
    out["_raw"] = df.to_dict(orient="records")
    out["record_type"] = "consent"
    return out



def transform_bookings(df):
    df = df.copy()

    # First row becomes header
    df.columns = df.iloc[0]
    df = df[1:]

    # Remove fully empty rows
    df = df.dropna(how="all")

    # Normalize column names
    df.columns = (
        df.columns.str.lower()
        .str.replace(" ", "_")
        .str.replace(r"[^a-z0-9_]", "", regex=True)
    )

    out = pd.DataFrame({
        "session_date": df.get("session_date"),
        "full_name": df.get("full_name", ""),
        "email": df.get("email_address", df.get("email", "")),
        "package": df.get("package"),
        "breakdown_of_package": df.get("breakdown_of_package"),
        "breakdown_pricing": df.get("breakdown_pricing"),
        "gcash": df.get("gcash"),
        "cash": df.get("cash"),
        "total": df.get("total"),
        "discounts": df.get("discounts")
    })

    out["_raw"] = df.to_dict(orient="records")
    out["record_type"] = "booking"

    return out
    


def transform(df_raw):
    fmt = detect_format(df_raw)
    if fmt == "consent":
        logger.info("📌 Format detected: CONSENT form")
        return transform_consent(df_raw)
    logger.info("📌 Format detected: BOOKING form")
    return transform_bookings(df_raw)
