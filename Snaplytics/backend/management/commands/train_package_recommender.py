"""
Train the SVD++ package recommender from accepted bookings.

    python manage.py train_package_recommender --dry-run   # test and report only
    python manage.py train_package_recommender             # test, then save the model

Before the final fit, the command runs a time-separated test: for each split
date, a model is trained on bookings before that date and scored on later
bookings made by customers it had already seen (returning customers). A hit
means the booked package was among the 3 recommended ones (hit@3).

Rules compared in the test:
  live rule      the customer's own most-booked packages, then SVD++ fills the
                 remaining cards (what recommender.service does)
  SVD++ only     the 3 packages SVD++ scores highest
  no model       own most-booked packages, then best sellers
"""
from collections import Counter, defaultdict
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

from backend.models import Booking, BookingAddon
from recommender import svdpp
from recommender.service import ACCEPTED_BOOKING_STATUSES

TOP_K = 3
# Split dates: month starts from 16 to 6 months before the last booking month.
SPLIT_MONTHS_BACK = (16, 14, 12, 10, 8, 6)
MIN_TEST_BOOKINGS = 30


def month_start_back(day, months):
    index = day.year * 12 + day.month - 1 - months
    return date(index // 12, index % 12 + 1, 1)


def top(counter, k, skip=()):
    ranked = sorted(counter.items(), key=lambda pair: (-pair[1], -pair[0]))
    return [key for key, _ in ranked if key not in skip][:k]


class Command(BaseCommand):
    help = "Train the SVD++ package recommender from accepted bookings."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Run the time-separated test and report, but do not save the model.",
        )

    def handle(self, *args, **options):
        rows = [
            (booking_id, customer_id, package_id, (session or created).date())
            for booking_id, customer_id, package_id, session, created in Booking.objects.filter(
                session_status__in=ACCEPTED_BOOKING_STATUSES,
                loyalty_claim=False,
                package_id__isnull=False,
            )
            .order_by("session_date", "id")
            .values_list("id", "customer_id", "package_id", "session_date", "created_at")
        ]
        if not rows:
            raise CommandError("No accepted bookings found.")
        booking_addons = defaultdict(set)
        for booking_id, addon_id in BookingAddon.objects.filter(
            booking__session_status__in=ACCEPTED_BOOKING_STATUSES,
            booking__loyalty_claim=False,
        ).values_list("booking_id", "addon_id"):
            booking_addons[booking_id].add(addon_id)

        db = connection.settings_dict
        self.stdout.write(
            f"Data source: {connection.vendor} database {db.get('NAME')} "
            f"on {db.get('HOST') or 'local'}"
        )
        customers = {r[1] for r in rows}
        returning = sum(1 for n in Counter(r[1] for r in rows).values() if n > 1)
        self.stdout.write(
            f"Bookings used: {len(rows)} accepted ({', '.join(ACCEPTED_BOOKING_STATUSES)}) "
            f"from {len(customers)} customers ({returning} with 2+ bookings)"
        )

        # ── Time-separated test ─────────────────────────────────────────────
        data_end = max(r[3] for r in rows)
        per_split = []
        for months in SPLIT_MONTHS_BACK:
            split = month_start_back(data_end, months)
            train = [r for r in rows if r[3] < split]
            known = {r[1] for r in train}
            test = [r for r in rows if r[3] >= split and r[1] in known]
            if len(test) < MIN_TEST_BOOKINGS or not train:
                continue
            packages = sorted({r[2] for r in train})
            best_sellers = Counter(r[2] for r in train)
            history = defaultdict(Counter)
            for _, customer_id, package_id, _ in train:
                history[customer_id][package_id] += 1
            algo = svdpp.fit(
                svdpp.build_ratings([r[:3] for r in train], booking_addons)
            )
            ranking = {
                c: [p for p, _ in svdpp.rank_packages(algo, c, packages)]
                for c in {r[1] for r in test}
            }
            hits = defaultdict(list)
            for _, customer_id, package_id, _ in test:
                own = top(history[customer_id], TOP_K)
                model = ranking[customer_id]
                live = (own + [p for p in model if p not in own])[:TOP_K]
                hits["live_rule"].append(package_id in live)
                hits["svdpp_only"].append(package_id in model[:TOP_K])
                hits["no_model"].append(
                    package_id in (own + top(best_sellers, TOP_K, skip=own))[:TOP_K]
                )
                hits["live_rule_first_card"].append(package_id == live[0])
            per_split.append(
                {
                    "split_date": split.isoformat(),
                    "train_bookings": len(train),
                    "test_bookings": len(test),
                    **{name: sum(v) / len(v) for name, v in hits.items()},
                }
            )

        test_summary = {}
        if per_split:
            total = sum(s["test_bookings"] for s in per_split)
            for name in ("live_rule", "svdpp_only", "no_model", "live_rule_first_card"):
                test_summary[name] = (
                    sum(s[name] * s["test_bookings"] for s in per_split) / total
                )
            self.stdout.write(
                f"Time-separated test, returning customers, {len(per_split)} split date(s):"
            )
            self.stdout.write(
                f"  hit@{TOP_K}: live rule {test_summary['live_rule']:.3f}  "
                f"SVD++ only {test_summary['svdpp_only']:.3f}  "
                f"no model {test_summary['no_model']:.3f}  "
                f"(first card right: {test_summary['live_rule_first_card']:.3f})"
            )
            for s in per_split:
                self.stdout.write(
                    f"    {s['split_date']}: train {s['train_bookings']}, "
                    f"test {s['test_bookings']}, live rule {s['live_rule']:.3f}, "
                    f"SVD++ only {s['svdpp_only']:.3f}, no model {s['no_model']:.3f}"
                )
        else:
            self.stdout.write(
                self.style.WARNING("Not enough history for a time-separated test yet.")
            )

        # ── Final model on every booking ────────────────────────────────────
        ratings = svdpp.build_ratings([r[:3] for r in rows], booking_addons)
        algo = svdpp.fit(ratings)
        positives = sum(1 for r in ratings if r[2] == 1.0)
        meta = {
            "version": "svdpp-v1",
            "trained_at": timezone.now().isoformat(),
            "data_start": min(r[3] for r in rows).isoformat(),
            "data_end": data_end.isoformat(),
            "bookings": len(rows),
            "customers": len(customers),
            "customers_with_2plus_bookings": returning,
            "items": algo.trainset.n_items,
            "rating_rows": len(ratings),
            "positive_rows": positives,
            "negative_rows": len(ratings) - positives,
            "negatives_per_customer": svdpp.NEGATIVES_PER_CUSTOMER,
            "params": svdpp.PARAMS,
            "seed": svdpp.SEED,
            "top_k": TOP_K,
            "time_separated_test": {"summary": test_summary, "per_split": per_split},
        }
        self.stdout.write(
            f"Final model: {len(ratings)} rating rows ({positives} booked, "
            f"{len(ratings) - positives} not booked), {algo.trainset.n_users} customers, "
            f"{algo.trainset.n_items} items."
        )

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("Dry run: model not saved."))
            return
        svdpp.save(algo, meta)
        self.stdout.write(self.style.SUCCESS(f"Model saved: {svdpp.MODEL_PATH}"))
