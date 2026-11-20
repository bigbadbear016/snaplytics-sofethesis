from datetime import date, datetime

from django.test import SimpleTestCase, TestCase

from backend.management.commands.import_heigen_bookings import parse_session_date


class ParseSessionDateTests(SimpleTestCase):
    """Booking-sheet dates, used by import_heigen_bookings and run_etl."""

    def test_text_dates_are_day_month_year(self):
        self.assertEqual(parse_session_date("25/02/24"), date(2024, 2, 25))
        self.assertEqual(parse_session_date("4/1/26"), date(2026, 1, 4))
        self.assertEqual(parse_session_date("04/01/2026"), date(2026, 1, 4))

    def test_spreadsheet_dates_have_month_and_day_swapped_back(self):
        # '01/12/25' (1 December) was stored by the spreadsheet as 12 January.
        self.assertEqual(parse_session_date(datetime(2025, 1, 12)), date(2025, 12, 1))
        self.assertEqual(parse_session_date("2025-01-12 00:00:00"), date(2025, 12, 1))

    def test_a_day_above_12_is_kept(self):
        self.assertEqual(parse_session_date("2025-03-15"), date(2025, 3, 15))

    def test_unreadable_text_raises(self):
        with self.assertRaises(ValueError):
            parse_session_date("next Tuesday")


class GroqKeyRotationTests(SimpleTestCase):
    """Several comma-separated GROQ_API_KEY values: limited keys are skipped."""

    def setUp(self):
        from backend import groq_client

        groq_client._cooldown_until.clear()

    def _reply(self):
        import io
        import json

        body = {"choices": [{"message": {"content": json.dumps({"ok": True})}}]}
        return io.BytesIO(json.dumps(body).encode("utf-8"))

    def _http_error(self, code):
        import io
        import urllib.error

        return urllib.error.HTTPError("https://api.groq.com", code, "limited", {}, io.BytesIO(b""))

    def test_rate_limited_key_falls_over_to_next(self):
        from unittest import mock

        from backend import groq_client

        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(req.headers["Authorization"])
            if len(calls) == 1:
                raise self._http_error(429)
            return self._reply()

        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "k1, k2 ,k3"}), mock.patch.object(
            groq_client.urllib.request, "urlopen", side_effect=fake_urlopen
        ):
            self.assertEqual(groq_client.chat_json("s", "u"), {"ok": True})
        self.assertEqual(len(calls), 2)
        self.assertNotEqual(calls[0], calls[1])
        self.assertTrue(all(c in ("Bearer k1", "Bearer k2", "Bearer k3") for c in calls))

    def test_all_keys_limited_raises_unavailable(self):
        from unittest import mock

        from backend import groq_client

        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "k1,k2"}), mock.patch.object(
            groq_client.urllib.request, "urlopen", side_effect=self._http_error(429)
        ) as urlopen:
            with self.assertRaises(groq_client.GroqUnavailable):
                groq_client.chat_json("s", "u")
        self.assertEqual(urlopen.call_count, 2)

    def test_server_error_or_timeout_tries_next_key_without_cooldown(self):
        from unittest import mock

        from backend import groq_client

        groq_client._cooldown_until.clear()
        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "k1,k2,k3"}), mock.patch.object(
            groq_client.urllib.request,
            "urlopen",
            side_effect=[self._http_error(500), TimeoutError("slow"), self._reply()],
        ) as urlopen:
            self.assertEqual(groq_client.chat_json("s", "u"), {"ok": True})
        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual(groq_client._cooldown_until, {})

        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "k1,k2"}), mock.patch.object(
            groq_client.urllib.request, "urlopen", side_effect=self._http_error(500)
        ) as urlopen:
            with self.assertRaises(groq_client.GroqUnavailable):
                groq_client.chat_json("s", "u")
        self.assertEqual(urlopen.call_count, 2)

    def test_restricted_org_400_falls_over_but_bad_request_400_does_not(self):
        import io
        import json
        import urllib.error
        from unittest import mock

        from backend import groq_client

        def err400(code):
            body = json.dumps({"error": {"code": code}}).encode("utf-8")
            return urllib.error.HTTPError("https://api.groq.com", 400, "bad", {}, io.BytesIO(body))

        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "k1,k2"}), mock.patch.object(
            groq_client.urllib.request,
            "urlopen",
            side_effect=[err400("organization_restricted"), self._reply()],
        ):
            self.assertEqual(groq_client.chat_json("s", "u"), {"ok": True})

        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "k1,k2"}), mock.patch.object(
            groq_client.urllib.request, "urlopen", side_effect=err400("json_validate_failed")
        ) as urlopen:
            with self.assertRaises(groq_client.GroqUnavailable):
                groq_client.chat_json("s", "u")
        self.assertEqual(urlopen.call_count, 1)

    def test_failed_key_is_skipped_on_next_question(self):
        from unittest import mock

        from backend import groq_client

        tried = []

        def fake_urlopen(req, timeout=None):
            tried.append(req.headers["Authorization"])
            if req.headers["Authorization"] == "Bearer k2":
                raise self._http_error(429)
            return self._reply()

        with mock.patch.dict("os.environ", {"GROQ_API_KEY": "k1,k2"}), mock.patch.object(
            groq_client.urllib.request, "urlopen", side_effect=fake_urlopen
        ):
            for _ in range(4):
                groq_client.chat_json("s", "u")
        self.assertEqual(tried.count("Bearer k2"), 1)  # limited once, then skipped while cooling down


