# Renewal Prediction

The app's renewal percentage, renewal groups, risk filters, and the at-risk
coupon command all come from one XGBoost model. This page explains what the
model looks at, how it is trained and tested, and how to read its scores.

The recommendation cards are a separate feature, described in
[Snaplytics/docs/recommendations-and-suggestions.md](../Snaplytics/docs/recommendations-and-suggestions.md).

## Live model: XGBoost

The app's renewal percentage, renewal groups, risk filters, the at-risk coupon
command, and `predicted_renewal` all come from one XGBoost model trained on past
bookings from the live database (Supabase). The current version is
`xgboost-v3`.

### Which bookings count

Only bookings with a `BOOKED` status count. An `Ongoing` booking is still in
progress, so it is not treated as booking history. A booking's date is its
session date. If the session date is missing, the date the booking was created
is used instead.

Training uses the bookings of every customer, including customers later moved
to Internal Records, because those bookings really happened. Predictions in
the app cover only customers who have not been deleted.

### What the model looks at

The model uses five inputs for each customer:

| Input | Meaning |
|---|---|
| `booking_strength` | A combined booking score, shown below (0 to 0.99). |
| `total_bookings` | Number of accepted bookings. |
| `bookings_last_365_days` | Accepted bookings in the last 365 days. |
| `renewed_within_366` | 1 if any two consecutive booking days are 1 to 366 days apart, else 0. Any pair counts, not only the two most recent. |
| `days_since_last_booking` | Days from the latest accepted booking to today. A booking on a future date counts as 0 days. |

The model is forced to follow fixed directions. A higher booking strength, more
bookings, more bookings in the last year, and a past renewal can only raise the
chance. More days since
the last booking can only lower it. This stops the model from learning patterns
that reverse later.

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

It is only an input. XGBoost decides how much it matters. In the
time-separated test, adding it raised ROC-AUC from 0.516 to 0.561 and helped
on every test date where the model learned anything. Other inputs were tested
and not used:

- seasonality, package type, add-on spend, customer tenure, and booking gaps
  did not help or made results worse; and
- acquisition source (Walk-In, Booked a Schedule) looked helpful but is not
  reliable. Customers added since 2026 have no source recorded, and customers
  with no source renewed only 3% of the time, so the model would mark every
  new customer as unlikely.

### How it is trained

The model is trained with:

```powershell
python manage.py train_renewal_xgboost
```

The command reads every accepted booking from the live database (Supabase),
past and current, and prints which database and how many bookings it used.
Supabase holds all booking history. The older export in
`Snaplytics/renewal/raw/merged_bookings.csv` (1,959 bookings) is fully
contained in Supabase, so it is not read separately. It then builds one
training row per customer at every month-end, using only what was known on that
date. The label is whether the customer booked again within the next 365 days.
Only month-ends whose full 365-day outcome is already known are used.

`xgboost-v3` was retrained on 2026-11-15, after all customer data was replaced
with the cleaned workbook `HEIGEN BOOKINGS.xlsx` (`import_heigen_bookings`).
It used all 2,640 accepted bookings from 2,178 customers. Bookings ran from
2024-02-25 to 2026-10-31. That gave 19,401 rows (2,280 renewals) from
month-ends 2024-02-29 to 2025-10-31. Bookings after 2025-10-31 are still used:
they decide whether earlier customers renewed. On the training rows,
the average predicted chance (11.8%) matched the real renewal rate (11.8%).
The settings were not changed: other tree settings tested on the new data did
not score better than noise.

The command saves:

- the model: `Snaplytics/backend/ml/renewal_xgboost.json`;
- its settings and test results: `Snaplytics/backend/ml/renewal_xgboost_meta.json`;
  and
- test results for the dashboard: `Snaplytics/renewal/outputs/renewal_xgboost_live_metrics.csv`.

Use `--dry-run` to run the test without saving a new model. The app reloads the
model automatically when the files change.

### How well it works

Before training the final model, the command runs a fair test. For each test
month-end, the model learns only from month-ends whose 365-day outcome had
already ended by that date. It is then scored on the test month-end.

Results of `xgboost-v3`, averaged over 7 test dates (2025-04-30 to 2025-10-31):

| Measure | `xgboost-v3` | Random or always-no |
|---|---|---|
| ROC-AUC | 0.574 | 0.500 (random) |
| PR-AUC | 0.140 | 0.107 (random) |
| Top 10% of customers who renewed | 16.2% | 10.7% (average) |
| Accuracy | 76.5% | 89.3% (always-no) |
| Precision | 20.4% | — |
| Recall | 21.5% | — |
| MCC | 0.065 | 0 |

On the last test date, with the most training data, ROC-AUC was 0.622 and
19.5% of the top 10% renewed. On the first test date the model had only 323
training rows and gave every customer the same score (ROC-AUC 0.500).

On the data before the 2026-11-15 import, the same test gave ROC-AUC 0.557
over 5 test dates.

On this test the model ranks customers somewhat better than random. Its accuracy is below simply saying "no renewal" for everyone. The
fair test can only train on the first months of data, because each training
date needs a full year of known outcomes. The final model is trained on all 19
month-ends, far more than any test had, so it may do better than this test
shows. That cannot be proven until new outcomes arrive.

The model is not accurate enough for automatic customer decisions. Use it only
to order a follow-up list.

### Renewal groups

Each customer is placed in a group by their predicted chance. The cutoffs are
set during training by rank among today's customers with bookings: the top 15%
and the rest. Customers with the same booking facts get the same chance, so
group sizes are close to these shares but not exact.

| Group | Text shown | Chance (`xgboost-v3`) |
|---|---|---|
| `likely` | Likely to renew | 12.0% or more |
| `unlikely` | At risk of not renewing | below 12.0% |

The group names describe a customer's chance compared with other customers.
Even in the highest group, most customers do not book again within a year.
`predicted_renewal` is true for the `likely` group.

The customer list API returns both `renewalRate` (the chance) and
`renewalBand` (the group). The staff app filters customers by `renewalBand`.
The renewal panel API also returns `model_version`.

### When the model is unavailable

There is no fallback model. If the model files are missing or cannot be
loaded, the app logs an error and:

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
# Retrain the live XGBoost model from past bookings (runs the fair test first)
python manage.py train_renewal_xgboost

# Run only the fair test, without saving a new model
python manage.py train_renewal_xgboost --dry-run
```

Retraining is not scheduled. Run `train_renewal_xgboost` by hand when new
booking data has been added, for example once a month or after an import.
Each retrain replaces the live model and recalculates the group cutoffs.

The shadow mode that used to record daily predictions for a year-later check
was removed on 2026-11-16. The time-separated test above gives the same kind
of check on past data, without waiting a year.
