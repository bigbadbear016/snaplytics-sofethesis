"""API tests.

Run from the Snaplytics folder:
    python manage.py test endpoints --settings=Snaplytics.settings_test
"""

from datetime import timedelta
from decimal import Decimal

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


    def test_eligible_list_matches_can_claim_with_packages(self):
        body = self.client.get("/api/loyalty/eligible/").json()
        self.assertEqual(body["count"], 1)
        row = body["results"][0]
        self.assertEqual((row["name"], row["points"]), ("Rich", 8.0))
        self.assertNotIn("consent", row)
        # 8 points: Mini (6) yes, Solo (20) no
        self.assertEqual([p["name"] for p in row["packages"]], ["Mini"])
        self.assertEqual(row["packages"][0]["points_cost"], 6.0)
        self.assertEqual(body["count"], len(self.names(points="can_claim")))

    def test_eligible_email_personalises_and_skips(self):
        Customer.objects.filter(full_name="Rich").update(full_name="<b>Rich</b>")
        # Photo-consent "I Disagree" must NOT block email; a missing address must
        disagreed = Customer.objects.create(full_name="Shy", email="shy@x.com", loyalty_points=30, consent="I Disagree")
        no_email = Customer.objects.create(full_name="Nomail", email=None, loyalty_points=30)
        some = Customer.objects.get(full_name="Some")  # 2 points: not eligible
        resp = self.client.post(
            "/api/loyalty/eligible/email/",
            {
                "customer_ids": [self.rich.pk, disagreed.pk, no_email.pk, some.pk],
                "subject": "Hi {customer_name}, you have {current_points} points",
                "html_body": "<p>Hello {customer_name}</p>{claimable_packages}",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["sent_count"], 2)
        reasons = {s["id"]: s["reason"] for s in body["skipped"]}
        self.assertNotIn(disagreed.pk, reasons)
        self.assertEqual(reasons[no_email.pk], "No email address")
        self.assertEqual(reasons[some.pk], "No longer has enough points")
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["r@x.com", "shy@x.com"])
        msg = next(m for m in mail.outbox if m.to == ["r@x.com"])
        self.assertEqual(msg.subject, "Hi <b>Rich</b>, you have 8 points")
        html = msg.alternatives[0][0]
        self.assertIn("Hello &lt;b&gt;Rich&lt;/b&gt;", html)  # name escaped in HTML
        self.assertIn("<li>Mini &mdash; 6 points</li>", html)
        self.assertNotIn("Solo", html)
        self.assertIn("Mini (6 points)", msg.body)
        self.assertTrue(ActionLog.objects.filter(action_type="loyalty_email_sent").exists())

    def test_eligible_email_requires_auth_and_fields(self):
        self.assertEqual(
            self.client.post("/api/loyalty/eligible/email/", {"customer_ids": []}, format="json").status_code, 400
        )
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/loyalty/eligible/").status_code, (401, 403))


