# Renewal Prediction

The app's renewal percentage, renewal groups, risk filters, and the at-risk
coupon command all come from one model: XGBoost that starts from a
logistic-regression estimate. This page explains what the model looks at, how
it is trained and tested, and how to read its scores.

Package recommendation is a separate feature, described in
[recommendation-model.md](recommendation-model.md). The request flow is in
[Snaplytics/docs/recommendations-and-suggestions.md](../Snaplytics/docs/recommendations-and-suggestions.md).

## Live model: XGBoost with a logistic-regression start

The app's renewal percentage, renewal groups, risk filters, the at-risk coupon
command, and `predicted_renewal` all come from one model trained on past
bookings from the live database (Supabase). The current version is
`xgboost-lr-v2` (algorithm `xgboost_lr`).

The model works in two steps:

1. A logistic regression turns the customer's inputs into a starting log-odds
   of renewal.
2. XGBoost starts from that value (its `base_margin`) and adds 50 small trees
   that correct it. The final probability comes from XGBoost.

The logistic-regression start makes the model useful while data is scarce. In
the fair test it ranked customers well from the first test date, where XGBoost
alone could not tell customers apart (see "How well it works").

### Which bookings count

Only bookings with a `BOOKED` status count. An `Ongoing` booking is still in
progress, so it is not treated as booking history. A booking's date is its
session date. If the session date is missing, the date the booking was created
is used instead.

Training uses the bookings of every customer, including customers later moved
to Internal Records, because those bookings really happened. Predictions in
the app cover only customers who have not been deleted.

### What the model looks at

The model uses 15 inputs for each customer, computed by `features_at()` in
[backend/renewal_model.py](../Snaplytics/backend/renewal_model.py). Training
and live predictions use the same function.

| Input | Meaning |
|---|---|
| `booking_strength` | A combined booking score, shown below (0 to 0.99). |
| `total_bookings` | Number of accepted bookings. |
| `bookings_last_365_days` | Accepted bookings in the last 365 days. |
| `renewed_within_366` | 1 if any two consecutive booking days are 1 to 366 days apart, else 0. Any pair counts, not only the two most recent. |
| `days_since_last_booking` | Days from the latest accepted booking to today. A booking on a future date counts as 0 days. |
| `log_avg_booking_value` | log(1 + average booking value). |
| `last_occasion_<type>` (9 inputs) | 1 if the package of the latest booking is tagged with that occasion (`graduation`, `christmas`, `valentines`, `birthday`, `family`, `couple`, `maternity`, `newborn`, `wedding`); all 0 for `general`. |

The XGBoost trees are forced to follow fixed directions for the first five
inputs. A higher booking strength, more bookings, more bookings in the last
year, and a past renewal can only raise their output; more days since the last
booking can only lower it. Spend and occasion have no fixed direction. The
logistic-regression start is not constrained, so the complete model was
checked on 3,200 customer profiles: no extra booking lowered the probability,
and no longer gap since the last booking raised it.

A customer with no accepted bookings always gets 0% and the lowest group.

`booking_strength` is a formula that sums capped booking signals:

```text
If the customer has no accepted bookings, the strength is 0.
Otherwise:
  strength = 0.05
           + (bookings in the last 365 days / 8),  at most 0.40
           + (total bookings / 10),                at most 0.25
           + (average booking value / 15,000),     at most 0.15
           + 0.15 if the customer has renewed before
```

It is only an input; the model decides how much it matters.

### Occasion inputs

Every category and package carries an `occasion` tag
([backend/occasions.py](../Snaplytics/backend/occasions.py)). A new or renamed
item gets a keyword guess at once, then Groq refines it in the background.
A tag chosen by staff is locked (`occasion_locked`) and never changed
automatically. `python manage.py tag_occasions` tags existing items.

So far, 92.5% of past bookings used `general` packages, 6.5% `christmas`, and
1.0% `valentines`. The other seven occasion inputs are 0 for every customer,
so they carry no weight until bookings with those packages exist. The
occasion inputs barely change the overall test results, but they matter for
individual customers: a booking with a Christmas package was followed by
another booking within a year 17.8% of the time, against 14.2% for `general`
packages.

### Inputs tested and not used

- The month of the last booking lowered the fair-test ROC-AUC (to 0.537 with
  XGBoost alone), so it was dropped.
- Letting `days_since_last_booking` rise again near the one-year mark could
  not be tested. 30.1% of return visits happen 10 to 14 months after the
  previous booking, but the training rows available in the fair test never
  reach the one-year mark. Re-test once the data spans three or more years
  (see the `shortcut:` note at `MONOTONE` in the training command).
- Seasonality, package type, add-on spend, customer tenure, and booking gaps
  did not help or made results worse.
- Acquisition source is empty for every customer since the 2026-11-15 import.

