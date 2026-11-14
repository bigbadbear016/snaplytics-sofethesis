"""
Find and fix data problems that distort renewal predictions.

    python manage.py clean_booking_data                  # dry run: report only
    python manage.py clean_booking_data --apply          # back up, then fix
    python manage.py clean_booking_data --restore FILE   # undo an --apply run

Fixes (only with --apply):
  1. Duplicate bookings: BOOKED rows identical in every identity field
     (see renewal_utils.BOOKING_IDENTITY_FIELDS). The lowest id is kept. A copy
     is deleted only if it has no add-ons, no coupon, and no coupon usage.
     Loyalty points credited for a deleted copy are subtracted.
  2. Duplicate customers: active customers with the same name AND the same
     phone or email. Bookings, coupons sent/used, and loyalty points move to
     one record; empty contact fields are filled from the other; the other
     record moves to Internal Records. Same name alone is never merged.
  3. Text leftovers: status 'pending' -> 'Pending'; the text 'nan' in
     discounts and customer text fields -> empty.
  4. With --delete-pending: delete every Pending booking (any spelling) and
     its add-on rows. Use only when all Pending bookings are test data.
Renewal profiles of every affected customer are recomputed.

Every change is written to a backup file under Snaplytics/backups/ before it
is applied. The file holds customer personal data and is git-ignored.
"""
import json
import math
import re
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, transaction
from django.utils import timezone

from backend.loyalty_utils import _quantize_balance, earn_points_from_booking_total
from backend.models import (
    ActionLog,
    Addon,
    Booking,
    BookingAddon,
    CouponSent,
    CouponUsage,
    Customer,
    Package,
    RenewalShadowPrediction,
)
from backend.renewal_utils import booking_identity, recompute_customer_renewal_profile

BACKUP_DIR = Path(settings.BASE_DIR) / "backups"
CUSTOMER_FIELDS = (
    "full_name",
    "email",
    "contact_number",
    "instagram_handle",
    "acquisition_source",
    "is_first_time",
    "previous_session_counts",
    "registration_date",
    "consent",
    "package_id",
    "loyalty_points",
    "deleted_at",
    "email_recycled",
    "last_updated",
)
FILL_FROM_DUPLICATE = (
    "email",
    "contact_number",
    "instagram_handle",
    "acquisition_source",
    "registration_date",
    "consent",
)
NAN_TEXT_CUSTOMER_FIELDS = (
    "full_name",
    "email",
    "contact_number",
    "instagram_handle",
    "acquisition_source",
    "consent",
)
ACTOR_LABEL = "Data cleanup"


def norm_name(value):
    return " ".join(re.sub(r"[^a-z ]", " ", (value or "").lower()).split())


def norm_phone(value):
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("63"):
        digits = "0" + digits[2:]
    if len(digits) == 10 and digits.startswith("9"):
        digits = "0" + digits
    return digits if len(digits) >= 7 else ""


def is_nan_text(value):
    return isinstance(value, str) and value.strip().lower() in ("nan", "none", "null")


def model_row(model, pk):
    """All concrete field values of one row, by attribute name (e.g. customer_id)."""
    obj = model.objects.get(pk=pk)
    return {f.attname: getattr(obj, f.attname) for f in model._meta.concrete_fields}


def from_json(model, data):
    """Turn backup values back into Python values for model fields."""
    out = {}
    for attname, value in data.items():
        field = next(f for f in model._meta.concrete_fields if f.attname == attname)
        out[attname] = None if value is None else field.to_python(value)
    return out


