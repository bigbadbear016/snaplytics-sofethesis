# Renewal Prediction and Shadow Workflow

## What the whole renewal system does

There are two separate parts of the renewal system:

1. **Live renewal prediction** — the XGBoost model that the app uses when it
   shows renewal information. It is the only renewal model in the app.
2. **Shadow and training workflow** — a safe background process that records
   the model's predictions, checks them against what customers really do, and
   prepares possible improvements.

The shadow and training workflow does not automatically replace the live
model. This separation gives the team a safe rollback path and time to review
results before changing customer-facing behavior.

The recommendation cards are a separate feature. They use booking history and
popularity information and are not changed by the renewal workflow.

## What shadow mode is

Shadow mode is a safe way to test renewal predictions using real booking
data. The system makes a prediction and saves it for later review, but saving
it does not change the customer experience.

It does not:

- change the renewal prediction shown in the live app;
- send messages or reminders to customers;
- decide whether a customer receives a service; or
- replace the live renewal model.

It only records predictions and checks them against what happens later.

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
the app and the shadow run cover only customers who have not been deleted.

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

`xgboost-v3` was trained on 2026-11-14, after the data cleanup described in
"Booking data cleanup" below. It used all 2,559 accepted bookings from 2,093
customers. Bookings ran from 2024-02-25 to 2026-08-31. That gave 16,382 rows
(2,127 renewals) from month-ends 2024-02-29 to 2025-08-31. Bookings after 2025-08-31 are still used:
they decide whether earlier customers renewed. On the training rows,
the average predicted chance (13.0%) matched the real renewal rate (13.0%).

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

Results of `xgboost-v3`, averaged over 5 test dates (2025-04-30 to 2025-08-31):

| Measure | `xgboost-v3` | Random or always-no |
|---|---|---|
| ROC-AUC | 0.557 | 0.500 (random) |
| PR-AUC | 0.145 | 0.121 (random) |
| Top 10% of customers who renewed | 18.0% | 12.1% (average) |
| Accuracy | 71.5% | 87.9% (always-no) |
| Precision | 18.2% | — |
| Recall | 23.8% | — |
| MCC | 0.032 | 0 |

On the last test date, with the most training data, ROC-AUC was 0.589 and
21.3% of the top 10% renewed.

On this test the model ranks customers somewhat better than random. Its accuracy is below simply saying "no renewal" for everyone. The
fair test can only train on the first months of data, because each training
date needs a full year of known outcomes. The final model is trained on all 19
month-ends, far more than any test had, so it may do better than this test
shows. That cannot be proven until new outcomes arrive.

The model is not accurate enough for automatic customer decisions. Use it only
to order a follow-up list.

### Renewal groups

Each customer is placed in a group by their predicted chance. The cutoffs are
set during training by rank among today's customers with bookings: the top 5%,
the next 10%, the next 15%, and the rest. Customers with the same booking facts
get the same chance, so group sizes are close to these shares but not exact.

| Group | Text shown | Chance (`xgboost-v3`) |
|---|---|---|
| `very_likely` | Highest chance to renew | 16.7% or more |
| `likely` | Higher chance to renew | 12.2% to 16.7% |
| `unlikely` | Needs follow-up | 9.6% to 12.2% |
| `very_unlikely` | At risk of not renewing | below 9.6% |

The group names describe a customer's chance compared with other customers.
Even in the highest group, most customers do not book again within a year.
`predicted_renewal` is true for the `likely` and `very_likely` groups.

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
- stops the at-risk coupon command with an error; and
- fails the daily shadow run, which shows an alert in the staff app.

The packaged staff app bundles the model files because they sit inside the
`backend` package. The packaged build has not yet been tested with the model.

## Booking data cleanup

On 2026-11-14 the live database was cleaned with
`python manage.py clean_booking_data --apply --delete-pending` before training
`xgboost-v3`:

- 331 duplicate bookings from the 2026-11-01 import were deleted. Each was
  identical to another booking in every field. The loyalty points credited for
  them were subtracted.
- 27 duplicate customer records (same name and same phone or email) were
  merged into their matching customer and moved to Internal Records.
