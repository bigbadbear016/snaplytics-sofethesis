# backend/management/commands/remigrate_coupons.py
"""
Unapply coupon migrations (0012, 0013) and re-run them.
Use when the coupon tables were deleted and need to be recreated.
"""
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "Unapply coupon migrations and re-run them (use after deleting coupon tables)"

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            # Drop coupon-related tables if they exist (clean slate)
            for table in ["backend_couponusage", "backend_couponsent", "backend_coupon"]:
                cursor.execute(
                    "DROP TABLE IF EXISTS %s CASCADE" % table
                )
            # Remove coupon columns from booking if they exist
            cursor.execute("""
                ALTER TABLE backend_booking DROP COLUMN IF EXISTS coupon_id;
                ALTER TABLE backend_booking DROP COLUMN IF EXISTS coupon_discount_amount;
            """)
            # Unapply migration records
            cursor.execute("""
                DELETE FROM django_migrations
                WHERE app = 'backend'
                AND name IN ('0012_coupon_models', '0013_add_coupon_max_discount_amount')
            """)
            deleted = cursor.rowcount
        self.stdout.write(self.style.SUCCESS(f"Cleaned up and unapplied {deleted} coupon migration(s)"))

        self.stdout.write("Running migrate backend...")
        from django.core.management import call_command
        call_command("migrate", "backend", verbosity=2)
        self.stdout.write(self.style.SUCCESS("Done. Coupon tables recreated."))