class LoyaltyRateRecalculationTests(APITestCase):
    """Changing the earn rate re-prices points earned from completed bookings."""

    def setUp(self):
        admin = get_user_model().objects.create_user(username="admin", password="pw", is_staff=True)
        self.client.force_authenticate(admin)
        # Default earn rate ₱100/pt. Ana: two credited bookings (₱2,000 + ₱1,000 = 30 pts)
        # plus 5 pts from elsewhere (e.g. imported); then spent 6 on a claim → 29.
        self.ana = Customer.objects.create(full_name="Ana", email="a@x.com", loyalty_points=29)
        Booking.objects.create(customer=self.ana, total_price=2000, session_status="BOOKED", loyalty_points_credited=True)
        Booking.objects.create(customer=self.ana, total_price=1000, session_status="BOOKED", loyalty_points_credited=True)
        Booking.objects.create(customer=self.ana, total_price=0, session_status="BOOKED",
                               loyalty_claim=True, loyalty_points_spent=6)
        # Not credited yet (pending): must not count
        Booking.objects.create(customer=self.ana, total_price=5000, session_status="Pending")
        # Ben: earned 10, spent all 10 → 0
        self.ben = Customer.objects.create(full_name="Ben", email="b@x.com", loyalty_points=0)
        Booking.objects.create(customer=self.ben, total_price=1000, session_status="BOOKED", loyalty_points_credited=True)

    def patch(self, **data):
        return self.client.patch("/api/loyalty-settings/", data, format="json")

    def test_halving_earn_rate_doubles_earned_points_only(self):
        resp = self.patch(pesos_per_point_earn=50)
        self.assertEqual(resp.status_code, 200)
        self.ana.refresh_from_db()
        self.ben.refresh_from_db()
        # Earned 30 → 60 (+30); the 5 extra and the 6 spent stay → 59
        self.assertEqual(self.ana.loyalty_points, Decimal("59.0"))
        self.assertEqual(self.ben.loyalty_points, Decimal("10.0"))
        self.assertEqual(resp.json()["recalculated"]["affected"], 2)

    def test_round_trip_restores_balances(self):
        self.patch(pesos_per_point_earn=50)
        self.patch(pesos_per_point_earn=100)
        self.ana.refresh_from_db()
        self.assertEqual(self.ana.loyalty_points, Decimal("29.0"))

    def test_raising_rate_floors_at_zero(self):
        resp = self.patch(pesos_per_point_earn=200)  # Ben: 0 + (5 - 10) → floored at 0
        self.ben.refresh_from_db()
        self.ana.refresh_from_db()
        self.assertEqual(self.ben.loyalty_points, Decimal("0.0"))
        self.assertEqual(self.ana.loyalty_points, Decimal("14.0"))  # 29 - 15
        self.assertEqual(resp.json()["recalculated"]["floored"], 0)  # Ben was already 0 → unchanged
        self.assertEqual(resp.json()["recalculated"]["affected"], 1)

    def test_redeem_rate_change_reprices_claims(self):
        Category.objects.create(name="Portraits")
        pkg = Package.objects.create(category="Portraits", name="Mini", price=300)
        # Claimed at ₱50/pt → 6 points spent; Ana's existing claim (no package) is left alone
        cara = Customer.objects.create(full_name="Cara", email="c@x.com", loyalty_points=Decimal("10"))
        claim = Booking.objects.create(customer=cara, package=pkg, total_price=0, session_status="BOOKED",
                                       loyalty_claim=True, loyalty_points_spent=Decimal("6"))
        refunded = Booking.objects.create(customer=cara, package=pkg, total_price=0, session_status="Cancelled",
                                          loyalty_claim=True, loyalty_points_spent=Decimal("0"))

        # Cheaper to claim (₱100/pt → 3 pts): Cara gets 3 back
        resp = self.patch(pesos_per_point_redeem=100)
        self.assertEqual(resp.json()["recalculated"]["claims_repriced"], 1)
        cara.refresh_from_db(); claim.refresh_from_db(); refunded.refresh_from_db()
        self.assertEqual((cara.loyalty_points, claim.loyalty_points_spent), (Decimal("13.0"), Decimal("3.0")))
        self.assertEqual(refunded.loyalty_points_spent, Decimal("0.0"))

        # Dearer (₱25/pt → 12 pts): 9 more taken
        self.patch(pesos_per_point_redeem=25)
        cara.refresh_from_db(); claim.refresh_from_db()
        self.assertEqual((cara.loyalty_points, claim.loyalty_points_spent), (Decimal("4.0"), Decimal("12.0")))

        # Earned points are untouched by a claim-rate change
        self.ana.refresh_from_db()
        self.assertEqual(self.ana.loyalty_points, Decimal("29.0"))

        # Preview is a dry run
        body = self.client.post("/api/loyalty-settings/preview/", {"pesos_per_point_redeem": 50}, format="json").json()
        self.assertEqual(body["claims_repriced"], 1)
        cara.refresh_from_db()
        self.assertEqual(cara.loyalty_points, Decimal("4.0"))

    def test_staff_cannot_change_or_preview_rates(self):
        staff = get_user_model().objects.create_user(username="staffer", password="pw")  # STAFF role
        self.client.force_authenticate(staff)
        self.assertEqual(self.patch(pesos_per_point_earn=50).status_code, 403)
        self.assertEqual(self.patch(pesos_per_point_redeem=25).status_code, 403)
        preview = self.client.post("/api/loyalty-settings/preview/", {"pesos_per_point_earn": 50}, format="json")
        self.assertEqual(preview.status_code, 403)
        self.assertEqual(self.client.get("/api/loyalty-settings/").status_code, 200)  # can still read
        self.ana.refresh_from_db()
        self.assertEqual(self.ana.loyalty_points, Decimal("29.0"))

    def test_preview_is_a_dry_run(self):
        body = self.client.post("/api/loyalty-settings/preview/", {"pesos_per_point_earn": 50}, format="json").json()
        self.assertEqual(body["affected"], 2)
        self.assertEqual(body["examples"][0], {"id": self.ana.pk, "name": "Ana", "before": 29.0, "after": 59.0})
        self.ana.refresh_from_db()
        self.assertEqual(self.ana.loyalty_points, Decimal("29.0"))


