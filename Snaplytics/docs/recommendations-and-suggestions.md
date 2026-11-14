# Recommendations and Suggestions

This document explains how Snaplytics chooses package recommendations and
add-on suggestions for the Electron staff application and the Heigen Studio
kiosk.

## Terminology

- **Personalized recommendation**: a package selected from the customer's
  accepted booking history.
- **Popular suggestion**: a package selected from booking counts across all
  customers. This is the new-customer and fallback behavior.
- **Add-on suggestion**: add-ons associated with a recommended package,
  selected from the customer's history or from package-level booking counts.

The recommendation cards contain a package, suggested add-ons, the base price,
the combined price, a score, and a `source` label. The frontends use the
source label to explain why an item was shown, such as "Booking Loyalty",
"Popular Choice", or "Trending".

## End-to-end flow

1. The kiosk collects the customer's email and optional preferred date.
2. The backend looks up the customer by email.
3. For an existing customer, the kiosk calls
   `GET /api/recommendations/<customer_id>/?k=3`.
4. For a new customer, the kiosk first calculates popular suggestions from
   its already-loaded booking and catalog snapshot. If that produces no
   cards, it calls `GET /api/recommendations/popular/?k=3`.
5. The backend returns up to `k` cards. The kiosk displays up to three cards
   above the category list.
6. Selecting a card skips directly to the booking summary with the
   recommended package and add-ons preselected.

The Electron customer details page uses the same customer recommendation
endpoint and renders the returned cards and explanation factors.

## Which bookings count?

Only bookings with one of these statuses contribute to recommendations:

- `Ongoing`
- `BOOKED`

Pending and cancelled bookings do not influence package ranking, add-on
ranking, customer history, or popularity fallback.

## Personalized recommendations

The current request path is implemented in
`recommender/service.py:get_recommendations`.

### Package ranking

1. Query the customer's accepted bookings.
2. Group them by package.
3. Count bookings for each package.
4. Sort by descending booking count, then ascending package ID for a stable
   tie-breaker.
5. Keep up to `k` packages.
6. Calculate each package score as:

   ```
   package booking count / customer's total accepted bookings
   ```

This means the current personalized score is a package-history share, not a
machine-learning prediction.

### Personalized add-ons

For each selected package, the backend looks at the same customer's accepted
bookings for that package. Add-ons are ordered by:

1. total recorded add-on quantity;
2. number of bookings containing the add-on.

The first two add-ons are attached to the personalized card. If no add-ons
are found for that package, the response builder supplies up to two popular
add-ons for the package.

### Important date behavior

The endpoint accepts `date` as `YYYY-MM-DD` or `YYYY-MM`, but the current
history-based ranking does not use the date to change the score. If omitted,
the endpoint reports the current date in `target_date`.

## Popular and fallback suggestions

### Backend popular endpoint

`GET /api/recommendations/popular/?k=3` performs a live database query:

1. Count accepted bookings for each active, non-archived package.
2. Sort packages by descending booking count.
3. Return up to `k` packages.
4. For each package, select up to four add-ons with the greatest total
   quantity in accepted bookings for that package.
5. Compute `score` as the package booking count and `source` as
   `popularity`.

If there are no accepted bookings, the endpoint returns active catalog
packages as a last-resort catalog fallback. Those packages have no booking
score.

### Personalized endpoint fallback

If an existing customer has no accepted booking history,
`get_recommendations` returns no history records. The response builder then
fills the available slots with globally popular packages. These cards are
marked with `source: "popular_fallback"`.

The personalized endpoint can therefore return a mixture of history cards
and popular fallback cards when fewer than `k` history recommendations are
available.

### Kiosk-side new-customer optimization

For a new customer, the kiosk avoids an immediate extra request by using the
bootstrap snapshot:

- package score = number of snapshot bookings for that package;
- packages are sorted by that count;
- up to `k` packages are retained;
- up to three package-specific add-ons are selected by quantity;
- if a package has no recorded add-ons, the first two applicable catalog
  add-ons are used.

