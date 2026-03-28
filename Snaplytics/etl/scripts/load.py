import pandas as pd
from django.db import transaction
from django.utils.timezone import make_aware, is_naive
from datetime import datetime
import numpy as np
import re
import logging
import math
from django.db.models import Q


from backend.models import (
    Customer,
    Package,
    Booking,
    Addon,
    BookingAddon,
    StagingBooking
)

logger = logging.getLogger(__name__)


def clean_json(obj):
    if obj is None:
        return None
    if isinstance(obj, float) and pd.isna(obj):
        return None
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.ndarray, list)):
        return [clean_json(x) for x in obj]
    if isinstance(obj, (datetime, pd.Timestamp)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {str(k): clean_json(v) for k, v in obj.items()}
    if isinstance(obj, (int, float, str, bool)):
        return obj
    return str(obj)


def insert_staging(df, file_name, checksum):
    for i, row in df.iterrows():
        raw_clean = clean_json(row["_raw"])
        canonical_clean = clean_json({
            k: v for k, v in row.items() if k not in ["_raw"]
        })

        StagingBooking.objects.create(
            file_name=file_name,
            file_checksum=checksum,
            raw_row_number=i + 1,
            raw_data=raw_clean,
            canonical_data=canonical_clean,
            processing_status="PENDING",
        )


def parse_prev_sessions(value):
    if value is None or str(value).strip() == "" or str(value).lower() == "nan":
        return 0
    digits = re.sub(r"\D", "", str(value))
    return int(digits) if digits else 0


def merge_consent(df):
    merged = 0

    with transaction.atomic():
        for _, r in df.iterrows():

            raw_date = r.get("registration_date")
            registration_date = None

            if raw_date and str(raw_date).lower() not in ["nan", "none", ""]:
                try:
                    if isinstance(raw_date, str):
                        registration_date = make_aware(datetime.fromisoformat(raw_date))
                except:
                    registration_date = None

            is_first_time = r.get("is_first_time")
            if is_first_time == "First time":
                is_first_time_final = True
                psc = 0
            else:
                is_first_time_final = False
                psc = parse_prev_sessions(is_first_time)

            package_name = r.get("package")
            package_obj = None

            if package_name and str(package_name).lower() not in ["nan", "none", ""]:
                try:
                    package_obj = Package.objects.get(name=package_name)
                except Package.DoesNotExist:
                    package_obj = None  


            Customer.objects.update_or_create(
                email=r["email"],
                defaults={
                    "full_name": r["full_name"],
                    "contact_number": r["contact_number"],
                    "instagram_handle": r["instagram_handle"],
                    "acquisition_source": r["acquisition_source"],
                    "is_first_time": is_first_time_final,
                    "previous_session_counts": psc,
                    "registration_date": registration_date,
                    "consent": r["consent"],
                    "package": package_obj,
                }
            )

            merged += 1

    return merged



OFFICIAL_ADDONS = [
    "Additional Person",
    "Additional 10 minutes",
    "Additional Backdrop",
    "Whole-Body Backdrop",
    "Onesie Pajama rent (1 design)",
    "LARGE Birthday Balloons Number 0 to 9",
    "All Soft Copies",
    "Single Soft Copy",
    "Additional Wallet Size (Hardcopy)",
    "Additional A4 Size (Hardcopy)",
    "Additional A6 size (Hardcopy)",
    "Additional Photo-Strip",
    "Additional Instax-Mini Inspired (Hardcopy)",
    "Whole Body Picture",
    "Additional 4r Size (Hardcopy)",
    "Spotlight",
    "Yearbook Props",
    "Yearbook Uniforms",
    "Get all soft copies",
    "2 Photostrips",
    "Add 10 minutes",
    "Wallet Size",
    "A6 size",
    "Additional 1 Edited Photo",
    "Barkada/Family Shots",
    "Couple Shots",
    "5x7 Print",
    "8x10 Print",
    "4x6 Print",
    "Glass Frame (Small 8x10 Photo) with Heigen Studio Bag",

]

ADDON_ALIAS = {
    "all softcopies": "All Soft Copies",
    "all soft copies": "All Soft Copies",
    "soft copy": "Single Soft Copy",
    "softcopy": "Single Soft Copy",
    "soft copies": "All Soft Copies",
    "softcopies": "All Soft Copies",
    "onesie": "Onesie Pajama rent (1 design)",
    "onesies": "Onesie Pajama rent (1 design)",
    "10 mins": "Additional 10 minutes",
    "10 minutes": "Additional 10 minutes",
    "add 10 minutes": "Additional 10 minutes",
    "additional 10": "Additional 10 minutes",
    "wallet": "Additional Wallet Size (Hardcopy)",
    "wallet size": "Additional Wallet Size (Hardcopy)",
    "whole body backdrop": "Whole-Body Backdrop",
    "whole-body": "Whole-Body Backdrop",
    "backdrop": "Additional Backdrop",
    "5x7": "5x7 Print",
    "8x10": "8x10 Print",
    "4x6": "4x6 Print",
    "spotlight": "Spotlight",
}


def normalize_addon_name(name):
    if not name:
        return ""
    n = name.lower().strip()
    for alias, canonical in ADDON_ALIAS.items():
        if alias in n:
            return canonical
    for official in OFFICIAL_ADDONS:
        if official.lower() in n:
            return official
    return name.strip()


def extract_addon_names(text):
    if not text or str(text).lower() == "nan":
        return []
    parts = [p.strip() for p in str(text).replace("\n", " ").split("+") if p.strip()]
    return [normalize_addon_name(p) for p in parts]


def extract_prices(text):
    if not text or str(text).lower() == "nan":
        return []
    nums = re.findall(r"\d+\.?\d*", str(text))
    return [float(n) for n in nums]


def clean_breakdown(names, prices):
    addon_names = extract_addon_names(names)
    if not addon_names:
        return [], []
    addon_names = addon_names[1:]  
    addon_prices = extract_prices(prices)[1:]
    while len(addon_prices) < len(addon_names):
        addon_prices.append(None)
    return addon_names, addon_prices

def detect_onesie_pajama(name, price, date):

    if not name:
        return None, None, None

    n = str(name).lower()


    if (
        "onesie" in n
        or "pajama" in n
        or "pj" in n
        or "pajamas" in n
    ):
        canonical = "Onesie Pajama rent (1 design)"


        if price == 80:
            return canonical, 1, 80
        elif price == 150:
            return canonical, 2, 80    
        elif price == 210:
            return canonical, 3, 80
        elif price == 300:
            return canonical, 4, 80
        elif price ==  450:
            return canonical, 6, 80
        else:
            print(f"⚠️ Session Date: {date} | Unexpected Onesie Pajama price: {price}")
            return canonical, 3, price

    return None, None, None

def restore_percent(value):
    if value is None:
        return ""
    s = str(value).strip()
    if s.replace(".", "", 1).lstrip("-").isdigit():
        try:
            f = float(s)
            if -1 <= f <= 1:
                pct = round(f * 100)
                return f"{pct}%"
        except:
            pass
    return s


def insert_booking_addons(booking, addon_names, addon_prices, session_date):
    # Debug context
    booking_date = session_date
    booking_customer = booking.customer.full_name if booking.customer else "Unknown Customer"

    # Preloaded addons map (global store for speed)
    # addon_map = {"addon name lower": Addon instance}
    global ADDON_CACHE
    if "ADDON_CACHE" not in globals():
        ADDON_CACHE = {a.name.lower(): a for a in Addon.objects.all()}

    # 1️⃣ Delete existing addons (Option A overwrite logic preserved)
    BookingAddon.objects.filter(booking=booking).delete()

    # 2️⃣ Loop addons with your EXACT business rules
    for idx, raw_name in enumerate(addon_names):

        if not raw_name:
            print(f"❌ Missing addon NAME | Customer: {booking_customer} | Date: {booking_date}")
            continue

        price_from_excel = addon_prices[idx] if idx < len(addon_prices) else None

        if price_from_excel is None:
            print(f"❌ Missing PRICE for addon '{raw_name}' | Customer: {booking_customer} | Date: {booking_date}")
            continue

        # 3️⃣ Onesie Pajama detection (unchanged)
        canonical, qty_override, _ = detect_onesie_pajama(raw_name, price_from_excel, booking_date)

        if canonical:
            addon_obj = ADDON_CACHE.get(canonical.lower())

            if not addon_obj:
                print(
                    f"❌ Onesie Pajama addon missing in DB: '{canonical}' "
                    f"| Customer: {booking_customer} | Date: {booking_date}"
                )
                continue

            unit_price = addon_obj.price
            total = unit_price * qty_override

            # 4️⃣ Create new addon row (faster & same logic — because we deleted earlier)
            BookingAddon.objects.create(
                booking=booking,
                addon=addon_obj,
                addon_quantity=qty_override,
                addon_price=unit_price,
                total_addon_cost=total,
            )
            continue

        # 5️⃣ Regular addon lookup via preloaded map (FAST)
        addon_obj = ADDON_CACHE.get(raw_name.lower())

        if not addon_obj:
            print(
                f"❌ Addon NOT FOUND in DB: '{raw_name}' "
                f"| Customer: {booking_customer} | Date: {booking_date}"
            )
            continue

        # 6️⃣ Qty logic (unchanged)
        if addon_obj.price:
            if price_from_excel % addon_obj.price == 0:
                qty = int(price_from_excel / addon_obj.price)
            else:
                qty = 1
                print(
                    f"⚠️ Unusual PRICE MISMATCH for '{raw_name}': Excel={price_from_excel}, "
                    f"DB={addon_obj.price} | Customer: {booking_customer} | Date: {booking_date}"
                )
        else:
            qty = 1

        unit_price = addon_obj.price or price_from_excel
        total = qty * unit_price

        # 7️⃣ Create addon row (same logic, faster)
        BookingAddon.objects.create(
            booking=booking,
            addon=addon_obj,
            addon_quantity=qty,
            addon_price=unit_price,
            total_addon_cost=total,
        )




def clean_string(value):
    if value is None:
        return None
    if isinstance(value, float): 
        return None
    value = str(value).strip()
    if value.lower() in ["nan", "none", "null", ""]:
        return None
    return value

def clean_amount(value):
    if value is None:
        return 0
    try:
        if isinstance(value, float) and math.isnan(value):
            return 0
    except:
        pass

    try:
        v = float(value)
        return v if v >= 0 else 0
    except:
        return 0

def merge_bookings(df):

    df = df.copy()
    df["full_name"] = df["full_name"].apply(clean_string)
    df["email"] = df["email"].apply(clean_string)
    df["package"] = df["package"].apply(clean_string)

    # -----------------------------------------
    # 1. COLLECT UNIQUE CUSTOMER + PACKAGE KEYS
    # -----------------------------------------
    emails = set(df["email"].dropna().unique())
    names = set(df["full_name"].dropna().unique())
    package_names = set(df["package"].dropna().unique())

    # -----------------------------------------
    # 2. LOAD EXISTING CUSTOMERS (email + name)
    # -----------------------------------------
    existing_customers = Customer.objects.filter(
        Q(email__in=emails) | Q(full_name__in=names)
    )

    customer_map = {}

    for c in existing_customers:
        if c.email:
            customer_map[c.email.lower()] = c
        if c.full_name:
            customer_map[c.full_name.lower()] = c

    # -----------------------------------------
    # 3. LOAD EXISTING PACKAGES
    # -----------------------------------------
    existing_packages = Package.objects.filter(
        name__in=package_names
    )

    package_map = {p.name.lower(): p for p in existing_packages}

    # -----------------------------------------
    # 4. DETECT NEW CUSTOMERS + PACKAGES
    # -----------------------------------------
    new_customers = []
    new_packages = []

    for _, r in df.iterrows():
        email = r["email"]
        name = r["full_name"]
        pkg = r["package"]

        cust_key = None
        if email:
            cust_key = email.lower()
        elif name:
            cust_key = name.lower()

        if cust_key and cust_key not in customer_map:
            new_customers.append(Customer(full_name=name or None, email=email or None))
            customer_map[cust_key] = None  # placeholder

        if pkg and pkg.lower() not in package_map:
            new_packages.append(Package(name=pkg, price=0))
            package_map[pkg.lower()] = None

    # -----------------------------------------
    # 5. BULK CREATE CUSTOMERS + PACKAGES
    # -----------------------------------------
    created_customers = Customer.objects.bulk_create(new_customers)
    created_packages = Package.objects.bulk_create(new_packages)

    for c in created_customers:
        if c.email:
            customer_map[c.email.lower()] = c
        if c.full_name:
            customer_map[c.full_name.lower()] = c

    for p in created_packages:
        package_map[p.name.lower()] = p

    # -----------------------------------------
    # 6. BULK CREATE BOOKINGS
    # -----------------------------------------
    booking_objs = []

    for _, r in df.iterrows():

        # customer lookup
        key = r["email"].lower() if r["email"] else (
            r["full_name"].lower() if r["full_name"] else None
        )
        customer = customer_map.get(key)

        # package lookup
        pkg = package_map.get(r["package"].lower()) if r["package"] else None

        # date parsing
        session_date = None
        raw_dt = r.get("session_date")

        if raw_dt and str(raw_dt).lower() not in ["nan", "none", ""]:
            try:
                dt = datetime.fromisoformat(str(raw_dt))
                if is_naive(dt):
                    dt = make_aware(dt)
                session_date = dt
            except:
                pass

        booking_objs.append(
            Booking(
                customer=customer,
                package=pkg,
                session_date=session_date,
                total_price=r.get("total"),
                gcash_payment=clean_amount(r.get("gcash")),
                cash_payment=clean_amount(r.get("cash")),
                discounts=restore_percent(r.get("discounts")),
                session_status="BOOKED",
            )
        )

    created_bookings = Booking.objects.bulk_create(booking_objs)

    # -----------------------------------------
    # 7. ADDONS — KEEP YOUR EXACT LOGIC
    # -----------------------------------------
    for booking, (_, r) in zip(created_bookings, df.iterrows()):
        addon_names, addon_prices = clean_breakdown(
            r.get("breakdown_of_package"),
            r.get("breakdown_pricing"),
        )
        insert_booking_addons(
            booking,
            addon_names,
            addon_prices,
            booking.session_date,
        )

    return len(df)
