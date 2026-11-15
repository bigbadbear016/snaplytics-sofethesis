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