If the snapshot has no usable recommendations, the kiosk calls the backend
popular endpoint. If that also fails, it displays no recommendation cards but
still allows normal category browsing.

## Response shape

Both recommendation endpoints return cards with this general shape:

```json
{
  "package": {},
  "addons": [],
  "base_price": 0,
  "total_price": 0,
  "score": 0,
  "source": "customer_booking_history",
  "explanation": "You've chosen Premium Package before.",
  "explanation_detail": "Premium Package is this customer's most-booked package: 3 of 5 accepted bookings (60%). We added Extra Print, the add-ons you picked most often with it. Total: ₱1,800 (₱1,500 package + add-ons).",
  "explanation_factors": [
    {"type": "history_share", "value": 0.6},
    {"type": "package_bookings", "value": 3},
    {"type": "total_bookings", "value": 5},
    {"type": "thin_evidence", "value": false}
  ],
  "source_label": "Booking Loyalty"
}
```

### Template-based explanations

Recommendation cards include deterministic explanations generated by the
backend from the same evidence used to rank the card. The existing
recommendation logic selects the package; templates describe the source and
evidence. No external LLM, API key, or network request is required.

The customer-facing `explanation` is short and kiosk-safe. The
`explanation_detail` field is more precise for Electron staff, while
`explanation_factors` contains structured values suitable for chips,
translation, or analytics. `source_label` provides one frontend-friendly
label for the recommendation source.

The explanation templates can also mention:

- previous booking share for personalized recommendations;
- accepted booking count for popular recommendations;
- similar-customer or matching-booking patterns;
- recent monthly popularity;
- whether the customer is new;
- package category;
- related add-on suggestions; and
- an active promotional price.

The backend selects a wording variation deterministically from the package ID,
so repeated requests remain stable while recommendation cards do not all use
exactly the same sentence.

The customer-specific endpoint also returns customer context:

```json
{
  "customer_id": 123,
  "customer_name": "Customer",
  "customer_email": "customer@example.com",
  "target_date": "2026-11-03",
  "total_bookings": 2,
  "recommendations": [],
  "key_factors": []
}
```

The popular endpoint returns `recommendations`, `count`, and
`generated_at`. Its `source` is normally `popularity`.

## XGBoost renewal prediction

XGBoost is a separate intelligence feature from package recommendations. It
predicts whether a customer will book again within 365 days; it does not
select the package or add-ons shown in recommendation cards.

The full description of the live model, its training, its test results, its
groups, and the shadow workflow is in
[Docs/renewal-shadow-mode.md](../../Docs/renewal-shadow-mode.md). In short:

- **Model:** one XGBoost classifier (`xgboost-v3`), loaded by
  `backend/renewal_model.py` from `backend/ml/renewal_xgboost.json`. It is the
  only renewal model; there is no fallback.
- **Training data:** every accepted (`BOOKED`) booking in the live Supabase
  database, past and current. Train with
  `python manage.py train_renewal_xgboost`.
- **Training rows:** one row per customer at every month-end whose 365-day
  outcome is already known, using only what was known on that date. The label
  is whether the customer booked again within the next 365 days.
- **Inputs:** a booking strength score (a capped sum of recent bookings,
  total bookings, average booking value, and past renewal), total bookings,
  bookings in the last 365 days, whether the customer renewed before, and days
  since the last booking. The model is forced to treat stronger booking history
  as a higher chance and more days since the last booking as a lower chance.
- **Groups:** top 5% of customers `very_likely`, next 10% `likely`, next 15%
  `unlikely`, rest `very_unlikely`. `predicted_renewal` is true for the top two
  groups.

### Prediction metrics

`GET /api/analytics/model-metrics/` reads
`renewal/outputs/renewal_xgboost_live_metrics.csv`, which
`train_renewal_xgboost` writes. The numbers come from a time-separated test:
for each test month-end, the model learns only from month-ends whose outcome
had already ended by then.

Results of `xgboost-v3`, averaged over 5 test dates (2025-04-30 to
2025-08-31):