- 11 Pending bookings, all test data, were deleted with their add-on rows.
- 2,278 leftover `nan` text values were cleared.

The backup of every change is in `Snaplytics/backups/` (git-ignored; it holds
customer personal data). Prices that differ from the package price were not
changed, because the 2026-11-01 import has no add-on or discount detail.

The model also counts identical duplicate bookings once on its own, so a
future duplicate import does not inflate a customer's booking count.

## How shadow predictions are saved

The daily shadow run reads accepted bookings from the live database and saves
the live model's prediction for every active customer.

Each prediction is saved together with the customer, the date, the model
version, and a copy of the booking information used at that time. The copy
includes all five model inputs, plus:

- average booking value;
- total amount spent;
- number of different package types used;
- number of days between the two most recent bookings; and
- whether any booking date is missing.

Each saved prediction can therefore be checked again later. Later booking
changes do not rewrite the original evidence.

The saved value is the model's chance. **Predicted to renew** means the
customer was in the `likely` or `very_likely` group.

To calculate the inputs, the daily run also refreshes each customer's stored
renewal profile, which the live app reads. The refresh uses the same bookings
and the same calculation as the live app, so the values shown to staff do not
change because of the shadow run.

Running the daily job again on the same day is safe. It updates that day's
record instead of creating a duplicate for the same customer and model.

Shadow records saved before November 2026 belong to `heuristic-v1`, a
hand-written score that is no longer used as a model, and to `xgboost-v1`,
`xgboost-v2`, and earlier runs of the XGBoost model. They stay in the database. Reports and training use the live
model version unless another version is given.

## How the real outcome is decided

Each prediction receives an outcome date 365 days after the prediction date.
The prediction is not counted in the final metrics until that period has
finished.

When the outcome is checked, the system looks for an accepted booking from
the same customer that happened:

- after the original prediction date; and
- on or before the 365-day outcome date.

If a booking is found, the actual outcome is **renewed**. If no booking is
found, the actual outcome is **did not renew**.

This waiting period is important. A recent prediction cannot fairly be called
right or wrong before the customer has had enough time to book again.

## How the metrics work

Metrics are calculated only from mature predictions with a known outcome.
The report first sorts every prediction into four simple groups:

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

The report prints the four counts as:

```text
TP=... FP=... TN=... FN=...
```

These counts are more useful than one score by itself because they show what
kind of mistakes the system makes. For example, many false negatives mean
that the system is missing real renewers, while many false positives mean
that its renewal suggestions are often too optimistic.

## Example

Suppose 100 mature predictions produce these results:

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

## Daily, monthly, and quarterly flow

### Daily shadow run

The daily task first applies any pending database migrations. It then reads
live bookings and saves the live model's prediction for each customer.
A successful run is recorded quietly. A failed prediction run creates a
notification in the staff application.

If the database migration step fails, the prediction step does not start and
no failure is recorded in the app. Check the Windows Task Scheduler history
for that kind of failure.

### Outcome evaluation

The evaluation task finds predictions whose 365-day window has ended and
records whether each customer booked again. It does this for every model
version.

### Monthly review and challenger training

The monthly task runs two steps in order:

1. It evaluates mature outcomes (the same step as `evaluate_renewal_shadow`).
2. It requests challenger training.

Automatic training is off by default. When it is off, the monthly task creates
a pending request that an ADMIN or OWNER must approve. When it is on, training
starts automatically, but a notification is still shown.

Training creates a candidate model for review. It does not replace the live
model automatically. It is an experiment for comparison, not an automatic
production replacement.

A training request is created every month, even when there is not yet enough
data. The training step then checks the data and stops without creating a
model if any of these is true:

- there are fewer than 100 customers with a mature prediction;
- fewer than 20 of those customers renewed; or
- the test period does not contain both renewers and non-renewers.

When there is enough data, training works like this:

- It uses only the most recent mature prediction for each customer. Customers
  with no bookings are skipped, because the live model always gives them 0%.
- It sorts those predictions by date. The oldest 80% train the model and the
  newest 20% test it, so the model is always tested on later data.
- The model is an XGBoost classifier with the same five inputs, directions,
  and settings as the live model. It reads the inputs from the saved booking
  copy.