class Command(BaseCommand):
    help = "Find and fix duplicate bookings, duplicate customers, and text leftovers."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Back up, then fix.")
        parser.add_argument("--restore", metavar="FILE", help="Undo an --apply run.")
        parser.add_argument(
            "--delete-pending",
            action="store_true",
            help="Also delete every Pending booking (test data) and its add-on rows.",
        )

    # ── Planning ───────────────────────────────────────────────────────────
    def plan_duplicate_bookings(self):
        with_addons = set(BookingAddon.objects.values_list("booking_id", flat=True))
        with_usage = set(CouponUsage.objects.values_list("booking_id", flat=True))
        seen = {}
        remove, skipped = [], []
        for b in Booking.objects.filter(session_status="BOOKED").order_by("id"):
            key = booking_identity(b)
            if key not in seen:
                seen[key] = b.id
                continue
            if b.id in with_addons or b.id in with_usage or b.coupon_id:
                skipped.append(b.id)
            else:
                remove.append((b.id, seen[key]))
        return remove, skipped

    def plan_duplicate_customers(self):
        active = list(
            Customer.objects.filter(deleted_at__isnull=True).values(
                "customer_id", "full_name", "email", "contact_number"
            )
        )
        parent = {c["customer_id"]: c["customer_id"] for c in active}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        by_key = defaultdict(list)
        for c in active:
            name = norm_name(c["full_name"])
            if not name:
                continue
            phone = norm_phone(c["contact_number"])
            email = (c["email"] or "").strip().lower()
            if phone:
                by_key[(name, "phone", phone)].append(c["customer_id"])
            if email:
                by_key[(name, "email", email)].append(c["customer_id"])
        for ids in by_key.values():
            for other in ids[1:]:
                parent[find(other)] = find(ids[0])

        groups = defaultdict(list)
        for c in active:
            groups[find(c["customer_id"])].append(c["customer_id"])
        groups = [sorted(g) for g in groups.values() if len(g) > 1]

        booking_counts = defaultdict(int)
        for cid in Booking.objects.filter(
            customer_id__in=[i for g in groups for i in g]
        ).values_list("customer_id", flat=True):
            booking_counts[cid] += 1
        emails = {c["customer_id"]: bool(c["email"]) for c in active}
        merges = []
        for group in groups:
            keep = sorted(group, key=lambda i: (-booking_counts[i], not emails[i], i))[0]
            merges.extend((keep, other) for other in group if other != keep)
        return merges

    def plan_text_fixes(self, delete_pending=False):
        fixes = []
        if not delete_pending:
            for b in Booking.objects.exclude(session_status="Pending").filter(
                session_status__iexact="pending"
            ):
                fixes.append(("Booking", b.id, "session_status", b.session_status, "Pending"))
        pending_ids = (
            set(Booking.objects.filter(session_status__iexact="pending").values_list("id", flat=True))
            if delete_pending
            else set()
        )
        for b in Booking.objects.filter(discounts__isnull=False).exclude(id__in=pending_ids).only("id", "discounts"):
            if is_nan_text(b.discounts):
                fixes.append(("Booking", b.id, "discounts", b.discounts, None))
        for c in Customer.objects.all().only("customer_id", *NAN_TEXT_CUSTOMER_FIELDS):
            for field in NAN_TEXT_CUSTOMER_FIELDS:
                if is_nan_text(getattr(c, field)):
                    fixes.append(("Customer", c.customer_id, field, getattr(c, field), None))
        return fixes

    def report_unfixed(self):
        """Problems this command does not change; they need a person to decide."""
        booked = list(
            Booking.objects.filter(session_status="BOOKED").values(
                "id", "total_price", "session_date", "package_id"
            )
        )
        nan_or_none = [
            b["id"] for b in booked
            if b["total_price"] is None or math.isnan(b["total_price"])
        ]
        zero = [b["id"] for b in booked if b["total_price"] == 0]
        no_date = [b["id"] for b in booked if b["session_date"] is None]
        no_package = [b["id"] for b in booked if not b["package_id"]]
        no_price_pkg = list(
            Package.objects.filter(deleted_at__isnull=True)
            .filter(price__isnull=True)
            .values_list("id", flat=True)
        ) + list(Package.objects.filter(deleted_at__isnull=True, price=0).values_list("id", flat=True))
        addon_names = defaultdict(list)
        for a in Addon.objects.filter(deleted_at__isnull=True).values("id", "name"):
            addon_names[norm_name(a["name"])].append(a["id"])
        dup_addons = [ids for ids in addon_names.values() if len(ids) > 1]
        active = Customer.objects.filter(deleted_at__isnull=True)
        no_name = [c.customer_id for c in active if not norm_name(c.full_name)]
        no_contact = [
            c.customer_id for c in active if not c.email and not norm_phone(c.contact_number)
        ]
        self.stdout.write("\nNot changed (needs a person to decide):")
        for label, ids in (
            ("BOOKED with missing/NaN price", nan_or_none),
            ("BOOKED with price 0", zero),
            ("BOOKED without session date", no_date),
            ("BOOKED without package", no_package),
            ("active package without price", no_price_pkg),
            ("add-on names used twice (groups)", dup_addons),
            ("customers without a name", no_name),
            ("customers without email and phone", no_contact),
        ):
            self.stdout.write(f"  {label}: {len(ids)}" + (f"  e.g. {ids[:6]}" if ids else ""))
        self.stdout.write(
            "  Prices that differ from package + add-ons - discount are not changed: "
            "the import has no add-on or discount detail to check them against."
        )

    # ── Apply ──────────────────────────────────────────────────────────────
    def handle(self, *args, **options):
        if options["restore"]:
            return self.restore(Path(options["restore"]))

        remove_bookings, skipped = self.plan_duplicate_bookings()
        merges = self.plan_duplicate_customers()
        text_fixes = self.plan_text_fixes(options["delete_pending"])
        pending = (
            list(Booking.objects.filter(session_status__iexact="pending").order_by("id"))
            if options["delete_pending"]
            else []
        )

        db = connection.settings_dict
        self.stdout.write(f"Database: {connection.vendor} {db.get('NAME')} on {db.get('HOST') or 'local'}")
        self.stdout.write(
            f"Duplicate bookings to delete: {len(remove_bookings)}"
            + (f"  e.g. {[r for r, _ in remove_bookings[:8]]}" if remove_bookings else "")
        )
        self.stdout.write(f"Duplicate bookings kept (have add-ons/coupon): {len(skipped)}")
        credited = Booking.objects.filter(
            id__in=[r for r, _ in remove_bookings], loyalty_points_credited=True
        ).count()
        self.stdout.write(f"  of those deleted, loyalty-credited (points will be subtracted): {credited}")
        self.stdout.write(
            f"Customer records to merge: {len(merges)}"
            + (f"  e.g. keep<-remove {merges[:6]}" if merges else "")
        )
        if options["delete_pending"]:
            self.stdout.write(
                f"Pending bookings to delete: {len(pending)}"
                + (f"  ids {[b.id for b in pending]}" if pending else "")
                + f", with {BookingAddon.objects.filter(booking__in=pending).count()} add-on rows"
            )
        self.stdout.write(f"Text fixes: {len(text_fixes)}")
        fix_counts = defaultdict(int)
        for model_name, _, field, _, _ in text_fixes:
            fix_counts[f"{model_name}.{field}"] += 1
        for label, count in sorted(fix_counts.items()):
            self.stdout.write(f"  {label}: {count}")
        self.report_unfixed()

        if not options["apply"]:
            self.stdout.write(self.style.WARNING("\nDry run: nothing changed. Use --apply to fix."))
            return

        backup = {
            "created_at": timezone.now().isoformat(),
            "database": {"vendor": connection.vendor, "name": db.get("NAME"), "host": db.get("HOST")},
            "deleted_bookings": [],
            "loyalty_adjustments": [],
            "merges": [],
            "text_fixes": [],
            "deleted_pending": [],
            "deleted_pending_addons": [],
        }
        affected_customers = set()
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        backup_path = BACKUP_DIR / f"clean_booking_data_{timezone.now():%Y%m%d_%H%M%S}.json"

        with transaction.atomic():
            # 1. Duplicate bookings.
            booking_rows = {
                b.id: {f.attname: getattr(b, f.attname) for f in Booking._meta.concrete_fields}
                for b in Booking.objects.filter(id__in=[r for r, _ in remove_bookings])
            }
            points_to_remove = defaultdict(Decimal)
            for booking_id, kept_id in remove_bookings:
                row = booking_rows[booking_id]
                backup["deleted_bookings"].append({"row": row, "kept_id": kept_id})
                affected_customers.add(row["customer_id"])
                if row["loyalty_points_credited"] and row["customer_id"]:
                    points_to_remove[row["customer_id"]] += earn_points_from_booking_total(
                        row["total_price"]
                    )
            # Subtract double-credited points once per customer; never below 0.
            for customer in Customer.objects.select_for_update().filter(pk__in=list(points_to_remove)):
                before = customer.loyalty_points or Decimal("0")
                after = max(Decimal("0"), _quantize_balance(before - points_to_remove[customer.pk]))
                if after != before:
                    customer.loyalty_points = after
                    customer.last_updated = timezone.now()
                    customer.save(update_fields=["loyalty_points", "last_updated"])
                    backup["loyalty_adjustments"].append(
                        {"customer_id": customer.customer_id, "delta": str(after - before)}
                    )
            Booking.objects.filter(id__in=list(booking_rows)).delete()

            # 2. Duplicate customers.
            for keep_id, remove_id in merges:
                keep = Customer.objects.select_for_update().get(pk=keep_id)
                remove = Customer.objects.select_for_update().get(pk=remove_id)
                if keep.deleted_at or remove.deleted_at:
                    continue
                entry = {
                    "keep": keep_id,
                    "remove": remove_id,
                    "keep_before": {f: getattr(keep, f) for f in CUSTOMER_FIELDS},
                    "remove_before": {f: getattr(remove, f) for f in CUSTOMER_FIELDS},
                    "moved_bookings": list(Booking.objects.filter(customer_id=remove_id).values_list("id", flat=True)),
                    "moved_coupon_sent": list(CouponSent.objects.filter(customer_id=remove_id).values_list("id", flat=True)),
                    "moved_coupon_usage": list(CouponUsage.objects.filter(customer_id=remove_id).values_list("id", flat=True)),
                    "deleted_shadow": [
                        model_row(RenewalShadowPrediction, pk)
                        for pk in RenewalShadowPrediction.objects.filter(customer_id=remove_id).values_list("id", flat=True)
                    ],
                }
                Booking.objects.filter(id__in=entry["moved_bookings"]).update(customer_id=keep_id)
                CouponSent.objects.filter(id__in=entry["moved_coupon_sent"]).update(customer_id=keep_id)
                CouponUsage.objects.filter(id__in=entry["moved_coupon_usage"]).update(customer_id=keep_id)
                RenewalShadowPrediction.objects.filter(customer_id=remove_id).delete()

                # Free the unique email before giving it to the kept record.
                removed_email = remove.email
                remove.email_recycled = removed_email
                remove.email = None
                keep.loyalty_points = _quantize_balance(
                    (keep.loyalty_points or Decimal("0")) + (remove.loyalty_points or Decimal("0"))
                )
                remove.loyalty_points = Decimal("0")
                remove.deleted_at = timezone.now()
                remove.last_updated = timezone.now()
                remove.save(update_fields=["email", "email_recycled", "loyalty_points", "deleted_at", "last_updated"])
                for field in FILL_FROM_DUPLICATE:
                    source_value = removed_email if field == "email" else getattr(remove, field)
                    if not getattr(keep, field) and source_value:
                        setattr(keep, field, source_value)
                keep.last_updated = timezone.now()
                keep.save()
                ActionLog.objects.create(
                    actor_label=ACTOR_LABEL,
                    action_type="customer_merged",
                    action_text=(
                        f"{ACTOR_LABEL} merged duplicate customer #{remove_id} into #{keep_id} "
                        f"and moved #{remove_id} to Internal Records"
                    ),
                    metadata={"keep": keep_id, "remove": remove_id, "backup": backup_path.name},
                )
                backup["merges"].append(entry)
                affected_customers.update((keep_id, remove_id))

            # 3. Text leftovers, one bulk update per (table, field, new value).
            bulk = defaultdict(list)
            for model_name, pk, field, old, new in text_fixes:
                bulk[(model_name, field, new)].append(pk)
                backup["text_fixes"].append(
                    {"model": model_name, "pk": pk, "field": field, "old": old, "new": new}
                )
            for (model_name, field, new), pks in bulk.items():
                model = Booking if model_name == "Booking" else Customer
                model.objects.filter(pk__in=pks).update(**{field: new})

            # 4. Pending test bookings (with their add-on rows).
            if pending:
                pending_ids = [b.id for b in pending]
                backup["deleted_pending"] = [
                    {f.attname: getattr(b, f.attname) for f in Booking._meta.concrete_fields}
                    for b in pending
                ]
                backup["deleted_pending_addons"] = [
                    {f.attname: getattr(a, f.attname) for f in BookingAddon._meta.concrete_fields}
                    for a in BookingAddon.objects.filter(booking_id__in=pending_ids)
                ]
                affected_customers.update(b.customer_id for b in pending if b.customer_id)
                Booking.objects.filter(id__in=pending_ids).delete()

            ActionLog.objects.create(
                actor_label=ACTOR_LABEL,
                action_type="data_cleanup",
                action_text=(
                    f"{ACTOR_LABEL}: deleted {len(backup['deleted_bookings'])} duplicate bookings, "
                    f"merged {len(backup['merges'])} duplicate customers, "
                    f"fixed {len(backup['text_fixes'])} text values, "
                    f"deleted {len(backup['deleted_pending'])} Pending test bookings"
                ),
                metadata={"backup": backup_path.name},
            )
            # Write the backup inside the transaction: if writing fails, nothing is changed.
            backup_path.write_text(json.dumps(backup, cls=DjangoJSONEncoder, indent=2), encoding="utf-8")

        for customer in Customer.objects.filter(pk__in=affected_customers):
            recompute_customer_renewal_profile(customer)
        self.stdout.write(self.style.SUCCESS(
            f"\nApplied. Deleted {len(backup['deleted_bookings'])} bookings, "
            f"merged {len(backup['merges'])} customers, fixed {len(backup['text_fixes'])} values, "
            f"deleted {len(backup['deleted_pending'])} Pending bookings, "
            f"recomputed {len(affected_customers)} renewal profiles."
        ))
        self.stdout.write(f"Backup (keep it private): {backup_path}")
        self.stdout.write(f"Undo with: python manage.py clean_booking_data --restore \"{backup_path}\"")

    # ── Restore ────────────────────────────────────────────────────────────
    def restore(self, path):
        if not path.exists():
            raise CommandError(f"Backup not found: {path}")
        backup = json.loads(path.read_text(encoding="utf-8"))
        affected = set()
        with transaction.atomic():
            pending_rows = [from_json(Booking, r) for r in backup.get("deleted_pending", [])]
            Booking.objects.bulk_create([Booking(**r) for r in pending_rows])
            BookingAddon.objects.bulk_create(
                [BookingAddon(**from_json(BookingAddon, r)) for r in backup.get("deleted_pending_addons", [])]
            )
            affected.update(r["customer_id"] for r in pending_rows if r["customer_id"])
            # One bulk update per (table, field, old value).
            bulk = defaultdict(list)
            for fix in backup["text_fixes"]:
                bulk[(fix["model"], fix["field"], fix["old"])].append(fix["pk"])
            for (model_name, field, old), pks in bulk.items():
                model = Booking if model_name == "Booking" else Customer
                model.objects.filter(pk__in=pks).update(**{field: old})

            for entry in reversed(backup["merges"]):
                keep_before = from_json(Customer, entry["keep_before"])
                remove_before = from_json(Customer, entry["remove_before"])
                # Restore the kept record first so the removed record can take back its email.
                Customer.objects.filter(pk=entry["keep"]).update(**keep_before)
                Customer.objects.filter(pk=entry["remove"]).update(**remove_before)
                Booking.objects.filter(id__in=entry["moved_bookings"]).update(customer_id=entry["remove"])
                CouponSent.objects.filter(id__in=entry["moved_coupon_sent"]).update(customer_id=entry["remove"])
                CouponUsage.objects.filter(id__in=entry["moved_coupon_usage"]).update(customer_id=entry["remove"])
                for row in entry["deleted_shadow"]:
                    RenewalShadowPrediction.objects.create(**from_json(RenewalShadowPrediction, row))
                affected.update((entry["keep"], entry["remove"]))

            for adj in reversed(backup["loyalty_adjustments"]):
                customer = Customer.objects.select_for_update().get(pk=adj["customer_id"])
                customer.loyalty_points = (customer.loyalty_points or Decimal("0")) - Decimal(adj["delta"])
                customer.save(update_fields=["loyalty_points"])
            rows = [from_json(Booking, item["row"]) for item in backup["deleted_bookings"]]
            Booking.objects.bulk_create([Booking(**row) for row in rows])
            affected.update(row["customer_id"] for row in rows)

            ActionLog.objects.create(
                actor_label=ACTOR_LABEL,
                action_type="data_cleanup_restored",
                action_text=f"{ACTOR_LABEL}: restored changes from {path.name}",
                metadata={"backup": path.name},
            )
        for customer in Customer.objects.filter(pk__in=affected):
            recompute_customer_renewal_profile(customer)
        self.stdout.write(self.style.SUCCESS(
            f"Restored {len(backup['deleted_bookings'])} bookings, "
            f"{len(backup['merges'])} merges, {len(backup['text_fixes'])} text values."
        ))
