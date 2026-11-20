from datetime import date, datetime

from django.test import SimpleTestCase

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