- It flags as many test customers as the share that renewed in training.
- The test report includes accuracy, precision, recall, MCC, PR-AUC, ROC-AUC,
  and the always-no baseline.
- The live model is scored on the same test customers, using the chance and
  group it saved at prediction time.

The candidate is kept only if it beats the live model on the same test
customers: its PR-AUC must be higher and its MCC must not be lower. PR-AUC is
used because it measures how well renewers are ranked when renewals are rare.

If the candidate passes, the model is saved in `Snaplytics/renewal/models/`.
If it does not pass, no model file is saved. In both cases the metrics,
including the live model's scores and the `beats_live_model` result, are saved
in `Snaplytics/renewal/outputs/` and attached to the training request.

## Notifications and permissions

The Electron staff app shows renewal workflow notifications:

- Staff can see training and shadow status notifications.
- Staff can see when a shadow run fails.
- ADMIN and OWNER users can approve a manual training request.
- ADMIN and OWNER users can turn automatic monthly training on or off.

Automatic training is off by default. When it is off, the monthly job creates
a pending request instead of starting training immediately. When it is on,
training may start automatically, but the app still shows a notification so
the activity is visible to staff and administrators.

A pending training request stays in the notification panel until an ADMIN or
OWNER approves it. An approved request, whether started automatically or
approved by a person, stays visible for 30 days after it was requested. The
panel shows whether the request was started automatically or approved by a
person.

The failure alert is based on the most recent daily run only. A later monthly
run does not hide a failed daily run. Daily successful shadow runs are quiet,
so the notification panel is not filled with routine messages.

## What the schedule does

The system does not run an internal timer inside Django. Windows Task
Scheduler starts the jobs:

| Schedule | Job | Purpose |
|---|---|---|
| Daily | `run_renewal_shadow.ps1` | Save current predictions from live bookings. |
| Monthly | `run_renewal_monthly.ps1` | Evaluate mature outcomes and request or start challenger training. |
| Quarterly review | Team review | Decide whether any candidate is strong enough to consider promoting. |

If the daily job fails, the failure is recorded and shown as an alert. A
successful run records how many predictions were created or updated.

## Data safety and review rules

The workflow follows these rules:

- It reads live booking data but does not edit bookings.
- It refreshes stored renewal profiles with the same calculation the live app
  uses, so the live values do not change.
- It does not send customer messages.
- It does not automatically promote a candidate model.
- It uses the XGBoost model as the only live model. There is no fallback.
- It waits for the full outcome period before counting a prediction in metrics.
- It compares results with the always-no baseline.
- It requires ADMIN or OWNER approval when automatic training is disabled.

The team should review not only the model scores, but also whether any
follow-up based on the predictions produces useful business results.

### Quarterly decision

The team should review mature metrics over a useful time period and compare
the candidate with:

- the live XGBoost model;
- the always-no baseline;
- the number of customers reached; and
- the business result of any approved follow-up.

A model should only become the live model after it shows reliable benefit on
newer, time-separated data and the team approves the change.

XGBoost was made the only live model in November 2026 by team decision,
before any shadow results existed. On the fair backtest `xgboost-v3` ranks
customers somewhat better than random (ROC-AUC 0.557). The first mature shadow results arrive in
November 2027.

## Commands

Run these commands from the `Snaplytics` folder:

```powershell
# Retrain the live XGBoost model from past bookings (runs the fair test first)
python manage.py train_renewal_xgboost

# Run only the fair test, without saving a new model
python manage.py train_renewal_xgboost --dry-run

# Save today's shadow predictions from the live model
python manage.py run_renewal_shadow

# Fill in outcomes for predictions older than 365 days (all versions)
python manage.py evaluate_renewal_shadow

# Report metrics for predictions with known outcomes
python manage.py report_renewal_shadow_metrics
python manage.py report_renewal_shadow_metrics --model-version xgboost-v1
```

Retraining is not scheduled. Run `train_renewal_xgboost` by hand when new
booking data has been added. Each retrain replaces the live model and
recalculates the group cutoffs.

The Windows Task Scheduler scripts run the daily and monthly jobs
automatically. See the backend README for setup details.
