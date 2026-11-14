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
predicts whether a customer will renew within 365 days; it does not select the
package or add-ons shown in recommendation cards.

### Training and prediction

The renewal model is trained as a supervised binary-classification problem.
Each prepared booking row is an example, and the target column is
`renewed_within_365`:

- `1`: the customer renewed within 365 days;
- `0`: the customer did not renew within 365 days.

#### 1. Feature preparation

`renewal/feature_eng.py` starts with the merged booking/customer/package data,
removes direct personal-identification and descriptive text fields, and
creates numeric features. The main feature groups are:

- **Time**: session day of week, session month, and weekend flag;
- **Booking and payment**: total price, GCash amount, cash amount,
  discounts, and session status;
- **Customer history**: acquisition source, first-time flag, and previous
  session count;
- **Add-ons**: total add-on cost, add-on quantity, and add-on intensity;
- **Package**: package ID, package category, and package name;
- **Derived spending**: `spend_ratio`, calculated from the booking total
  relative to the dataset's mean booking total.

Categorical fields such as acquisition source, package category, package name,
and session status are one-hot encoded. Missing values are filled or converted
to numeric values before training. The target is removed from the input matrix
so the model cannot use the answer as a feature.

#### 2. Train/test split

`renewal/train_test_split.py` separates the prepared data into:

- **80% training data**, used to learn the model;
- **20% test data**, held out for evaluation;
- `random_state=42`, so the split can be reproduced;
- stratification by the renewal target, so the positive/negative class ratio
  is approximately preserved in both sets.

The training script reads `renewal/processed/train.csv`, not the test file.
It converts all inputs to numeric values and fills invalid/missing values with
zero.

#### 3. Class-imbalance handling

The trainer counts negative and positive examples and calculates:

```text
scale_pos_weight = number_of_negative_examples /
                   number_of_positive_examples
```

This weight is supplied to XGBoost so errors on the less frequent renewal
class receive more influence during training. This is important because a
model can achieve high accuracy by mostly predicting the majority class while
still missing many actual renewals.

#### 4. How XGBoost learns

XGBoost builds an ensemble of decision trees sequentially:

1. Start with an initial prediction for every row.
2. Measure the error between the prediction and the true renewal label.
3. Grow a new tree that focuses on correcting the previous errors.
4. Add the new tree's contribution to the ensemble using the learning rate.
5. Repeat for the configured number of estimators.

Each tree splits customers using feature conditions such as a spending value,
previous session count, package indicator, or weekend flag. The final output
is a probability between 0 and 1, rather than only a class label.

The configured model uses:

- 300 estimators;
- maximum tree depth of 4;
- learning rate of 0.1;
- 90% row subsampling;
- 80% feature subsampling;
- `logloss` evaluation metric;
- class-imbalance weighting based on the negative/positive class counts;
- random seed `42`.

The trained model is saved as
`renewal/models/xgb_renewal.json`. Prediction is performed by
`renewal/renewal_predict.py`, which returns a renewal probability and converts
it to a binary decision using a threshold of `0.6`:

```text
predicted_renewal = 1 when renewal_probability >= 0.6
```

The prediction script also calculates XGBoost contribution values (SHAP-style
feature contributions). The largest absolute contributions are returned as
explanations so staff can see which customer features most influenced the
prediction and whether each feature increased or decreased renewal likelihood.

### Confusion-matrix terms

All classification metrics are based on four possible outcomes:

| Actual | Predicted | Name | Meaning |
|---|---|---|---|
| Renewal (`1`) | Renewal (`1`) | True positive (TP) | Correctly identified a customer who renewed |
| Non-renewal (`0`) | Non-renewal (`0`) | True negative (TN) | Correctly identified a customer who did not renew |
| Non-renewal (`0`) | Renewal (`1`) | False positive (FP) | Predicted renewal, but the customer did not renew |
| Renewal (`1`) | Non-renewal (`0`) | False negative (FN) | Missed a customer who renewed |

The prediction threshold controls this trade-off. Raising the threshold
usually produces fewer positive predictions, which can reduce false positives
but increase false negatives. Lowering it usually identifies more potential
renewers, which can improve recall but may reduce precision.

### Prediction metrics

The backend dashboard endpoint
`GET /api/analytics/model-metrics/` reads the stored CSV result files and
exposes accuracy, precision, recall, F1, MCC, and ROC-AUC. The currently
stored values are:

