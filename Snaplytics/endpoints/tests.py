"""API tests.

Run from the Snaplytics folder:
    python manage.py test endpoints --settings=Snaplytics.settings_test
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from backend.models import ActionLog, Addon, Booking, Category, Coupon, Customer, Package
from endpoints.serializers import BookingSerializer


class ViewsPackageTests(APITestCase):
    """endpoints.views is a package; urls.py imports every view from it."""

    def test_every_url_view_is_exported(self):
        import endpoints.views as views

        for name in views.__all__:
            self.assertTrue(hasattr(views, name), name)

    def test_routes_resolve(self):
        for name in ("action-logs", "recycle-bin", "loyalty-settings", "customer-list"):
            self.assertTrue(reverse(name))


class CatalogTests(APITestCase):
    def setUp(self):
        cache.clear()  # catalog lists are cached; the test DB rolls back but the cache does not
        Category.objects.create(name="Portraits")
        self.solo = Package.objects.create(category="Portraits", name="Solo", price=1000)
        Package.objects.create(
            category="Portraits", name="Old", price=500, deleted_at=timezone.now()
        )
        Addon.objects.create(name="Extra print", price=100)

    def test_packages_list_excludes_deleted(self):
        response = self.client.get("/api/packages/")
        self.assertEqual(response.status_code, 200)
        names = [p["name"] for p in response.json()]
        self.assertEqual(names, ["Solo"])

    def test_addons_and_categories_list(self):
        self.assertEqual(len(self.client.get("/api/addons/").json()), 1)
        categories = self.client.get("/api/categories/").json()
        self.assertEqual([c["name"] for c in categories], ["Portraits"])

    def test_list_is_cached_until_a_catalog_write(self):
        self.client.get("/api/packages/")
        self.client.get("/api/categories/")
        with self.assertNumQueries(0):
            self.assertEqual(len(self.client.get("/api/packages/").json()), 1)
            self.assertEqual(self.client.get("/api/categories/").json()[0]["name"], "Portraits")
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="staff", password="pw")
        )
        r = self.client.patch(f"/api/packages/{self.solo.pk}/", {"name": "Duo"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.client.force_authenticate(None)
        names = [p["name"] for p in self.client.get("/api/packages/").json()]
        self.assertEqual(names, ["Duo"])


class CustomerListTests(APITestCase):
    def setUp(self):
        staff = get_user_model().objects.create_user(username="staff", password="pw")
        self.client.force_authenticate(staff)
        for i in range(5):
            Customer.objects.create(
                full_name=f"Customer {i}", email=f"c{i}@example.com"
            )

    def test_list_is_paginated(self):
        response = self.client.get("/api/customers/", {"page_size": 2})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["count"], 5)
        self.assertEqual(len(body["results"]), 2)
        self.assertIsNotNone(body["next"])

    def test_search_and_sort(self):
        body = self.client.get(
            "/api/customers/", {"search": "c3@", "sort": "name-desc"}
        ).json()
        self.assertEqual([c["email"] for c in body["results"]], ["c3@example.com"])

    def test_list_all_returns_every_customer(self):
        response = self.client.get("/api/customers/all/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 5)

    def test_by_email_lookup(self):
        response = self.client.get(
            "/api/customers/by-email/", {"email": "C2@EXAMPLE.COM"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "c2@example.com")
        missing = self.client.get("/api/customers/by-email/", {"email": "no@x.com"})
        self.assertEqual(missing.status_code, 404)


class LoyaltyPointsTests(APITestCase):
    def setUp(self):
        staff = get_user_model().objects.create_user(username="staff", password="pw")
        self.client.force_authenticate(staff)
        Category.objects.create(name="Portraits")
        # Default redeem rate ₱50/point: 300 → 6 points, 1000 → 20 points.
        self.cheap = Package.objects.create(category="Portraits", name="Mini", price=300)
        Package.objects.create(category="Portraits", name="Solo", price=1000)
        self.rich = Customer.objects.create(full_name="Rich", email="r@x.com", loyalty_points=8)
        Customer.objects.create(full_name="Some", email="s@x.com", loyalty_points=2)
        Customer.objects.create(full_name="Zero", email="z@x.com", loyalty_points=0)

    def names(self, **params):
        body = self.client.get("/api/customers/", params).json()
        return [c["name"] for c in body["results"]]

    def test_points_filter_and_sort(self):
        self.assertEqual(self.names(points="can_claim"), ["Rich"])
        self.assertEqual(self.names(points="has", sort="loyaltyPoints-desc"), ["Rich", "Some"])
        self.assertEqual(self.names(points="none"), ["Zero"])
        self.assertEqual(self.names(sort="loyaltyPoints-asc"), ["Zero", "Some", "Rich"])

    def test_sort_blanks_last_and_renewal_sort(self):
        Customer.objects.filter(full_name="Some").update(contact_number="0917")
        self.assertEqual(self.names(sort="contactNo-desc")[0], "Some")
        self.assertEqual(self.names(sort="contactNo-asc")[0], "Some")
        # No Renewal rows: every rate is blank, so renewal sort falls back to id order.
        self.assertEqual(self.names(sort="renewalRate-desc"), self.names(sort="id-asc"))

    def test_ids_only_returns_every_match_unpaged(self):
        body = self.client.get("/api/customers/", {"points": "has", "ids_only": 1, "page_size": 1}).json()
        expected = set(Customer.objects.filter(loyalty_points__gt=0).values_list("customer_id", flat=True))
        self.assertEqual(set(body["ids"]), expected)

    def test_claim_deducts_points_or_rejects(self):
        url = f"/api/customers/{self.rich.pk}/claim-package/"
        ok = self.client.post(url, {"package_id": self.cheap.pk}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.rich.refresh_from_db()
        self.assertEqual(self.rich.loyalty_points, 2)
        self.assertEqual(self.rich.package_id, self.cheap.pk)
        claim = Booking.objects.get(customer=self.rich)
        self.assertTrue(claim.loyalty_claim)
        coupon = Coupon.objects.create(code="SAVE10", discount_type="fixed", discount_value=10)
        rejected = self.client.patch(
            f"/api/bookings/{claim.pk}/", {"coupon_id": coupon.pk}, format="json"
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("coupon_id", rejected.json())
        self.assertEqual((claim.session_status, claim.total_price), ("Pending", 0.0))
        # Accepted claims stay out of the renewal and recommendation data.
        claim.session_status = "BOOKED"
        claim.save()
        from backend.renewal_utils import recompute_customer_renewal_profile
        from recommender.service import get_history_based_recommendations

        self.assertEqual(recompute_customer_renewal_profile(self.rich).total_bookings, 0)
        self.assertEqual(get_history_based_recommendations(self.rich.pk), [])
        again = self.client.post(url, {"package_id": self.cheap.pk}, format="json")
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.json()["code"], "insufficient_loyalty_points")

    def test_denied_claim_refunds_points(self):
        url = f"/api/customers/{self.rich.pk}/claim-package/"
        self.client.post(url, {"package_id": self.cheap.pk}, format="json")
        claim = Booking.objects.get(customer=self.rich)
        self.assertEqual(claim.loyalty_points_spent, 6)
        self.assertEqual(self.client.delete(f"/api/bookings/{claim.pk}/").status_code, 204)
        self.rich.refresh_from_db()
        self.assertEqual(self.rich.loyalty_points, 8)
        self.assertIsNone(self.rich.package_id)

    def test_editing_claim_charges_only_addons(self):
        url = f"/api/customers/{self.rich.pk}/claim-package/"
        self.client.post(url, {"package_id": self.cheap.pk}, format="json")
        claim = Booking.objects.get(customer=self.rich)
        extra = Addon.objects.create(name="Print", price=100)
        edit = self.client.patch(
            f"/api/bookings/{claim.pk}/",
            {"total_price": 400, "addons_input": [{"addonId": extra.pk, "quantity": 2}]},
            format="json",
        )
        self.assertEqual(edit.status_code, 200, edit.content)
        claim.refresh_from_db()
        self.assertEqual(claim.total_price, 200)
        other = Package.objects.get(name="Solo")
        moved = self.client.patch(
            f"/api/bookings/{claim.pk}/", {"package_id": other.pk}, format="json"
        )
        self.assertEqual(moved.status_code, 400)

    def test_deleting_customer_refunds_open_claim(self):
        self.client.post(
            f"/api/customers/{self.rich.pk}/claim-package/",
            {"package_id": self.cheap.pk},
            format="json",
        )
        admin = get_user_model().objects.create_user(
            username="admin", password="pw", is_staff=True
        )
        self.client.force_authenticate(admin)
        response = self.client.delete(f"/api/customers/{self.rich.pk}/")
        self.assertIn(response.status_code, (200, 204), response.content)
        self.rich.refresh_from_db()
        self.assertEqual(self.rich.loyalty_points, 8)
        self.assertEqual(Booking.objects.get(customer=self.rich).session_status, "Cancelled")

    def test_cancelled_claim_refunds_once(self):
        url = f"/api/customers/{self.rich.pk}/claim-package/"
        self.client.post(url, {"package_id": self.cheap.pk}, format="json")
        claim = Booking.objects.get(customer=self.rich)
        status_url = f"/api/bookings/{claim.pk}/status/"
        for _ in range(2):
            self.client.patch(status_url, {"session_status": "Cancelled"}, format="json")
        self.rich.refresh_from_db()
        self.assertEqual(self.rich.loyalty_points, 8)


class ActionLogPagingTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin = user_model.objects.create_user(
            username="admin", password="pw", is_staff=True
        )
        self.staff = user_model.objects.create_user(username="staff", password="pw")
        now = timezone.now()
        # 7 visible logs (newest first: log 6 ... log 0) plus 3 coupon logs.
        for i in range(7):
            ActionLog.objects.create(
                action_type="customer_created",
                action_text=f"log {i}",
                created_at=now - timedelta(minutes=100 - i),
            )
        for i in range(3):
            ActionLog.objects.create(
                action_type="coupon_sent",
                action_text=f"coupon {i}",
                created_at=now - timedelta(minutes=50 - i),
            )

    def get_logs(self, **params):
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/action-logs/", params)
        self.assertEqual(response.status_code, 200)
        return [row["action_text"] for row in response.json()]

    def test_requires_admin_or_owner(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get("/api/action-logs/").status_code, 403)

    def test_offset_pages_do_not_overlap(self):
        params = {"limit": 3, "exclude_type_prefix": "coupon_"}
        page1 = self.get_logs(offset=0, **params)
        page2 = self.get_logs(offset=3, **params)
        page3 = self.get_logs(offset=6, **params)
        self.assertEqual(page1, ["log 6", "log 5", "log 4"])
        self.assertEqual(page2, ["log 3", "log 2", "log 1"])
        self.assertEqual(page3, ["log 0"])

    def test_exclude_prefix_is_optional(self):
        self.assertEqual(len(self.get_logs(limit=50)), 10)
        self.assertEqual(len(self.get_logs(limit=50, exclude_type_prefix="coupon_")), 7)

    def test_bad_offset_falls_back_to_zero(self):
        self.assertEqual(self.get_logs(limit=1, offset="x"), ["coupon 2"])


class KioskAccessTests(APITestCase):
    """Without a login, only what the customer kiosk needs is allowed."""

    def setUp(self):
        cache.clear()
        self.package = Package.objects.create(category="Portraits", name="Solo", price=1000)
        self.customer = Customer.objects.create(full_name="Ana", email="ana@example.com")
        self.booking = Booking.objects.create(
            customer=self.customer, package=self.package, session_status="Pending"
        )
        self.staff = get_user_model().objects.create_user(username="staff", password="pw")

    def assertDenied(self, response):
        self.assertIn(response.status_code, (401, 403), response.content)

    def test_kiosk_can_read_catalog(self):
        for url in ("/api/packages/", "/api/categories/", "/api/addons/",
                    f"/api/packages/{self.package.pk}/"):
            self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_kiosk_can_find_or_create_customer(self):
        found = self.client.get("/api/customers/by-email/", {"email": "ana@example.com"})
        self.assertEqual(found.status_code, 200)
        created = self.client.post(
            "/api/customers/",
            {"name": "Ben", "email": "ben@example.com", "consent": "I Agree"},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)

    def test_kiosk_booking_is_always_pending(self):
        response = self.client.post(
            f"/api/customers/{self.customer.pk}/bookings/",
            {"package_id": self.package.pk, "session_status": "BOOKED", "total_price": 1000},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        booking = Booking.objects.exclude(pk=self.booking.pk).get()
        self.assertEqual(booking.session_status, "Pending")

    def test_anonymous_cannot_read_customers_or_bookings(self):
        for url in ("/api/customers/", "/api/customers/all/",
                    f"/api/customers/{self.customer.pk}/",
                    f"/api/customers/{self.customer.pk}/bookings/",
                    "/api/bookings/"):
            self.assertDenied(self.client.get(url))

    def test_anonymous_cannot_change_data(self):
        c, b, p = self.customer.pk, self.booking.pk, self.package.pk
        self.assertDenied(self.client.delete(f"/api/customers/{c}/"))
        self.assertDenied(self.client.put(f"/api/customers/{c}/", {"name": "X"}, format="json"))
        self.assertDenied(self.client.post("/api/customers/bulk-delete/", {"ids": [c]}, format="json"))
        self.assertDenied(self.client.delete(f"/api/customers/{c}/bookings/{b}/"))
        self.assertDenied(self.client.delete(f"/api/bookings/{b}/"))
        self.assertDenied(self.client.patch(f"/api/bookings/{b}/status/", {"status": "Cancelled"}, format="json"))
        self.assertDenied(self.client.post("/api/packages/", {"name": "X"}, format="json"))
        self.assertDenied(self.client.patch(f"/api/packages/{p}/", {"price": 1}, format="json"))
        self.assertDenied(self.client.delete(f"/api/packages/{p}/"))
        self.assertTrue(Customer.objects.filter(pk=c, deleted_at__isnull=True).exists())
        self.assertTrue(Booking.objects.filter(pk=b).exists())
        self.assertTrue(Package.objects.filter(pk=p, deleted_at__isnull=True).exists())

    def test_staff_can_manage_bookings(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get("/api/bookings/").status_code, 200)
        response = self.client.delete(f"/api/customers/{self.customer.pk}/bookings/{self.booking.pk}/")
        self.assertIn(response.status_code, (200, 204), response.content)


class BookingTotalTests(APITestCase):
    """A booking's total, discount and add-ons, as the kiosk sends them."""

    def setUp(self):
        self.package = Package.objects.create(category="Portraits", name="Solo", price=249)
        self.addon = Addon.objects.create(name="All Soft Copies", price=250)
        self.customer = Customer.objects.create(full_name="Ana", email="ana@example.com")
        self.url = f"/api/customers/{self.customer.pk}/bookings/"

    def book(self, **extra):
        return self.client.post(self.url, {"package_id": self.package.pk, **extra}, format="json")

    def test_negative_addon_quantity_is_rejected(self):
        response = self.book(addons_input=[{"addonId": self.addon.pk, "quantity": -3}])
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(Booking.objects.exists())

    def test_addons_are_added_to_the_total(self):
        response = self.book(addons_input=[{"addonId": self.addon.pk, "quantity": 2}])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Booking.objects.get().total_price, 249 + 2 * 250)

    def test_fixed_coupon_never_makes_the_total_negative(self):
        coupon = Coupon.objects.create(code="BIG500", discount_type="fixed", discount_value=500)
        response = self.book(coupon_id=coupon.pk)
        self.assertEqual(response.status_code, 201, response.content)
        booking = Booking.objects.get()
        self.assertEqual(booking.total_price, 0)
        self.assertEqual(booking.coupon_discount_amount, 249)

    def test_percent_discount_note_shows_the_amount_taken_off(self):
        booking = Booking.objects.create(
            customer=self.customer, package=self.package, total_price=224.1, discounts="-10%"
        )
        self.assertAlmostEqual(BookingSerializer(booking).data["discount"], 24.9)