| Measure | `xgboost-v3` | Random or always-no |
|---|---:|---:|
| ROC-AUC | 0.557 | 0.500 |
| PR-AUC | 0.145 | 0.121 |
| Top 10% who renewed | 18.0% | 12.1% |
| Accuracy | 71.5% | 87.9% |
| Precision | 18.2% | — |
| Recall | 23.8% | — |
| MCC | 0.032 | 0 |

The model ranks customers somewhat better than random, but its accuracy is
below saying "no renewal" for everyone. Use it to order a
follow-up list, not for automatic decisions about a customer. The metric
definitions are in
[Docs/renewal-shadow-mode.md](../../Docs/renewal-shadow-mode.md#how-the-metrics-work).

### Older offline pipeline

The scripts in `renewal/` (`feature_eng.py`, `train_test_split.py`,
`trainer_xg.py`, `eval_xg.py`, `renewal_predict.py`) and the files
`renewal/models/xgb_renewal.json`,
`renewal/outputs/xgboost_saved_model_results.csv`, and
`renewal/outputs/xgboost_engineered_results.csv` are an older offline
experiment. The app does not use them.

Their stored results (91% and 79% accuracy) are not valid evidence. The data
had one row per booking and was split at random, so the same customers
appeared in training and testing. The 91% result was also scored on rows the
model was trained on.

### Recommender evaluation metrics

The package recommender has a different evaluation task because it ranks
items instead of predicting a binary renewal label. Its evaluation script
reports:

- **NDCG@K**: ranking quality, rewarding relevant packages appearing near the
  top of the list;
- **Hit Rate@K**: percentage of evaluated users with at least one relevant
  item in the top `K`;
- **catalog coverage**: how much of the available item catalog is recommended.

The currently stored `recommender/results/evaluation_results.csv` contains
308 evaluated users. Aggregating its per-user rows gives:

| Metric | Stored result |
|---|---:|
| NDCG@3 | 0.3941 |
| Hit Rate@3 | 81.82% |
| NDCG@5 | 0.4150 |
| Hit Rate@5 | 94.48% |

These numbers evaluate the offline SVD++/loader pipeline. They do not prove
that the live API currently uses XGBoost or the offline SVD++ ranking path:
the active customer endpoint still uses database booking-history ranking and
popular fallbacks described above.

## Refreshing recommendation data

`POST /api/recommendations/rebuild/` is an admin/owner operation. It:

1. exports accepted bookings and booking add-ons from the database;
2. rebuilds monthly package popularity, add-on popularity, and
   package/add-on co-occurrence CSV artifacts;
3. clears in-memory recommender caches;
4. records a recommendation rebuild action log.

The live API ranking described above reads the database directly. Rebuilding
artifacts is still useful for the recommender pipeline, analytics, diagnostics,
and future model-backed ranking.

## Offline/model pipeline status

The `recommender/loader.py` module contains a more advanced candidate and
scoring pipeline. It can load a Surprise model, infer a user's latest month,
score package/add-on combinations, apply co-occurrence bonuses, add historical
package boosts, and greedily select up to four add-ons.

That loader is not the active path used by
`recommender/service.py:get_recommendations` today. The active API path uses
the database history and popularity logic documented above. Changes to the
loader alone will not change cards returned by the customer recommendation
endpoint unless the service is wired to call it.

## Source files

- [Recommendation service](../recommender/service.py)
- [Recommendation endpoints and response builder](../endpoints/views/recommendations.py)
- [Recommendation routes](../endpoints/urls.py)
- [Kiosk recommendation requests](../../HeigenKiosk/src/api/client.js)
- [Kiosk recommendation flow](../../HeigenKiosk/src/screens/KioskApp.js)
- [Kiosk recommendation cards](../../HeigenKiosk/src/screens/CategoryScreen.js)
- [Electron recommendation client](../../electron-app/scripts/recommendations.js)
- [Renewal XGBoost model loading and prediction](../backend/renewal_model.py)
- [Renewal XGBoost training command](../backend/management/commands/train_renewal_xgboost.py)
- [Renewal XGBoost test metrics](../renewal/outputs/renewal_xgboost_live_metrics.csv)
- [Recommender evaluator](../recommender/evaluator.py)