class LoyaltyStaleRateTests(APITestCase):
    """The rate was changed in the past without re-pricing: saved ₱50, balances earned at ₱100."""

    def setUp(self):
        from backend.models import LoyaltySettings

        admin = get_user_model().objects.create_user(username="admin", password="pw", is_staff=True)
        self.client.force_authenticate(admin)
        LoyaltySettings.objects.update_or_create(
            pk=1, defaults={"pesos_per_point_earn": Decimal("50"), "pesos_per_point_redeem": Decimal("100")}
        )
        ActionLog.objects.create(
            action_type="loyalty_settings_updated", action_text="old change",
            metadata={"previous_pesos_per_point_earn": "100.00", "pesos_per_point_earn": "50.00"},
        )
        self.customers = []
        for i, totals in enumerate([[6790], [2000, 3250], [1000]]):
            earned = sum(Decimal(t) / 100 for t in totals)  # earned at ₱100
            c = Customer.objects.create(full_name=f"C{i}", email=f"c{i}@x.com", loyalty_points=earned)
            for t in totals:
                Booking.objects.create(customer=c, total_price=t, session_status="BOOKED", loyalty_points_credited=True)
            self.customers.append(c)
        # One customer with a manual -13 adjustment (balance below the booking ledger)
        self.adjusted = Customer.objects.create(full_name="Adj", email="adj@x.com", loyalty_points=Decimal("7"))
        Booking.objects.create(customer=self.adjusted, total_price=2000, session_status="BOOKED", loyalty_points_credited=True)

    def balances(self):
        return [Customer.objects.get(pk=c.pk).loyalty_points for c in self.customers + [self.adjusted]]

    def test_preview_detects_real_basis_and_does_not_zero_balances(self):
        body = self.client.post("/api/loyalty-settings/preview/", {"pesos_per_point_earn": 100}, format="json").json()
        self.assertEqual(body["basis_rate"], 100.0)
        self.assertEqual(body["affected"], 0)  # balances already reflect ₱100

    def test_saving_same_rate_aligns_balances_and_is_idempotent(self):
        before = self.balances()
        resp = self.client.patch("/api/loyalty-settings/", {"pesos_per_point_earn": 50}, format="json")
        self.assertEqual(resp.json()["recalculated"]["basis_rate"], 100.0)
        after = self.balances()
        self.assertEqual(after[:3], [b * 2 for b in before[:3]])  # ₱50/pt = double
        self.assertEqual(after[3], Decimal("27.0"))  # 40 at ₱50, adjustment of -13 kept
        again = self.client.patch("/api/loyalty-settings/", {"pesos_per_point_earn": 50}, format="json")
        self.assertEqual(again.json()["recalculated"]["affected"], 0)
        self.assertEqual(self.balances(), after)
        # And back to ₱100 restores the originals
        self.client.patch("/api/loyalty-settings/", {"pesos_per_point_earn": 100}, format="json")
        self.assertEqual(self.balances(), before)


