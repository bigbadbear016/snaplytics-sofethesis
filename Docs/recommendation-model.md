# Package Recommendation

The kiosk and the staff app show up to three package recommendation cards for
each customer. This page explains how the cards are chosen, what the SVD++
model looks at, how it is trained and tested, and how to read the results.

Renewal prediction is a separate feature, described in
[renewal-model.md](renewal-model.md). The request flow, response shape, and
card explanations are described in
[Snaplytics/docs/recommendations-and-suggestions.md](../Snaplytics/docs/recommendations-and-suggestions.md).

## How the cards are chosen

Each card is one package plus suggested add-ons. The cards are filled in this
order until there are three:

| Order | Source | Who gets it | Label shown |
|---|---|---|---|
| 1 | `customer_booking_history`: the customer's own most-booked packages | Returning customers | Booking Loyalty |
| 2 | `svdpp`: packages the SVD++ model scores highest, among packages the customer has not booked | Returning customers the model has seen | Similar Customers |
| 3 | `popular_fallback` or `popularity`: the most-booked packages across all customers | Everyone, for any card still empty | Popular Choice |

A returning customer who has booked only one package gets one history card
and two cards from SVD++ or from the best sellers. A new customer gets
three best-seller cards.

The history score is a share: the package's bookings divided by the customer's
total accepted bookings. The SVD++ score is the model's predicted match, from
0 to 1. The popular score is the package's booking count. None of these
scores is a probability that the customer will book the package.

### Which bookings count

Bookings with an `Ongoing` or `BOOKED` status count. `Pending` and `Cancelled`
bookings do not. Bookings made by claiming loyalty points are left out of
every part of the recommender, because the customer chose them for the points,
not as a normal purchase. A booking's date is its session date. If the session
date is missing, the date the booking was created is used instead.

This differs from renewal prediction, which counts only `BOOKED`.

### Add-ons

A history card gets the two add-ons the customer most often took with that
package. Every other card, and any history card with no add-on history, gets
the add-ons most often booked with that package by all customers: up to two on
the customer endpoint, and up to four on the popular endpoint. The model does
not choose add-ons.

## The SVD++ model

SVD++ is a collaborative filtering model. It learns which packages are booked
by the same kinds of customers, and scores packages a customer has not booked
by how well they match that customer's past choices. The current version is
`svdpp-v1`.

### What the model looks at

The model sees only who booked what. It does not see prices, dates, seasons,
or customer details. Training data is one row per customer and item:

| Row | Rating |
|---|---|
| A package the customer booked | 1 |
| An add-on the customer booked (`addon::<id>`) | 1 |
| Two packages the customer never booked, picked at random (seed 42) | 0 |

Add-ons are training rows so that customers with the same add-on choices count
as similar, but the model only ranks packages. Settings: 50 factors, 20
training rounds (epochs).

The model can only score customers and packages it saw in training. A customer
whose first booking came after the last training gets no SVD++ cards, and
their empty cards are filled from the best sellers.

### How it is trained

The model is trained with:

```powershell
python manage.py train_package_recommender
```

The command reads every accepted booking from the live database (Supabase),
runs the time-separated test below, then trains the final model on all
bookings and saves it.

`svdpp-v1` was trained on 2026-11-15, after all customer data was replaced with
the cleaned workbook `HEIGEN BOOKINGS.xlsx`. It used all 2,640 accepted bookings
from 2,178 customers (350 with two or more bookings). Bookings ran from
2024-02-25 to 2026-10-31. That gave 10,481 rating rows (6,125 booked and 4,356
not booked) over 35 items (packages and add-ons).

The command saves:

- the model: `Snaplytics/recommender/models/surprise_model.pkl`; and
- its settings and test results: `Snaplytics/recommender/models/surprise_model_meta.json`.

Use `--dry-run` to run the test without saving a new model. The app reloads the
model automatically when the file changes.

The model needs the `scikit-surprise` package, which is listed separately in
`Snaplytics/requirements-ml.txt`.

### SVD++ is not active on the Starter

The Starter's install step installs only `Snaplytics/requirements.txt`, so
`scikit-surprise` is not installed in the backend environment. On the Starter
the app cannot load the model and adds no SVD++ cards. The second and third
cards always come from the best sellers. This is the "no model" rule in the
test below, which scored slightly higher than the rule with SVD++ on this data,
so recommendations are not worse because of it.

`requirements-ml.txt` pins `scikit-surprise==1.1.4`, which has no ready-made
install package for the backend's Python 3.12; only 1.1.5 has one. To turn
SVD++ on, install 1.1.5 and restart the backend. Without the package,
`train_package_recommender` also stops with `No module named 'surprise'`.