class KioskConfirmationEmailTests(APITestCase):
    url = "/api/kiosk/send-booking-confirmation/"

    def setUp(self):
        package = Package.objects.create(category="Portraits", name="Solo", price=249)
        customer = Customer.objects.create(full_name="Ana", email="ana@example.com")
        self.booking = Booking.objects.create(
            customer=customer, package=package, session_status="Pending"
        )

    def test_fresh_kiosk_booking_is_confirmed_without_showing_the_email(self):
        response = self.client.post(self.url, {"booking_id": self.booking.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["sent"])
        self.assertNotIn("customer_email", response.json())
        self.assertEqual(len(mail.outbox), 1)

    def test_old_or_accepted_bookings_are_not_emailed(self):
        Booking.objects.filter(pk=self.booking.pk).update(
            created_at=timezone.now() - timedelta(hours=1)
        )
        old = self.client.post(self.url, {"booking_id": self.booking.pk}, format="json")
        Booking.objects.filter(pk=self.booking.pk).update(
            created_at=timezone.now(), session_status="BOOKED"
        )
        accepted = self.client.post(self.url, {"booking_id": self.booking.pk}, format="json")
        self.assertEqual((old.status_code, accepted.status_code), (403, 403))
        self.assertEqual(len(mail.outbox), 0)


class InternalRecordsRestoreTests(APITestCase):
    """Only ADMIN (is_staff) or OWNER (superuser) can restore from Internal Records."""

    def setUp(self):
        self.coupon = Coupon.objects.create(
            code="GONE", discount_type="percent", discount_value=10, deleted_at=timezone.now()
        )
        self.url = f"/api/coupons/{self.coupon.pk}/restore/"

    def test_plain_staff_cannot_restore(self):
        self.client.force_authenticate(get_user_model().objects.create_user(username="staff", password="pw"))
        self.assertEqual(self.client.post(self.url).status_code, 403)
        self.assertEqual(self.client.get("/api/recycle-bin/").status_code, 403)
        self.coupon.refresh_from_db()
        self.assertIsNotNone(self.coupon.deleted_at)

    def test_admin_and_owner_can_restore(self):
        admin = get_user_model().objects.create_user(username="admin", password="pw", is_staff=True)
        self.client.force_authenticate(admin)
        self.assertEqual(self.client.post(self.url).status_code, 200)
        self.coupon.refresh_from_db()
        self.assertIsNone(self.coupon.deleted_at)
        self.coupon.deleted_at = timezone.now()
        self.coupon.save()
        owner = get_user_model().objects.create_superuser(username="owner", password="pw")
        self.client.force_authenticate(owner)
        self.assertEqual(self.client.post(self.url).status_code, 200)