class OccasionTaggingTests(TestCase):
    """New categories/packages get an occasion: keyword guess now, Groq refinement after commit."""

    def _run_threads_inline(self):
        from unittest import mock

        class InlineThread:
            def __init__(self, target, daemon=None):
                self.target = target

            def start(self):
                self.target()

        return mock.patch("backend.occasions.threading.Thread", InlineThread)

    def test_keyword_guess(self):
        from backend.occasions import guess_occasion

        self.assertEqual(guess_occasion("Graduation Package 2027"), "graduation")
        self.assertEqual(guess_occasion("Xmas Barkada"), "christmas")
        self.assertEqual(guess_occasion("Delight"), "general")
        self.assertEqual(guess_occasion("Delight", "category: Christmas Package 2024"), "christmas")

    def test_new_package_is_tagged_and_refined_by_ai(self):
        from unittest import mock

        from backend.models import Package

        with self._run_threads_inline(), mock.patch(
            "backend.occasions.chat_json", return_value={"occasion": "birthday"}
        ), self.captureOnCommitCallbacks(execute=True):
            pkg = Package.objects.create(category="Regular", name="Sweet Celebration", price=999)
            self.assertEqual(pkg.occasion, "general")  # instant keyword guess
        pkg.refresh_from_db()
        self.assertEqual(pkg.occasion, "birthday")  # Groq's refinement

    def test_ai_down_keeps_keyword_guess(self):
        from unittest import mock

        from backend.groq_client import GroqUnavailable
        from backend.models import Category

        with self._run_threads_inline(), mock.patch(
            "backend.occasions.chat_json", side_effect=GroqUnavailable("down")
        ), self.captureOnCommitCallbacks(execute=True):
            cat = Category.objects.create(name="Toga Season")
        cat.refresh_from_db()
        self.assertEqual(cat.occasion, "graduation")

    def test_locked_occasion_is_never_overwritten(self):
        from unittest import mock

        from backend.models import Category

        cat = Category.objects.create(name="Family Day", occasion="couple", occasion_locked=True)
        with self._run_threads_inline(), mock.patch(
            "backend.occasions.chat_json", return_value={"occasion": "family"}
        ), self.captureOnCommitCallbacks(execute=True):
            cat.name = "Family Day 2027"
            cat.save()
        cat.refresh_from_db()
        self.assertEqual(cat.occasion, "couple")


class RenewalFeatureTests(SimpleTestCase):
    def test_features_match_columns_and_encode_last_booking(self):
        from datetime import date

        from backend.renewal_model import FEATURES, features_at

        bookings = [(date(2025, 1, 10), 1000.0, "general"), (date(2025, 12, 20), 2000.0, "christmas")]
        f = dict(zip(FEATURES, features_at(bookings, date(2026, 1, 19))))
        self.assertEqual(len(f), len(FEATURES))
        self.assertEqual(f["total_bookings"], 2)
        self.assertEqual(f["days_since_last_booking"], 30)
        self.assertEqual(f["last_occasion_christmas"], 1.0)
        self.assertEqual(f["last_occasion_graduation"], 0.0)
        self.assertIsNone(features_at(bookings, date(2024, 12, 31)))


class LogregScorerTests(SimpleTestCase):
    def test_saved_numbers_match_sklearn_probabilities(self):
        import numpy as np
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler

        from backend.renewal_model import logreg_scorer

        rng = np.random.default_rng(0)
        x = rng.normal(size=(200, 4))
        y = (x[:, 0] + rng.normal(size=200) > 0).astype(int)
        model = make_pipeline(StandardScaler(), LogisticRegression()).fit(x, y)
        sc, lr = model.named_steps["standardscaler"], model.named_steps["logisticregression"]
        scorer = logreg_scorer(
            {"mean": sc.mean_, "scale": sc.scale_, "coef": lr.coef_[0], "intercept": lr.intercept_[0]}
        )
        np.testing.assert_allclose(scorer(x), model.predict_proba(x)[:, 1], rtol=1e-9)


class HybridModelRoundTripTests(SimpleTestCase):
    def test_saved_xgboost_lr_loads_with_same_probabilities(self):
        import json
        import tempfile
        from pathlib import Path
        from unittest import mock

        import numpy as np

        from backend import renewal_model
        from backend.management.commands.train_renewal_xgboost import XGBoostFromLogreg, logreg_params

        rng = np.random.default_rng(1)
        n = len(renewal_model.FEATURES)
        x = np.abs(rng.normal(size=(400, n)))
        y = (x[:, 1] + rng.normal(size=400) > 1).astype(int)
        model = XGBoostFromLogreg().fit(x, y)
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            model.xgb.save_model(str(d / "m.json"))
            (d / "lr.json").write_text(json.dumps(logreg_params(model.logreg)))
            (d / "meta.json").write_text(json.dumps(
                {"algorithm": "xgboost_lr", "features": list(renewal_model.FEATURES), "version": "t"}
            ))
            with mock.patch.multiple(
                renewal_model, MODEL_PATH=d / "m.json", LOGREG_PATH=d / "lr.json", META_PATH=d / "meta.json"
            ), mock.patch.dict(renewal_model._cache, stamp=None, scorer=None, meta=None):
                scorer, meta = renewal_model._load()
                self.assertEqual(meta["algorithm"], "xgboost_lr")
                np.testing.assert_allclose(scorer(x), model.predict_proba(x)[:, 1], rtol=1e-5)