class AiCustomersContextTests(APITestCase):
    def test_customer_context_has_stats_but_no_personal_details(self):
        import json

        from endpoints.views.ai import _catalog_context, _customers_context

        pkg = Package.objects.create(category="Portraits", name="Solo", price=1000)
        ana = Customer.objects.create(
            full_name="Ana Secret", email="ana.secret@example.com",
            contact_number="09171234567", instagram_handle="@anasecret",
        )
        Customer.objects.create(full_name="Ben Hidden", email="ben.hidden@example.com")
        for days in (30, 400):
            Booking.objects.create(
                customer=ana, package=pkg, session_status="BOOKED", total_price=1500,
                session_date=timezone.now() - timedelta(days=days),
            )

        ctx = _customers_context(_catalog_context())
        dumped = json.dumps(ctx, default=str)
        for secret in ("Ana Secret", "ana.secret", "09171234567", "anasecret", "Ben Hidden", "ben.hidden"):
            self.assertNotIn(secret, dumped)
        self.assertEqual(ctx["customers"], 2)
        self.assertEqual(ctx["repeat_customers"], 1)
        self.assertEqual(ctx["top_spenders"][0]["id"], ana.customer_id)
        self.assertEqual(ctx["top_spenders"][0]["spent"], 3000)


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

    def test_with_count_returns_total_and_page(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get(
            "/api/action-logs/",
            {"limit": 3, "offset": 3, "exclude_type_prefix": "coupon_", "with_count": "1"},
        )
        body = response.json()
        self.assertEqual(body["count"], 7)
        self.assertEqual([r["action_text"] for r in body["results"]], ["log 3", "log 2", "log 1"])


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


class AiEndpointTests(APITestCase):
    """Groq is mocked; no network calls."""

    def setUp(self):
        self.coupon = Coupon.objects.create(code="SAVE10", discount_type="percent", discount_value=10)
        self.admin = get_user_model().objects.create_user(
            username="ai-admin", password="pw", is_staff=True
        )

    @staticmethod
    def _groq_reply(content):
        import io
        import json

        body = json.dumps({"choices": [{"message": {"content": json.dumps(content)}}]})
        return io.BytesIO(body.encode("utf-8"))

    def test_staff_forbidden(self):
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="ai-staff", password="pw")
        )
        self.assertEqual(self.client.get("/api/ai/insights/").status_code, 403)
        r = self.client.post("/api/ai/coupon-html/", {"coupon_id": self.coupon.pk}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_missing_key_returns_503(self):
        from unittest import mock

        self.client.force_authenticate(self.admin)
        with mock.patch.dict("os.environ", {"GROQ_API_KEY": ""}):
            r = self.client.post(
                "/api/ai/coupon-html/", {"coupon_id": self.coupon.pk}, format="json"
            )
        self.assertEqual(r.status_code, 503)

    def test_coupon_html_strips_script_and_keeps_token(self):
        from unittest import mock

        self.client.force_authenticate(self.admin)
        reply = {
            "subject": "Promo",
            "html_body": '<div onclick="x()" style=\\"color:red\\">Use {{code}}<script>alert(1)</script></div>',
        }
        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "test"}), mock.patch(
            "backend.groq_client.urllib.request.urlopen", return_value=self._groq_reply(reply)
        ) as urlopen:
            r = self.client.post(
                "/api/ai/coupon-html/",
                {"coupon_id": self.coupon.pk, "prompt": "summer promo", "layout": "hero-ticket"},
                format="json",
            )
        self.assertEqual(r.status_code, 200)
        html = r.json()["html_body"]
        self.assertIn("{{code}}", html)
        self.assertNotIn("<script", html)
        self.assertNotIn("onclick", html)
        self.assertIn('style="color:red"', html)  # double-escaped quotes are repaired
        sent = urlopen.call_args[0][0].data.decode("utf-8")
        self.assertNotIn("SAVE10", sent)  # the real code never leaves the server

    def test_insights_returns_list(self):
        from unittest import mock

        from rest_framework.response import Response

        self.client.force_authenticate(self.admin)
        fake = Response({"risk_overview": {"likely": 1}, "package_popularity": {"datasets": []}})
        reply = {"insights": [{"title": "T", "detail": "D", "action": "A"}]}
        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "test"}), mock.patch(
            "endpoints.views.ai.dashboard_analytics", return_value=fake
        ), mock.patch(
            "backend.groq_client.urllib.request.urlopen", return_value=self._groq_reply(reply)
        ):
            r = self.client.get("/api/ai/insights/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["insights"], [{"title": "T", "detail": "D", "action": "A"}])

    def test_gift_card_is_server_rendered(self):
        from unittest import mock

        self.client.force_authenticate(self.admin)
        reply = {"headline": "<b>Hi</b>", "dark": "red", "mid": "#e84a6f", "subject": "Gift"}
        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "test"}), mock.patch(
            "backend.groq_client.urllib.request.urlopen", return_value=self._groq_reply(reply)
        ):
            r = self.client.post(
                "/api/ai/coupon-html/",
                {"coupon_id": self.coupon.pk, "layout": "gift-card"},
                format="json",
            )
        self.assertEqual(r.status_code, 200)
        html = r.json()["html_body"]
        self.assertIn("{{code}}", html)
        self.assertIn("10% OFF", html)  # discount comes from the coupon, not the model
        self.assertIn("&lt;b&gt;Hi&lt;/b&gt;", html)  # AI text is escaped
        self.assertIn("#0f2e3a", html)  # invalid color falls back to default
        self.assertNotIn("$", html.replace("₱", ""))  # every template slot filled

    def test_package_chat_validates_and_cleans_draft(self):
        import json
        from unittest import mock

        Category.objects.create(name="Regular")
        Package.objects.create(category="Regular", name="Solo", price=500)
        self.client.force_authenticate(self.admin)
        bad = self.client.post("/api/ai/package-chat/", {"messages": []}, format="json")
        self.assertEqual(bad.status_code, 400)

        reply = {
            "reply": "Here is an idea.",
            "package_draft": {"category": "Made Up", "name": "Barkada", "price": "1299",
                              "max_people": 6, "inclusions": ["30 soft copies"]},
        }
        msgs = [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
            {"role": "user", "content": "make a barkada package"},
        ]
        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "test"}), mock.patch(
            "backend.groq_client.urllib.request.urlopen", return_value=self._groq_reply(reply)
        ) as urlopen:
            r = self.client.post("/api/ai/package-chat/", {"messages": msgs}, format="json")
        self.assertEqual(r.status_code, 200)
        draft = r.json()["package_draft"]
        self.assertEqual(draft["category"], "Made Up")  # new category kept; create adds it
        self.assertTrue(draft["new_category"])
        self.assertEqual(draft["price"], 1299.0)
        sent = json.loads(urlopen.call_args[0][0].data)
        self.assertEqual([m["role"] for m in sent["messages"]], ["system", "user", "assistant", "user"])
        self.assertIn("Solo", sent["messages"][0]["content"])  # catalog context included

    def test_package_chat_sends_page_specific_data(self):
        import json
        from unittest import mock

        self.client.force_authenticate(self.admin)
        msgs = [{"role": "user", "content": "hi"}]
        for page, expect in (("coupons", "SAVE10"), ("dashboard", "redemptions_90d"), ("bogus", "Packages page")):
            with mock.patch.dict("os.environ", {"GROQ_API_KEY": "test"}), mock.patch(
                "backend.groq_client.urllib.request.urlopen",
                return_value=self._groq_reply({"reply": "ok", "package_draft": None}),
            ) as urlopen:
                r = self.client.post(
                    "/api/ai/package-chat/", {"page": page, "messages": msgs}, format="json"
                )
            self.assertEqual(r.status_code, 200, page)
            system = json.loads(urlopen.call_args[0][0].data)["messages"][0]["content"]
            self.assertIn(expect, system, page)

    def test_package_chat_staff_forbidden(self):
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="ai-staff2", password="pw")
        )
        r = self.client.post(
            "/api/ai/package-chat/", {"messages": [{"role": "user", "content": "hi"}]}, format="json"
        )
        self.assertEqual(r.status_code, 403)

    def test_package_draft_category_matching_and_auto_create(self):
        from endpoints.views.ai import _clean_package_draft

        same = _clean_package_draft({"name": "X", "price": 100, "category": "regular"}, ["Regular"])
        self.assertEqual((same["category"], same["new_category"]), ("Regular", False))

        self.client.force_authenticate(self.admin)
        r = self.client.post(
            "/api/packages/",
            {"category": "Barkada", "name": "Barkada Starter", "price": 1299, "is_archived": True},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertTrue(Category.objects.filter(name="Barkada").exists())

    def test_new_category_flow_keeps_category_archived(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post("/api/categories/", {"name": "Barkada", "is_archived": True}, format="json")
        self.assertEqual(r.status_code, 201)
        r = self.client.post(
            "/api/packages/",
            {"category": "Barkada", "name": "Barkada Starter", "price": 1299, "is_archived": True},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        cats = Category.objects.filter(name__iexact="Barkada")
        self.assertEqual(cats.count(), 1)
        self.assertTrue(cats.get().is_archived)  # hidden from the kiosk until restored

    def test_ai_package_create_handles_name_and_category_conflicts(self):
        Category.objects.create(name="Regular")
        Package.objects.create(category="Regular", name="Barkada Fun", price=999, is_archived=True)
        Category.objects.create(name="Old Promo", deleted_at=timezone.now())
        self.client.force_authenticate(self.admin)

        def create(**draft):
            base = {"name": "Barkada Fun", "price": 1299, "category": "Regular"}
            return self.client.post(
                "/api/ai/package-create/", {"draft": {**base, **draft}}, format="json"
            )

        dup = create(name="barkada fun")  # same name, same category, any capitals
        self.assertEqual(dup.status_code, 409)
        self.assertIn("already exists", dup.json()["detail"])

        recycled = create(category="old promo")
        self.assertEqual(recycled.status_code, 409)
        self.assertIn("Recycle Bin", recycled.json()["detail"])

        new_cat = create(category="Barkada")  # same name in another category is allowed
        self.assertEqual(new_cat.status_code, 201)
        self.assertTrue(new_cat.json()["category_created"])
        self.assertTrue(Category.objects.get(name="Barkada").is_archived)
        self.assertTrue(Package.objects.get(pk=new_cat.json()["package_id"]).is_archived)

        self.assertEqual(create(category="Barkada").status_code, 409)  # asked twice: no duplicate
        self.assertEqual(Category.objects.filter(name__iexact="barkada").count(), 1)

    def test_ai_package_create_staff_forbidden(self):
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="ai-staff3", password="pw")
        )
        r = self.client.post(
            "/api/ai/package-create/", {"draft": {"name": "X", "price": 1}}, format="json"
        )
        self.assertEqual(r.status_code, 403)


class PackageMoveTests(APITestCase):
    def setUp(self):
        Category.objects.create(name="Regular")
        Category.objects.create(name="Barkada")
        self.pkg = Package.objects.create(category="Regular", name="Bliss", price=999)

    def test_staff_cannot_move_but_can_still_edit(self):
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="mv-staff", password="pw")
        )
        url = f"/api/packages/{self.pkg.pk}/"
        r = self.client.patch(url, {"category": "Barkada"}, format="json")
        self.assertEqual(r.status_code, 403)
        r = self.client.patch(url, {"name": "Bliss 2", "category": "regular"}, format="json")
        self.assertEqual(r.status_code, 200)  # same category (any capitals) is not a move

    def test_admin_can_move(self):
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="mv-admin", password="pw", is_staff=True)
        )
        r = self.client.patch(f"/api/packages/{self.pkg.pk}/", {"category": "Barkada"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.pkg.refresh_from_db()
        self.assertEqual(self.pkg.category, "Barkada")