| Evaluation result | Accuracy | Precision | Recall | F1 | MCC | ROC-AUC |
|---|---:|---:|---:|---:|---:|---:|
| `xgboost_saved_model_results.csv` | 91.02% | 70.00% | 89.44% | 78.54% | 0.7384 | 0.9576 |
| `xgboost_engineered_results.csv` | 79.34% | 44.71% | 52.78% | 48.41% | 0.3579 | 0.7970 |

Interpretation:

- **Accuracy**: percentage of all renewal/non-renewal decisions classified
  correctly:

  ```text
  accuracy = (TP + TN) / (TP + TN + FP + FN)
  ```

  It is easy to overestimate performance with accuracy when one class is much
  larger than the other.
- **Precision**: among customers predicted to renew, percentage who actually
  renewed:

  ```text
  precision = TP / (TP + FP)
  ```

  A low precision means staff may spend effort following up customers who
  ultimately do not renew.
- **Recall**: among customers who actually renewed, percentage identified by
  the model:

  ```text
  recall = TP / (TP + FN)
  ```

  A low recall means the model misses many customers who could have renewed.
- **F1**: harmonic mean of precision and recall:

  ```text
  F1 = 2 × (precision × recall) / (precision + recall)
  ```

  F1 is high only when both precision and recall are reasonably high.
- **MCC (Matthews Correlation Coefficient)**: a balanced correlation between
  actual and predicted binary labels. It uses all four confusion-matrix
  values:

  ```text
                     TP × TN − FP × FN
  MCC = ───────────────────────────────────────────────
        sqrt((TP+FP)(TP+FN)(TN+FP)(TN+FN))
  ```

  MCC is useful for imbalanced renewal data because it does not ignore the
  minority class. `+1` means perfect classification, `0` means performance
  equivalent to random guessing, and `-1` means every prediction is wrong.
  For this reason, MCC is often more informative than accuracy by itself.

  **MCC terms in simple words:**

  - **Matthews**: the name of the person who created this measurement.
  - **Correlation**: how closely the predictions match the real results.
  - **Coefficient**: the final score, from `-1` to `+1`.
  - **TP (true positive)**: the model said “will renew,” and the customer
    renewed.
  - **TN (true negative)**: the model said “will not renew,” and the customer
    did not renew.
  - **FP (false positive)**: the model said “will renew,” but the customer
    did not renew.
  - **FN (false negative)**: the model said “will not renew,” but the
    customer renewed.

  In this project:

  - MCC near `+1` means the model is usually correct.
  - MCC near `0` means the model is not much better than guessing.
  - A negative MCC means the model is often wrong.
- **ROC-AUC**: how well the probability ranking separates renewers from
  non-renewers across thresholds; `1` is perfect and `0.5` is chance. ROC-AUC
  does not depend on choosing only one decision threshold, while accuracy,
  precision, recall, F1, and MCC do.

For the saved-model snapshot, the 91.02% accuracy, 70.00% precision, and
89.44% recall mean that the model found most actual renewers, while about
30% of its positive renewal predictions were false positives. Its MCC of
`0.7384` indicates a strong positive relationship between predictions and
actual outcomes, including both renewal and non-renewal classes. Its
ROC-AUC of `0.9576` indicates strong probability ranking on that evaluation
set. These interpretations describe the stored evaluation set only.

These are stored evaluation artifacts, not a guarantee of future performance.
They should be regenerated on representative, time-separated data after
changes to the training data, features, model, or threshold. In particular,
accuracy alone should not be used to judge this model because renewal classes
may be imbalanced.

### How the stored metrics are produced

`renewal/eval_xg.py` loads the saved JSON model, calculates
`predict_proba`, applies an evaluation threshold, and computes the metrics
from the resulting labels and probabilities. It also generates a confusion
matrix and gain-based feature-importance chart.

The stored CSV files are snapshots from previous evaluation runs. Before
using a metric as evidence of current performance, verify which input file and
threshold were used for that run. The evaluation script's default entry point
currently points to `renewal/processed/final_prepared.csv`; a strict
generalization test should instead evaluate the held-out
`renewal/processed/test.csv` that was not used for fitting.

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
- [XGBoost trainer](../renewal/trainer_xg.py)
- [XGBoost prediction and explanations](../renewal/renewal_predict.py)
- [Saved XGBoost metrics](../renewal/outputs/xgboost_saved_model_results.csv)
- [Engineered baseline metrics](../renewal/outputs/xgboost_engineered_results.csv)
- [Recommender evaluator](../recommender/evaluator.py)