### How it is trained

The model is trained with:

```powershell
python manage.py train_renewal_xgboost
```

The command reads every accepted booking from the live database (Supabase),
past and current, and prints which database and how many bookings it used. It
then builds one training row per customer at every month-end, using only what
was known on that date. The label is whether the customer booked again within
the next 365 days. Only month-ends whose full 365-day outcome is already known
are used.

`xgboost-lr-v2` was trained on 2026-11-20 from 2,642 accepted bookings by
2,179 customers (2024-02-25 to 2026-11-18). That gave 19,401 rows (2,280
renewals) from month-ends 2024-02-29 to 2025-10-31. Later bookings are still
used: they decide whether earlier customers renewed. On the training rows, the
average predicted chance (11.8%) matched the real renewal rate (11.8%).

Settings of the live model:

| Part | Settings |
|---|---|
| Logistic regression | standardized inputs, `C = 0.03`, `max_iter = 2000` |
| XGBoost | 50 trees, `max_depth 2`, `learning_rate 0.027`, `subsample 0.96`, `colsample_bytree 0.65`, `min_child_weight 100`, `reg_lambda 4.3`, `reg_alpha 0.5`, `gamma 0.5`, log loss |

These settings came from a random search of 220 configurations. Each was
picked on the first four fair-test dates (by ROC-AUC + PR-AUC) and checked on
the last three, which the search never saw. The baselines in the comparison
keep plain settings (XGBoost: 150 trees, `max_depth 2`, `learning_rate 0.05`,
`subsample 0.8`, `min_child_weight 20`, `reg_lambda 10`; logistic regression:
`C = 1`), so the comparison stays like-for-like.

The command saves:

- the XGBoost trees: `Snaplytics/backend/ml/renewal_xgboost.json`;
- the logistic-regression numbers (input means, scales, weights, intercept) as
  plain JSON, not a pickle: `Snaplytics/backend/ml/renewal_logreg.json`;
- the settings, cut-off, and test results: `Snaplytics/backend/ml/renewal_xgboost_meta.json`
  (its `algorithm` field tells the app which files to load);
- the live model's test results for the dashboard: `Snaplytics/renewal/outputs/renewal_xgboost_live_metrics.csv`;
  and
- all four algorithms side by side: `Snaplytics/renewal/outputs/renewal_algorithm_comparison.csv`.

Use `--dry-run` to run the test without saving a new model. The app reloads the
model automatically when the files change.

### How well it works

Before training the final model, the command runs a fair test. For each test
month-end, every algorithm learns only from month-ends whose 365-day outcome
had already ended by that date. It is then scored on the test month-end.

Results averaged over 7 test dates (2025-04-30 to 2025-10-31), all on the same
15 inputs:

| Measure | XGBoost + LR start (live) | XGBoost alone | Logistic regression | Random forest | Random or always-no |
|---|---|---|---|---|---|
| ROC-AUC | 0.607 | 0.581 | 0.593 | 0.570 | 0.500 (random) |
| PR-AUC | 0.188 | 0.147 | 0.187 | 0.137 | 0.107 (random) |
| Top 10% of customers who renewed | 22.7% | 17.2% | 21.9% | 16.1% | 10.7% (average) |
| Accuracy | 85.5% | 72.6% | 84.5% | 85.9% | 89.3% (always-no) |
| Precision | 25.1% | 17.9% | 23.5% | 13.3% | — |
| Recall | 18.6% | 31.7% | 19.5% | 6.5% | — |
| MCC | 0.137 | 0.085 | 0.128 | 0.023 | 0 |

On the first test date, with only 323 training rows, the live model reached
ROC-AUC 0.613 while XGBoost alone gave every customer the same score (0.500).
On the last test date, with 3,874 rows, both reached about 0.63, and 25.6% of
the live model's top 10% renewed. The logistic-regression start matters most
while data is scarce.

On this test the model ranks customers better than random, and its top 10%
renew about 2.1 times as often as the average customer. Its accuracy is still
below simply saying "no renewal" for everyone. The fair test can only train on
the first months of data, because each training date needs a full year of
known outcomes; the final model is trained on all 21 month-ends.

The model is not accurate enough for automatic customer decisions. Use it only
to order a follow-up list.

### Renewal groups

Each customer is placed in a group by their predicted chance. The cutoff is
set during training by rank among today's customers with bookings: the top 15%
and the rest. Customers with the same booking facts get the same chance, so
group sizes are close to these shares but not exact.

| Group | Text shown | Chance (`xgboost-lr-v2`) |
|---|---|---|
| `likely` | Likely to renew | 13.3% or more |
| `unlikely` | At risk of not renewing | below 13.3% |

