# Renewal Prediction and Shadow Workflow

## What the whole renewal system does

There are two separate parts of the renewal system:

1. **Live renewal prediction** — the current formula used by the app when it
   shows renewal information.
2. **Shadow and training workflow** — a safe background process that measures
   the current formula and prepares possible improvements.

The shadow and training workflow does not automatically replace the live
prediction. This separation gives the team a safe rollback path and time to
review results before changing customer-facing behavior.

The recommendation cards are a separate feature. They use booking history and
popularity information and are not changed by the renewal shadow workflow.

## What shadow mode is

Shadow mode is a safe way to test renewal predictions using real booking
data. The system makes a prediction and saves it for later review, but it
does not use that prediction to change the customer experience.

It does not:

- change the renewal prediction shown in the live app;
- send messages or reminders to customers;
- decide whether a customer receives a service; or
- replace the current live renewal formula.

It only records predictions and checks them against what happens later.

## What customers see today

The live app continues to use the existing renewal formula. The shadow
prediction is recorded in the background and is not used to make customer
decisions, send outreach, or change the renewal information shown by the app.

This means the workflow can collect real evidence while the existing live
behavior remains stable. If a candidate model performs poorly, the live app
continues using the existing formula.

## How a prediction is made

The daily shadow run reads booked records from the live database. The database
is Supabase when the production environment is configured normally. Only
bookings with a `BOOKED` status are included in renewal prediction features.
An `Ongoing` booking is still in progress, so it is not treated as renewal
history.

For each active customer, the system looks at simple booking history:

- number of accepted bookings;
- average booking value;
- total amount spent;
- number of bookings in the last year;
- number of different package types used;
- number of days since the previous booking;
- whether the customer has renewed before; and
- whether any booking date is missing.

The current shadow version is called `heuristic-v1`. It is a transparent score,
not the future trained model. It starts with a small renewal chance and raises
that score when the customer has stronger booking signals:

- more recent booking activity;
- more total bookings;
- a higher average booking value; and
- a previous booking gap of no more than about one year.

The score is kept between 0% and 99%. A score of 50% or higher is currently
recorded as **predicted to renew**. A score below 50% is recorded as **not
predicted to renew**.

The score is saved together with the customer, the date, the model version,
and a copy of the booking information used at that time. This makes the
prediction traceable and prevents later booking changes from rewriting the
original evidence.

Running the daily job again on the same day is safe. It updates that day's
record instead of creating a duplicate for the same customer and model.

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
Always-no baseline = (TN + FN) / total predictions
```

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
- Always-no baseline: `(45 + 10) / 100` = **55%**
- Precision: `20 / (20 + 25)` = **44%**
- Recall: `20 / (20 + 10)` = **67%**

In this example, the model is better than always saying no overall, but less
than half of its positive predictions are correct. That may be acceptable for
an inexpensive reminder list, but it would not be strong enough for an
automatic customer decision.

## Daily, monthly, and quarterly flow

### Daily shadow run

The daily task reads live bookings and saves the current prediction for each
customer. A successful run is recorded quietly. A failed run creates a
notification in the staff application.

### Outcome evaluation

The evaluation task finds predictions whose 365-day window has ended and
records whether each customer booked again.

### Monthly review and challenger training

The monthly task evaluates mature outcomes and prepares a challenger model
when there is enough data. Automatic training is off by default. When it is
off, ADMIN or OWNER approval is required. When it is on, training can start
automatically, but a notification is still shown.

Training creates a candidate model for review. It does not replace the live
heuristic automatically.

The challenger model is trained only when enough mature shadow results are
available. It is an experiment for comparison, not an automatic production
replacement. The monthly process uses the available mature shadow records and
keeps the candidate model and its metrics for review.

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

Training notifications remain available for 30 days. Daily successful shadow
runs are normally quiet so the notification panel is not filled with routine
messages.

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
- It does not send customer messages.
- It does not automatically promote a candidate model.
- It keeps the live heuristic as the current champion and fallback.
- It waits for the full outcome period before counting a prediction in metrics.
- It compares results with the always-no baseline.
- It requires ADMIN or OWNER approval when automatic training is disabled.

The team should review not only the model scores, but also whether any
follow-up based on the predictions produces useful business results.

### Quarterly decision

The team should review mature metrics over a useful time period and compare
the candidate with:

- the current live heuristic;
- the always-no baseline;
- the number of customers reached; and
- the business result of any approved follow-up.

A model should only become the live model after it shows reliable benefit on
newer, time-separated data and the team approves the change.

## Commands

Run these commands from the `Snaplytics` folder:

```powershell
# Save today's shadow predictions
python manage.py run_renewal_shadow

# Fill in outcomes for predictions older than 365 days
python manage.py evaluate_renewal_shadow

# Report metrics for predictions with known outcomes
python manage.py report_renewal_shadow_metrics
```

The Windows Task Scheduler scripts run the daily and monthly jobs
automatically. See the backend README for setup details.
