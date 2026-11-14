"""API tests.

Run from the Snaplytics folder:
    python manage.py test endpoints --settings=Snaplytics.settings_test
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from backend.models import ActionLog, Addon, Booking, Category, Customer, Package


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
        Category.objects.create(name="Portraits")
        Package.objects.create(category="Portraits", name="Solo", price=1000)
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
