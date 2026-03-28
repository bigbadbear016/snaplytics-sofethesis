# endpoints/serializers.py
import base64
import math
import re
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from backend.models import Category, Customer, Package, Addon, Booking, BookingAddon, Coupon, CouponUsage
from backend.renewal_utils import recompute_customer_renewal_profile


MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024


def validate_image_upload_size(value):
    if not value:
        return value
    if not isinstance(value, str):
        raise serializers.ValidationError("Invalid image payload.")
    if not value.startswith("data:"):
        return value

    marker = ";base64,"
    marker_index = value.find(marker)
    if marker_index < 0:
        raise serializers.ValidationError("Invalid image data URL.")

    encoded = value[marker_index + len(marker):]
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except Exception:
        raise serializers.ValidationError("Invalid base64 image payload.")

    if len(decoded) > MAX_IMAGE_UPLOAD_BYTES:
        raise serializers.ValidationError("Image must be 2MB or smaller.")
    return value


# ── Package ───────────────────────────────────────────────────────────────────

class PackageSerializer(serializers.ModelSerializer):
    def validate_image_url(self, value):
        return validate_image_upload_size(value)

    class Meta:
        model = Package
        fields = [
            "id", "name", "category", "price", "promo_price",
            "promo_price_condition", "max_people", "inclusions",
            "included_portraits", "freebies", "notes",
            "image_url",
        ]


class CategorySerializer(serializers.ModelSerializer):
    package_count = serializers.SerializerMethodField()

    def validate_image_url(self, value):
        return validate_image_upload_size(value)

    class Meta:
        model = Category
        fields = ["id", "name", "image_url", "package_count"]

    def get_package_count(self, obj):
        return Package.objects.filter(category__iexact=obj.name).count()


# ── Coupon ────────────────────────────────────────────────────────────────────

class CouponSerializer(serializers.ModelSerializer):
    times_used = serializers.SerializerMethodField()

    class Meta:
        model = Coupon
        fields = [
            "id", "code", "discount_type", "discount_value",
            "use_limit", "max_discount_amount", "per_customer_limit",
            "expires_at", "times_used", "created_at", "last_updated",
        ]

    def get_times_used(self, obj):
        from backend.models import CouponUsage
        return CouponUsage.objects.filter(coupon=obj).count()


# ── Addon ─────────────────────────────────────────────────────────────────────

class AddonSerializer(serializers.ModelSerializer):
    def validate_image_url(self, value):
        return validate_image_upload_size(value)

    class Meta:
        model  = Addon
        fields = ["id", "name", "price", "additional_info", "applies_to", "image_url"]


# ── BookingAddon (nested read) ────────────────────────────────────────────────

class BookingAddonReadSerializer(serializers.ModelSerializer):
    """Flattened addon row for frontend consumption."""
    id       = serializers.IntegerField(source="addon.id",    read_only=True)
    addonId  = serializers.IntegerField(source="addon_id",    read_only=True)
    name     = serializers.CharField(source="addon.name",     read_only=True)
    price    = serializers.FloatField(source="addon.price",   read_only=True)
    quantity = serializers.IntegerField(source="addon_quantity")

    class Meta:
        model  = BookingAddon
        fields = ["id", "addonId", "name", "price", "quantity"]


# ── Booking ───────────────────────────────────────────────────────────────────

