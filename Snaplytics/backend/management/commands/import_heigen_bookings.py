"""
Replace all customer data with the cleaned bookings workbook.

    python manage.py import_heigen_bookings FILE.xlsx            # dry run: report only
    python manage.py import_heigen_bookings FILE.xlsx --apply    # wipe, then import

The workbook must have a sheet "Sheet1" with the columns
Session Date | Full Name | Email | Package | Addons | Gcash | Cash | Total | Discounts
(the format produced by the BOOKINGS CLEANUP RULES sheet).

--apply deletes, in one transaction:
  every Customer (also soft-deleted ones in Internal Records) and, by cascade,
  their Bookings, BookingAddons, CouponSent, CouponUsage, Renewal and
  RenewalShadowPrediction rows; and every StagingBooking row (raw ETL copies).
Then it creates one Customer per email, one Booking per row (status BOOKED),
BookingAddon rows from the Addons column, and recomputes every Renewal profile.
Imported bookings are historical: no loyalty points are credited.

Take a database backup first (python backup_db.py).
"""
import datetime as dt
import re
from collections import Counter, defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from backend.models import (
    Addon,
    Booking,
    BookingAddon,
    Customer,
    Package,
    StagingBooking,
)
from backend.renewal_utils import recompute_customer_renewal_profile

COLUMNS = [
    "Session Date",
    "Full Name",
    "Email",
    "Package",
    "Addons",
    "Gcash",
    "Cash",
    "Total",
    "Discounts",
]
ADDON_QTY_RE = re.compile(r"^(.*?)\s+x(\d+)$")


def parse_session_date(value):
    """
    Text cells are dd/mm/yy. Datetime cells were mangled by a spreadsheet that
    read dd/mm as mm/dd, so their month and day are swapped back.
    """
    if isinstance(value, dt.datetime):
        return dt.date(value.year, value.day, value.month)
    text = str(value).strip()
    return dt.datetime.strptime(text, "%d/%m/%y").date()


def to_number(value):
    if value is None or str(value).strip() in ("", "."):
        return 0.0
    return float(str(value).replace(",", ""))


def format_discount(value):
    """
    Same format as existing rows: -0.1 -> '-10%'; -29 -> '-29'; 0 -> None;
    text notes ('-250 (voucher)') kept as-is.
    """
    if isinstance(value, str) and value.strip():
        try:
            number = to_number(value)
        except ValueError:
            return re.sub(r"\s+", " ", value).strip()
    else:
        number = to_number(value)
    if number == 0:
        return None
    if -1 < number < 0:
        return f"{round(number * 100):d}%"
    return f"{number:g}"


def parse_addons(text):
    if text is None or not str(text).strip():
        return []
    out = []
    for part in str(text).split(" + "):
        part = part.strip()
        if not part:
            continue
        match = ADDON_QTY_RE.match(part)
        if match:
            out.append((match.group(1).strip(), int(match.group(2))))
        else:
            out.append((part, 1))
    return out


def pick_by_name(queryset):
    """Name -> live object; prefer not deleted, not archived, lowest id."""
    chosen = {}
    for obj in queryset.order_by("id"):
        rank = (
            getattr(obj, "deleted_at", None) is not None,
            bool(getattr(obj, "is_archived", False)),
        )
        current = chosen.get(obj.name)
        if current is None or rank < current[0]:
            chosen[obj.name] = (rank, obj)
    return {name: obj for name, (_, obj) in chosen.items()}


