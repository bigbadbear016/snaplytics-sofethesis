from django.core.management.base import BaseCommand
from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone

from backend.models import Coupon, CouponSent


class Command(BaseCommand):
    help = "Send pending coupon emails via SMTP"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List what would be sent without sending",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        pending = CouponSent.objects.filter(email_sent_at__isnull=True).select_related(
            "coupon", "customer"
        )
        count = pending.count()
        if count == 0:
            self.stdout.write("No pending coupon emails.")
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(f"DRY RUN: Would send {count} email(s):"))
            for cs in pending[:20]:
                self.stdout.write(
                    f"  - {cs.coupon.code} -> {cs.customer.email or '(no email)'}"
                )
            if count > 20:
                self.stdout.write(f"  ... and {count - 20} more")
            return

        sent_count = 0
        for cs in pending:
            customer = cs.customer
            if not customer.email:
                continue
            subject = f"Your coupon: {cs.coupon.code}"
            if cs.coupon.discount_type == Coupon.DISCOUNT_PERCENT:
                desc = f"{cs.coupon.discount_value}% off"
            else:
                desc = f"₱{cs.coupon.discount_value:,.0f} off"
            if cs.coupon.max_discount_amount:
                desc += f" (max ₱{cs.coupon.max_discount_amount:,.0f})"
            body = f"Hi {customer.full_name or 'Customer'},\n\nYou have received a coupon: {cs.coupon.code}"
            body += f"\n{desc}\n\nUse it at checkout!"
            try:
                send_mail(
                    subject,
                    body,
                    getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@snaplytics.local"),
                    [customer.email],
                    fail_silently=False,
                )
                cs.email_sent_at = timezone.now()
                cs.save(update_fields=["email_sent_at"])
                sent_count += 1
                self.stdout.write(f"Sent: {cs.coupon.code} -> {customer.email}")
            except Exception as e:
                self.stderr.write(
                    self.style.ERROR(f"Failed {customer.email}: {e}")
                )
        self.stdout.write(self.style.SUCCESS(f"Sent {sent_count} coupon email(s)."))