class BookingSerializer(serializers.ModelSerializer):

    # ── read-only derived fields ──────────────────────────────────────────────
    id            = serializers.IntegerField(source="pk",             read_only=True)
    customer_name = serializers.CharField(
                        source="customer.full_name", read_only=True, default=None)
    customer_email    = serializers.CharField(
                        source="customer.email",          read_only=True, default=None)
    customer_contact  = serializers.CharField(
                            source="customer.contact_number", read_only=True, default=None)
    preferred_date    = serializers.SerializerMethodField()
    category_name     = serializers.SerializerMethodField()
    packageName       = serializers.SerializerMethodField()
    packagePrice      = serializers.SerializerMethodField()
    addons        = BookingAddonReadSerializer(
                        source="bookingaddon_set", many=True, read_only=True)
    date          = serializers.SerializerMethodField()
    subtotal      = serializers.SerializerMethodField()
    discount      = serializers.SerializerMethodField()
    type          = serializers.SerializerMethodField()

    # ── "total" is the read-only display version of total_price ──────────────
    total = serializers.FloatField(source="total_price", read_only=True)
    customerId = serializers.IntegerField(source="customer_id", read_only=True)

    # ── writable fields ───────────────────────────────────────────────────────
    customer_id   = serializers.PrimaryKeyRelatedField(
                        source="customer",
                        queryset=Customer.objects.all(),
                        write_only=True, required=False)
    package_id    = serializers.PrimaryKeyRelatedField(
                        source="package",
                        queryset=Package.objects.all(),
                        write_only=True, required=False, allow_null=True)
    addons_input  = serializers.ListField(
                        child=serializers.DictField(),
                        write_only=True, required=False)
    session_status = serializers.CharField(required=False, allow_null=True,
                                           allow_blank=True)
    session_date   = serializers.DateTimeField(required=False, allow_null=True)
    gcash_payment  = serializers.FloatField(required=False, allow_null=True)
    cash_payment   = serializers.FloatField(required=False, allow_null=True)
    discounts      = serializers.CharField(required=False, allow_null=True,
                                           allow_blank=True)
    coupon_id      = serializers.PrimaryKeyRelatedField(
                        source="coupon",
                        queryset=Coupon.objects.all(),
                        write_only=True, required=False, allow_null=True)
    appliedCouponId = serializers.IntegerField(
        source="coupon_id", read_only=True, allow_null=True
    )
    appliedCouponCode = serializers.SerializerMethodField()

    # ── total_price is WRITE-ONLY — "total" is the read alias above ───────────
    total_price    = serializers.FloatField(
                        required=False, allow_null=True, write_only=True)

    class Meta:
        model  = Booking
        fields = [
            # read
            "id", "customerId", "customer_name", "customer_email", "customer_contact",
            "preferred_date", "category_name","packageName", "packagePrice",
            "addons", "date", "subtotal", "discount", "total", "type",
            "session_status", "appliedCouponId", "appliedCouponCode",
            # write
            "customer_id", "package_id", "addons_input",
            "session_date", "total_price", "coupon_id",
            "gcash_payment", "cash_payment", "discounts",
        ]
    # --- computed read fields -------------------------------------------------

    def get_appliedCouponCode(self, obj):
        if obj.coupon_id and getattr(obj, "coupon", None):
            return obj.coupon.code
        return None

    def get_category_name(self, obj):
        return obj.package.category if obj.package else None

    def get_packageName(self, obj):
        return obj.package.name if obj.package else None

    def get_packagePrice(self, obj):
        if obj.package:
            return obj.package.promo_price or obj.package.price
        return None

    def get_date(self, obj):
        dt = obj.session_date or obj.created_at
        if not dt:
            return "N/A"
        # %-m / %-d are Linux-only. Use lstrip('0') for cross-platform.
        month = str(dt.month)    # no leading zero natively from .month
        day   = str(dt.day)
        year  = str(dt.year)
        return f"{month}/{day}/{year}"

    def get_subtotal(self, obj):
        base = 0.0
        if obj.package:
            base = obj.package.promo_price or obj.package.price or 0.0
        addon_total = sum(
            (ba.addon_price or 0) * (ba.addon_quantity or 1)
            for ba in obj.bookingaddon_set.all()
        )
        return base + addon_total

    def get_discount(self, obj):
        if obj.coupon_discount_amount is not None:
            return float(obj.coupon_discount_amount)
        if not obj.discounts:
            return 0.0
        nums = re.findall(r"[\d.]+", str(obj.discounts))
        return float(nums[0]) if nums else 0.0

    def get_type(self, obj):
        if obj.customer and obj.customer.acquisition_source:
            src = obj.customer.acquisition_source.lower()
            if "reserved" in src or "reservation" in src:
                return "Reserved"
        return "Walk-In"
    def get_preferred_date(self, obj):
        # session_date is where the kiosk stores the customer's preferred date
        if not obj.session_date:
            return None
        dt = obj.session_date
        return f"{dt.month}/{dt.day}/{dt.year}"

    # --- nan cleanup ----------------------------------------------------------

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return {
            k: (None if isinstance(v, float) and math.isnan(v) else v)
            for k, v in data.items()
        }

    # --- write helpers --------------------------------------------------------

    def create(self, validated_data):
        addons_input = validated_data.pop("addons_input", [])
        coupon = validated_data.pop("coupon", None)

        # Compute subtotal for coupon validation
        subtotal = 0.0
        pkg = validated_data.get("package")
        if pkg:
            subtotal = pkg.promo_price or pkg.price or 0.0
        for item in addons_input:
            try:
                addon_id = item.get("addonId") or item.get("addon_id") or item.get("id")
                addon = Addon.objects.get(pk=int(addon_id))
                qty = int(item.get("quantity", 1))
                subtotal += (addon.price or 0) * qty
            except (Addon.DoesNotExist, ValueError, TypeError):
                pass

        discount_amount = 0.0
        discount_note = None
        if coupon and validated_data.get("customer"):
            from backend.coupon_utils import validate_coupon_for_customer, compute_coupon_discount
            valid, discount_amount, _, error = validate_coupon_for_customer(
                coupon.code, validated_data["customer"].customer_id, subtotal
            )
            if not valid:
                raise serializers.ValidationError({"coupon_id": error})
            discount_note = f"{coupon.code}: -₱{discount_amount:,.0f}"

        validated_data["total_price"] = subtotal - discount_amount
        if discount_note:
            validated_data["discounts"] = discount_note
            validated_data["coupon_discount_amount"] = discount_amount
            validated_data["coupon"] = coupon

        booking = Booking.objects.create(**validated_data)
        self._sync_addons(booking, addons_input)

        # History + per-customer limits use CouponUsage. Record every redemption,
        # including discount_amount == 0 (valid coupon, zero computed discount).
        if booking.coupon_id is not None:
            raw_amt = booking.coupon_discount_amount
            amt = 0.0 if raw_amt is None else float(raw_amt)
            CouponUsage.objects.get_or_create(
                booking=booking,
                defaults={
                    "coupon_id": booking.coupon_id,
                    "customer_id": booking.customer_id,
                    "discount_amount": amt,
                },
            )

        if booking.customer_id:
            recompute_customer_renewal_profile(booking.customer)
        return booking

    def _compute_booking_subtotal(self, booking):
        base = 0.0
        if booking.package_id:
            pkg = booking.package
            if pkg:
                base = float(pkg.promo_price or pkg.price or 0.0)
        addon_total = 0.0
        for ba in booking.bookingaddon_set.all():
            addon_total += float(ba.addon_price or 0.0) * int(ba.addon_quantity or 1)
        return base + addon_total

    def _apply_coupon_to_instance(self, instance, coupon):
        """coupon=None clears coupon and resets total to subtotal."""
        subtotal = self._compute_booking_subtotal(instance)
        CouponUsage.objects.filter(booking=instance).delete()
        if coupon is None:
            instance.coupon = None
            instance.coupon_discount_amount = None
            instance.total_price = subtotal
            return
        from backend.coupon_utils import validate_coupon_for_customer

        valid, discount_amount, coup_obj, error = validate_coupon_for_customer(
            coupon.code, instance.customer.customer_id, subtotal
        )
        if not valid:
            raise serializers.ValidationError({"coupon_id": error})
        instance.coupon = coup_obj
        instance.coupon_discount_amount = discount_amount
        instance.discounts = f"{coup_obj.code}: -₱{discount_amount:,.0f}"
        instance.total_price = subtotal - discount_amount
        CouponUsage.objects.create(
            coupon=coup_obj,
            customer=instance.customer,
            booking=instance,
            discount_amount=discount_amount,
        )

    def update(self, instance, validated_data):
        addons_input = validated_data.pop("addons_input", None)
        _COUP_UNSET = object()
        coupon = validated_data.pop("coupon", _COUP_UNSET)
        if coupon is not _COUP_UNSET:
            validated_data.pop("total_price", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.last_updated = timezone.now()
        instance.save()

        if addons_input is not None:
            instance.bookingaddon_set.all().delete()
            self._sync_addons(instance, addons_input)

        if coupon is not _COUP_UNSET:
            instance = (
                Booking.objects.select_related("package", "customer")
                .prefetch_related("bookingaddon_set")
                .get(pk=instance.pk)
            )
            self._apply_coupon_to_instance(instance, coupon)
            instance.last_updated = timezone.now()
            instance.save()

        if instance.customer_id:
            recompute_customer_renewal_profile(instance.customer)
        return instance

    def _sync_addons(self, booking, addons_input):
        for item in addons_input:
            try:
                addon_id = (item.get("addonId")
                            or item.get("addon_id")
                            or item.get("id"))
                addon = Addon.objects.get(pk=int(addon_id))
                qty   = int(item.get("quantity", 1))
                BookingAddon.objects.create(
                    booking          = booking,
                    addon            = addon,
                    addon_quantity   = qty,
                    addon_price      = addon.price,
                    total_addon_cost = addon.price * qty,
                )
            except Exception:
                continue   # skip malformed/missing addon entries


# ── Customer serializers ──────────────────────────────────────────────────────

class CustomerListSerializer(serializers.ModelSerializer):
    """
    Lightweight – used for GET /api/customers/all/.
    bookings = live count of related Booking rows.
    """
    id        = serializers.IntegerField(source="customer_id")
    name      = serializers.CharField(source="full_name")
    contactNo = serializers.CharField(
                    source="contact_number", allow_null=True, default="")
    bookings  = serializers.SerializerMethodField()
    updatedAt = serializers.DateTimeField(source="last_updated")

    class Meta:
        model  = Customer
        fields = ["id", "name", "email", "contactNo",
                  "consent", "bookings", "updatedAt"]

    def get_bookings(self, obj):
        # prefer pre-annotated value injected by the view
        if hasattr(obj, "booking_count"):
            return obj.booking_count
        return obj.bookings.filter(
            Q(session_status="BOOKED")
            | Q(session_status__isnull=True)
            | Q(session_status="")
        ).count()


class CustomerDetailSerializer(serializers.ModelSerializer):
    """
    Full – used for GET /api/customers/<id>/.
    Embeds the complete booking list with nested addons.
    """
    id        = serializers.IntegerField(source="customer_id")
    name      = serializers.CharField(source="full_name")
    contactNo = serializers.CharField(
                    source="contact_number", allow_null=True, default="")
    bookings  = BookingSerializer(many=True, read_only=True)
    updatedAt = serializers.DateTimeField(source="last_updated")

    class Meta:
        model  = Customer
        fields = ["id", "name", "email", "contactNo",
                  "consent", "bookings", "updatedAt"]


class CustomerWriteSerializer(serializers.ModelSerializer):
    """
    POST /api/customers/   and   PUT /api/customers/<id>/
    Accepts camelCase from the frontend, writes snake_case to the model.
    """
    name      = serializers.CharField(source="full_name")
    contactNo = serializers.CharField(
                    source="contact_number", required=False, allow_blank=True)
    is_first_time = serializers.BooleanField(required=False, allow_null=True)
    acquisition_source = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model  = Customer
        fields = [
            "name",
            "email",
            "contactNo",
            "consent",
            "is_first_time",
            "acquisition_source",
        ]

    def _touch(self, data):
        data["last_updated"] = timezone.now()
        return data

    def create(self, validated_data):
        return super().create(self._touch(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._touch(validated_data))