class Command(BaseCommand):
    help = "Delete all customer data and import the cleaned bookings workbook."

    def add_arguments(self, parser):
        parser.add_argument("path", help="Path to the .xlsx workbook")
        parser.add_argument("--sheet", default="Sheet1")
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Delete existing customer data and import. Without it: dry run.",
        )

    def read_rows(self, path, sheet):
        try:
            import openpyxl
        except ImportError as exc:
            raise CommandError("openpyxl is required: pip install openpyxl") from exc

        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        if sheet not in workbook.sheetnames:
            raise CommandError(f"Sheet {sheet!r} not found in {path}")
        rows = workbook[sheet].iter_rows(values_only=True)
        header = [str(h).strip() if h is not None else "" for h in next(rows)]
        if header[: len(COLUMNS)] != COLUMNS:
            raise CommandError(f"Unexpected header: {header}")

        records = []
        for line_no, row in enumerate(rows, start=2):
            if row is None or all(v is None or str(v).strip() == "" for v in row):
                continue
            record = dict(zip(COLUMNS, row))
            email = str(record["Email"] or "").strip()
            if "@" not in email:
                raise CommandError(f"Row {line_no}: invalid email {email!r}")
            records.append(
                {
                    "line": line_no,
                    "date": parse_session_date(record["Session Date"]),
                    "name": re.sub(r"\s+", " ", str(record["Full Name"] or "")).strip(),
                    "email": email.lower(),
                    "package": str(record["Package"] or "").strip(),
                    "addons": parse_addons(record["Addons"]),
                    "gcash": to_number(record["Gcash"]),
                    "cash": to_number(record["Cash"]),
                    "total": to_number(record["Total"]),
                    "discounts": format_discount(record["Discounts"]),
                }
            )
        return records

    def handle(self, *args, **options):
        records = self.read_rows(options["path"], options["sheet"])
        packages = pick_by_name(Package.objects.all())
        addons = pick_by_name(Addon.objects.all())

        missing_packages = sorted({r["package"] for r in records} - set(packages))
        missing_addons = sorted(
            {name for r in records for name, _ in r["addons"]} - set(addons)
        )
        if missing_packages or missing_addons:
            raise CommandError(
                f"Not in DB. Packages: {missing_packages}. Add-ons: {missing_addons}."
            )

        by_email = defaultdict(list)
        for r in records:
            by_email[r["email"]].append(r)

        self.stdout.write(
            f"Workbook: {len(records)} bookings, {len(by_email)} customers, "
            f"{sum(len(r['addons']) for r in records)} add-on lines, "
            f"dates {min(r['date'] for r in records)} to {max(r['date'] for r in records)}."
        )
        self.stdout.write(
            "DB now: "
            f"{Customer.objects.count()} customers, {Booking.objects.count()} bookings, "
            f"{BookingAddon.objects.count()} add-on rows, "
            f"{StagingBooking.objects.count()} staging rows."
        )

        if not options["apply"]:
            self.stdout.write(self.style.WARNING("Dry run. Nothing changed. Use --apply."))
            return

        tz = timezone.get_current_timezone()
        with transaction.atomic():
            Customer.objects.all().delete()
            StagingBooking.objects.all().delete()

            customers = {}
            for email, rows in by_email.items():
                rows = sorted(rows, key=lambda r: (r["date"], r["line"]))
                names = Counter(r["name"] for r in rows if r["name"])
                # Most used name; ties go to the most recent booking.
                latest_rank = {r["name"]: i for i, r in enumerate(rows)}
                name = max(names, key=lambda n: (names[n], latest_rank[n])) if names else None
                first = rows[0]
                customers[email] = Customer(
                    full_name=name,
                    email=email,
                    is_first_time=len(rows) == 1,
                    previous_session_counts=len(rows) - 1,
                    registration_date=timezone.make_aware(
                        dt.datetime.combine(first["date"], dt.time.min), tz
                    ),
                    package=packages[rows[-1]["package"]],
                )
            Customer.objects.bulk_create(customers.values(), batch_size=500)

            bookings = []
            for r in records:
                bookings.append(
                    Booking(
                        customer=customers[r["email"]],
                        package=packages[r["package"]],
                        session_date=timezone.make_aware(
                            dt.datetime.combine(r["date"], dt.time.min), tz
                        ),
                        total_price=r["total"],
                        gcash_payment=r["gcash"],
                        cash_payment=r["cash"],
                        discounts=r["discounts"],
                        session_status="BOOKED",
                        loyalty_points_credited=False,
                    )
                )
            Booking.objects.bulk_create(bookings, batch_size=500)

            booking_addons = []
            for booking, r in zip(bookings, records):
                for name, qty in r["addons"]:
                    addon = addons[name]
                    booking_addons.append(
                        BookingAddon(
                            booking=booking,
                            addon=addon,
                            addon_quantity=qty,
                            addon_price=addon.price,
                            total_addon_cost=addon.price * qty,
                        )
                    )
            BookingAddon.objects.bulk_create(booking_addons, batch_size=1000)

        self.stdout.write("Data imported. Recomputing renewal profiles ...")
        for customer in customers.values():
            recompute_customer_renewal_profile(customer)

        self.stdout.write(
            self.style.SUCCESS(
                f"Imported {len(customers)} customers, {len(bookings)} bookings, "
                f"{len(booking_addons)} add-on rows."
            )
        )
