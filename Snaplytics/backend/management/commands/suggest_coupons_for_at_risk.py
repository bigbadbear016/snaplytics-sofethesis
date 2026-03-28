import os
from django.core.management.base import BaseCommand
from django.db.models import Avg, Sum
from django.utils import timezone

from backend.models import Customer, Coupon, CouponSent, Renewal
from backend.renewal_utils import recompute_customer_renewal_profile


ACCEPTED_BOOKING_STATUSES = ("Ongoing", "BOOKED")


def get_renewal_band(customer):
    """Reuse heuristic from customer_renewal_prediction view."""
    renewal = recompute_customer_renewal_profile(customer)
    bookings_qs = customer.bookings.filter(
        session_status__in=ACCEPTED_BOOKING_STATUSES
    )
    total_bookings = int(renewal.total_bookings or 0)
    if total_bookings == 0:
        return "very_unlikely"
    avg_booking_value = float(
        bookings_qs.aggregate(v=Avg("total_price")).get("v") or 0.0
    )
    booking_frequency = float(renewal.booking_frequency or 0.0)
    base_prob = 0.05
    base_prob += min(booking_frequency / 8.0, 0.4)
    base_prob += min(total_bookings / 10.0, 0.25)
    base_prob += min((avg_booking_value or 0.0) / 15000.0, 0.15)
    if renewal.renewed_within_366:
        base_prob += 0.15
    probability = max(0.0, min(base_prob, 0.99))
    if probability >= 0.7:
        return "very_likely"
    if probability >= 0.5:
        return "likely"
    if probability >= 0.3:
        return "unlikely"
    return "very_unlikely"


class Command(BaseCommand):
    help = "Create CouponSent records for at-risk customers (low return probability)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--recompute",
            action="store_true",
            help="Recompute all renewal profiles before suggesting",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List at-risk customers without creating CouponSent",
        )

    def handle(self, *args, **options):
        coupon_id = os.getenv("COUPON_AT_RISK_ID")
        if not coupon_id:
            self.stderr.write(
                self.style.ERROR("Set COUPON_AT_RISK_ID in .env to the coupon ID to send.")
            )
            return
        try:
            coupon = Coupon.objects.get(pk=int(coupon_id))
        except (Coupon.DoesNotExist, ValueError):
            self.stderr.write(
                self.style.ERROR(f"Coupon with ID {coupon_id} not found.")
            )
            return

        recompute = options["recompute"]
        dry_run = options["dry_run"]

        if recompute:
            self.stdout.write("Recomputing renewal profiles...")
            for customer in Customer.objects.iterator(chunk_size=500):
                recompute_customer_renewal_profile(customer)
            self.stdout.write("Done.")

        at_risk = []
        for customer in Customer.objects.iterator(chunk_size=500):
            band = get_renewal_band(customer)
            if band in ("very_unlikely", "unlikely"):
                at_risk.append(customer)

        self.stdout.write(f"Found {len(at_risk)} at-risk customer(s).")

        if dry_run:
            for c in at_risk[:30]:
                self.stdout.write(f"  - {c.email or c.full_name} (id={c.customer_id})")
            if len(at_risk) > 30:
                self.stdout.write(f"  ... and {len(at_risk) - 30} more")
            return

        created = 0
        for customer in at_risk:
            _, created_flag = CouponSent.objects.get_or_create(
                coupon=coupon,
                customer=customer,
                defaults={"sent_at": timezone.now()},
            )
            if created_flag:
                created += 1
        self.stdout.write(
            self.style.SUCCESS(f"Created {created} CouponSent record(s).")
        )