## How well it works

### Returning customers

Before training the final model, the command runs a fair test. For each split
date, a model learns only from bookings before that date. It is then tested on
later bookings by customers it had already seen. A hit means the package the
customer actually booked was among the three cards.

Results on the data imported on 2026-11-15, over 6 split dates (2025-06-01 to
2026-04-01, 113 to 215 test bookings each):

| Rule | Hit Rate@3 |
|---|---|
| Own history, then SVD++ (the rule when SVD++ is installed) | 79.1% |
| SVD++ only | 77.6% |
| Own history, then best sellers (the rule on the Starter) | 80.3% |
| Three random packages | about 12% |

The first card of the history-then-SVD++ rule was right 50.3% of the time.
The random row is 3 of the 25 active packages.

SVD++ does not improve accuracy on this data. 84% of customers have only one
booking, and three packages (Delight 45%, Allure 25%, Ecstasy 8%) make up 77%
of all bookings, so the best sellers are hard to beat. The differences between
the rules are a few bookings per split date.

### New customers

The training command does not test new customers. A one-time check on
2026-11-17 used the same split dates: for each customer whose first booking was
on or after a split date, the three best sellers before that date were
compared with the package they booked.

| Rule | Hit Rate@3 | First card right |
|---|---|---|
| Three best sellers | 80.0% | 49.6% |

The same customers are counted again at later split dates, so this is an
average over split dates, not 80% of distinct customers.

### What the results mean

The cards usually include the package the customer goes on to book, because
most customers book one of a few best-selling packages. The recommender does
not learn much beyond that on the current data. It is suitable for putting
likely packages first, not for predicting what a specific customer wants.

## When the model is unavailable

There is no error shown to the customer. If `scikit-surprise` is missing, the
model file is missing or cannot be read, or the model has never seen the
customer, the app adds no SVD++ cards and fills the empty cards from the best
sellers. A model file that cannot be loaded, including when `scikit-surprise`
is missing, is written to the backend log. A missing model file is not.

If there are no accepted bookings at all, the popular endpoint returns active
packages in catalog order, with no score.

## How the metrics work

The recommender ranks packages, so it is not scored like the renewal model.
There is no "yes" or "no" answer to count as right or wrong. Instead, each
test booking asks one question: was the booked package in the cards?

### Hit Rate@3

Hit Rate@3 answers: **How often was the booked package among the three
cards?**

```text
Hit Rate@3 = test bookings whose package was in the 3 cards / all test bookings
```

The kiosk shows three cards, so this matches what a customer sees.

### First card right

First card right answers: **How often was the booked package the first
card?**

```text
First card right = test bookings whose package was the first card / all test bookings
```

It is stricter than Hit Rate@3 and shows how well the order works.

### Random baseline

The random baseline answers: **What would three random cards score?**

```text
Random baseline = 3 / number of active packages
```

With 25 active packages, that is 12%. A rule must beat this to be useful.

### Best-seller baseline

On this data the more important comparison is the best sellers. Any model must
beat "show the most-booked packages" to be worth running. SVD++ did not.

### Older metrics

The older offline pipeline reported NDCG@K (how high the booked package
appears in the list) and catalog coverage (how much of the catalog is ever
recommended). Its stored results in
`Snaplytics/recommender/results/evaluation_results.csv` come from data before
the 2026-11-15 import and do not describe the live rule.

## Example

Suppose 100 test bookings produce these results:

```text
Booked package was the first card:      45
Booked package was the second or third: 30
Booked package was not in the cards:    25
```

The results would be:

- Hit Rate@3: `(45 + 30) / 100` = **75%**
- First card right: `45 / 100` = **45%**
- Random baseline with 25 packages: `3 / 25` = **12%**

This rule is far better than random. If the three best sellers alone also hit
75%, though, the model adds nothing, and the simpler rule should be kept.

## Commands

Run these commands from the `Snaplytics` folder:

```powershell
# Install the SVD++ package (needed to train or to use SVD++ cards)
.venv\Scripts\python.exe -m pip install scikit-surprise==1.1.5

# Retrain the SVD++ model from past bookings (runs the fair test first)
python manage.py train_package_recommender

# Run only the fair test, without saving a new model
python manage.py train_package_recommender --dry-run
```

Retraining is not scheduled. History and best-seller cards read the database
on every request, so they are always current. Only the SVD++ model needs
retraining, for example after an import.

`POST /api/recommendations/rebuild/` does not retrain the model. It rebuilds
popularity CSV files used by the older offline pipeline.
