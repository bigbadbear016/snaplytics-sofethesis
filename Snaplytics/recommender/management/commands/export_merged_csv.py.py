# recommender/management/commands/export_merged_csv.py
from django.core.management.base import BaseCommand
import csv
from django.utils import timezone
from recommender import models as rmodels  # adjust if your app name differs
from backend.models import Booking, BookingAddon, Addon, Customer, Package  # use real import paths
from django.conf import settings

class Command(BaseCommand):
    help = "Export merged bookings CSV for recommender"

    def handle(self, *args, **options):
        out_path = settings.BASE_DIR / "reco_export" / "merged_bookings.csv"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        fieldnames = [
            "booking_id", "user_id", "user_email", "package_id", "package_name",
            "session_date", "created_at", "addons", "addon_qtys", "total_price"
        ]
        with open(out_path, "w", newline='', encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            qs = Booking.objects.select_related("customer","package").prefetch_related("bookingaddon_set__addon").all()
            for b in qs.iterator():
                addons = []
                qtys = []
                for ba in b.bookingaddon_set.all():
                    addons.append(str(ba.addon.id))
                    qtys.append(str(ba.addon_quantity))
                row = {
                    "booking_id": b.id,
                    "user_id": b.customer.customer_id if b.customer else "",
                    "user_email": b.customer.email if b.customer else "",
                    "package_id": b.package.id if b.package else "",
                    "package_name": b.package.name if b.package else "",
                    "session_date": (b.session_date or b.created_at).isoformat(),
                    "created_at": b.created_at.isoformat(),
                    "addons": ";".join(addons) if addons else "",
                    "addon_qtys": ";".join(qtys) if qtys else "",
                    "total_price": b.total_price or 0.0
                }
                writer.writerow(row)
        self.stdout.write(self.style.SUCCESS(f"Wrote {out_path}"))