At training time, 327 customers were in the `likely` group. The group names
describe a customer's chance compared with other customers. Even in the
highest group, most customers do not book again within a year.
`predicted_renewal` is true for the `likely` group.

The customer list API returns both `renewalRate` (the chance) and
`renewalBand` (the group). The staff app filters customers by `renewalBand`,
and the Customer Data table colors the renewal bar green for `likely`. The
renewal panel API also returns `model_version`.

### When the model is unavailable

There is no fallback model. If a model file the metadata names is missing or
cannot be loaded (`renewal_xgboost.json`, `renewal_logreg.json`, or the
metadata itself), the app logs an error and:

- shows "—" instead of a renewal percentage;
- returns `null` for `renewalRate`, `renewalBand`, and `predicted_renewal`;
- shows "Renewal prediction unavailable" in the renewal panel;
- matches nobody in the renewal risk filters;
- stops the at-risk coupon command with an error.

The packaged staff app bundles the model files because they sit inside the
`backend` package. The packaged build has not yet been tested with the model.

## How the metrics work

The training command's time-separated test scores predictions whose 365-day
outcome is already known. Every scored prediction falls into one of four
groups:

| Result | Meaning |
|---|---|
| True positive (TP) | The system predicted renewal and the customer renewed. |
| False positive (FP) | The system predicted renewal but the customer did not renew. |
| True negative (TN) | The system predicted no renewal and the customer did not renew. |
| False negative (FN) | The system predicted no renewal but the customer renewed. |

### Accuracy

Accuracy answers: **How often was the prediction correct overall?**

```text
Accuracy = (TP + TN) / (TP + FP + TN + FN)
```

It counts both correct renewal predictions and correct no-renewal
predictions. Accuracy can look good when most customers do not renew, even if
the system is not good at finding renewers.

### Always-no baseline

The always-no baseline answers: **What score would we get by saying “no
renewal” for every customer?**

```text
Always-no baseline = (TN + FP) / total predictions
```

TN + FP is the number of customers who did not renew. Saying "no renewal" for
everyone is right for exactly those customers.

This is the most important comparison when renewals are uncommon. If the
model's accuracy is below this baseline, the model is making more total
mistakes than the simple always-no rule. The model may still be useful for
finding some renewers, but accuracy alone does not prove that.

### Precision

Precision answers: **When the system says a customer will renew, how often is
it right?**

```text
Precision = TP / (TP + FP)
```

High precision means fewer wasted follow-ups on customers who do not renew.
For example, 45% precision means about 45 out of every 100 customers marked
as likely to renew actually renewed.

### Recall

Recall answers: **Of all customers who really renewed, how many did the system
find?**

```text
Recall = TP / (TP + FN)
```

High recall means the system misses fewer actual renewers. For example, 53%
recall means the system found about 53 out of every 100 customers who later
renewed.

Precision and recall describe different business choices. A reminder team
with limited time may prefer higher precision. A team that wants to find as
many possible renewers as it can may prefer higher recall.

### Confusion matrix

These four counts are more useful than one score by itself because they show what
kind of mistakes the system makes. For example, many false negatives mean
that the system is missing real renewers, while many false positives mean
that its renewal suggestions are often too optimistic.

## Example

Suppose 100 scored predictions produce these results:

```text
TP = 20
FP = 25
TN = 45
FN = 10
```

The results would be:

- Accuracy: `(20 + 45) / 100` = **65%**
- Always-no baseline: `(45 + 25) / 100` = **70%**
- Precision: `20 / (20 + 25)` = **44%**
- Recall: `20 / (20 + 10)` = **67%**

In this example, the model makes more total mistakes than always saying no
(65% against 70%). It still finds two thirds of the renewers, and 44% of the
customers it flags renew, against 30% of all customers. That may be
acceptable for an inexpensive reminder list, but it would not be strong
enough for an automatic customer decision.

## Commands

Run these commands from the `Snaplytics` folder:

```powershell
# Retrain the live model (XGBoost with a logistic-regression start);
# runs the fair test for all four algorithms first
python manage.py train_renewal_xgboost

# Run only the fair test, without saving a new model
python manage.py train_renewal_xgboost --dry-run

# Make another algorithm live: xgboost, logistic_regression,
# or auto (best mean fair-test ROC-AUC)
python manage.py train_renewal_xgboost --algorithm xgboost

# Tag existing categories and packages with an occasion
# (--force re-tags unlocked items, --no-ai uses keywords only)
python manage.py tag_occasions
```

Retraining is not scheduled. Run `train_renewal_xgboost` by hand when new
booking data has been added, for example once a month or after an import.
Each retrain replaces the live model and recalculates the group cutoff.

The shadow mode that used to record daily predictions for a year-later check
was removed on 2026-11-16. The time-separated test above gives the same kind
of check on past data, without waiting a year.
