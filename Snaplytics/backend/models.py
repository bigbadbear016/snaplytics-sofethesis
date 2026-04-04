# backend/models.py

from django.conf import settings
from django.db import models
from django.utils import timezone


class Category(models.Model):
    name = models.CharField(max_length=256, unique=True)
    image_url = models.TextField(null=True, blank=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.name


class Package(models.Model):
    category = models.CharField(max_length=256)
    name = models.CharField(max_length=256)
    price = models.FloatField()
    promo_price = models.FloatField(null=True, blank=True)
    promo_price_condition = models.TextField(null=True, blank=True)
    max_people = models.IntegerField(null=True, blank=True)
    inclusions = models.JSONField(null=True, blank=True)
    included_portraits = models.JSONField(null=True, blank=True)
    freebies = models.JSONField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    image_url = models.TextField(null=True, blank=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.name


class Customer(models.Model):
    customer_id = models.AutoField(primary_key=True)
    full_name = models.CharField(max_length=256, null=True, blank=True)
    email = models.EmailField(unique=True, null=True, blank=True)
    contact_number = models.CharField(max_length=51, null=True, blank=True)
    instagram_handle = models.CharField(max_length=256, null=True, blank=True)
    acquisition_source = models.CharField(max_length=256, null=True, blank=True)
    is_first_time = models.BooleanField(null=True, blank=True)
    previous_session_counts = models.IntegerField(null=True, blank=True)
    registration_date = models.DateTimeField(null=True, blank=True)
    consent = models.TextField(null=True, blank=True)
    package = models.ForeignKey(Package, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.full_name or "Customer"


class Addon(models.Model):
    name = models.CharField(max_length=256)
    price = models.FloatField()
    additional_info = models.TextField(null=True, blank=True)
    applies_to = models.CharField(max_length=256, null=True, blank=True)
    image_url = models.TextField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.name


class Coupon(models.Model):
    DISCOUNT_PERCENT = "percent"
    DISCOUNT_FIXED = "fixed"
    DISCOUNT_CHOICES = [(DISCOUNT_PERCENT, "Percent"), (DISCOUNT_FIXED, "Fixed")]

    code = models.CharField(max_length=64, unique=True)
    discount_type = models.CharField(max_length=16, choices=DISCOUNT_CHOICES)
    discount_value = models.FloatField()
    use_limit = models.IntegerField(null=True, blank=True)
    max_discount_amount = models.FloatField(null=True, blank=True)
    per_customer_limit = models.IntegerField(default=1)
    expires_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.code


class CouponSent(models.Model):
    coupon = models.ForeignKey(Coupon, on_delete=models.CASCADE)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    sender_label = models.CharField(max_length=128, null=True, blank=True)
    sent_at = models.DateTimeField(default=timezone.now)
    email_sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [["coupon", "customer"]]

    def __str__(self):
        return f"{self.coupon.code} -> {self.customer.email}"


class EmailTemplate(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="email_templates",
    )
    name = models.CharField(max_length=128)
    subject = models.TextField(blank=True, default="")
    body = models.TextField(blank=True, default="")
    html_body = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [["user", "name"]]

    def __str__(self):
        return f"{self.user_id}:{self.name}"


class Booking(models.Model):
    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, related_name="bookings"
    )
    package = models.ForeignKey(Package, on_delete=models.SET_NULL, null=True)
    coupon = models.ForeignKey(
        Coupon, on_delete=models.SET_NULL, null=True, blank=True, related_name="bookings"
    )
    coupon_discount_amount = models.FloatField(null=True, blank=True)
    session_date = models.DateTimeField(null=True, blank=True)
    total_price = models.FloatField(null=True, blank=True)
    gcash_payment = models.FloatField(null=True, blank=True)
    cash_payment = models.FloatField(null=True, blank=True)
    discounts = models.TextField(null=True, blank=True)
    session_status = models.CharField(max_length=256, null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)


class BookingAddon(models.Model):
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE)
    addon = models.ForeignKey(Addon, on_delete=models.CASCADE)
    addon_quantity = models.IntegerField()
    addon_price = models.FloatField()
    total_addon_cost = models.FloatField()
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)


class CouponUsage(models.Model):
    coupon = models.ForeignKey(Coupon, on_delete=models.CASCADE)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE)
    discount_amount = models.FloatField()
    used_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.coupon.code} used by {self.customer.email}"


class Renewal(models.Model):
    customer = models.OneToOneField(Customer, on_delete=models.CASCADE)
    total_bookings = models.IntegerField()
    avg_booking_value = models.FloatField()
    booking_frequency = models.FloatField()
    renewed_within_366 = models.BooleanField()
    total_spent = models.FloatField()
    preferred_package_type = models.CharField(max_length=256)
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)


class StagingBooking(models.Model):
    file_name = models.CharField(max_length=256)
    file_checksum = models.CharField(max_length=256)
    raw_row_number = models.IntegerField()
    raw_data = models.JSONField()
    canonical_data = models.JSONField()
    processing_status = models.CharField(max_length=31, default="PENDING")
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)


class StaffProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="staff_profile",
    )
    must_change_password = models.BooleanField(default=True)
    profile_completed = models.BooleanField(default=False)
    profile_photo_url = models.TextField(null=True, blank=True)
    phone_number = models.CharField(max_length=32, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    nickname = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_updated = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"StaffProfile<{self.user_id}>"


class PasswordResetRequest(models.Model):
    STATUS_PENDING = "PENDING"
    STATUS_APPROVED = "APPROVED"
    STATUS_REJECTED = "REJECTED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="password_reset_requests",
        null=True,
        blank=True,
    )
    requested_email = models.EmailField()
    status = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
    )
    requested_at = models.DateTimeField(default=timezone.now)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_password_reset_requests",
    )
    notes = models.TextField(null=True, blank=True)

    def __str__(self):
        return f"PasswordResetRequest<{self.requested_email}:{self.status}>"


class ActionLog(models.Model):
    actor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="action_logs",
    )
    actor_label = models.CharField(max_length=128, null=True, blank=True)
    action_type = models.CharField(max_length=64)
    action_text = models.TextField()
    metadata = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.actor_label or 'Unknown'}: {self.action_type}"
