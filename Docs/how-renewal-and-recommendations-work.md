# How Snaplytics Predicts Return Visits and Recommends Packages

This document explains, in plain language, two features of Snaplytics:

1. **Return-visit prediction:** how likely each customer is to book another
   photo session within the next year.
2. **Package recommendations:** which packages the staff app and the kiosk
   suggest to a customer.

Both features learn from the studio's own booking history: **2,640
bookings from 2,178 customers**, from 25 February 2024 to 31 October 2026.

In the app and the code, a return visit is called a **renewal**. This
document uses "return" or "book again", because Heigen Studio has no
subscription to renew. Both words mean the same thing here.

---

## Words used in this document

| Word | Meaning here |
|---|---|
| Booking | One photo session a customer paid for. |
| Returning customer | A customer with at least one earlier booking. |
| Comes back | Books another session within 365 days. |
| Model | A set of rules the computer learns from past examples, used to make a guess about new cases. |
| Training | Letting the model learn its rules from past bookings. |
| Testing | Checking the model's guesses against what really happened, using bookings it did not learn from. |

---

## Part 1: Return-visit prediction

### The question it answers

For each customer, the system answers: **"How likely is this customer to book
again within the next 12 months?"** The answer is a percentage. The staff app
shows it on the customer list and on each customer's page. Staff can also use
it to decide who gets a "we miss you" coupon first.

### What the system looks at

The system describes every customer with seven facts, all taken from their
booking history:

| Fact | What it means | Example |
|---|---|---|
| Total bookings | How many sessions the customer has ever booked. | 3 |
| Bookings in the last year | How many of those were in the past 365 days. | 2 |
| Came back before | Whether the customer ever booked twice within a year. | Yes |
| Days since last visit | How long ago their most recent session was. | 60 days |
| Average spend | The average amount paid per session. | ₱700 |
| Occasion of last visit | What the package of the most recent session was for, such as Christmas or Graduation. Most packages are "General". | General |
| Booking strength | One summary score from 0 to 0.99 (explained below). | 0.70 |

**Booking strength** is a simple score that adds up the customer's good signs.
Each part has a limit, so one very active customer cannot get an extreme
score:

- Every customer starts at 0.05.
- Bookings in the last year add up to 0.40 (each booking adds 0.125).
- Total bookings add up to 0.25 (each booking adds 0.10).
- The average amount spent per booking adds up to 0.15 (₱1,500 adds 0.10).
- Having come back before adds 0.15.

The score gives the model a steady summary even when a customer has very
little history.

The **occasion** comes from a tag on each package and category, such as
Graduation, Christmas or Birthday. When a package is added, the system
suggests the tag itself (first from words in the name, then with the same
language model the AI assistant uses), and staff can set it by hand. So far,
92.5% of bookings used "General" packages, so the occasion only matters for
customers whose last session was a Christmas or Valentine's package. Christmas
customers came back a little more often: 17.8% of Christmas bookings were
followed by another visit within a year, against 14.2% for General packages.

### Two common-sense rules the model must follow

The model is not allowed to learn anything that goes against common sense:

1. More bookings, more recent bookings, a higher booking strength, or having
   come back before can only **raise** the chance, never lower it.
2. More days since the last visit can only **lower** the chance, never raise
   it.

These rules stop the model from learning odd patterns from a small amount of
data. Average spend and occasion have no fixed direction: the model learns
from the data whether they raise or lower the chance.

The rules bind the XGBoost part of the model (explained below). The starting
formula is not bound by them, so the whole model was checked on 3,200
made-up customers: an extra booking never lowered the chance, and a longer
time since the last visit never raised it.

### How the model learns

The model learns from **snapshots**. A snapshot is a picture of one customer
on one date: their facts on that day, and whether they really booked
again within the next 365 days.

The system takes a snapshot of every customer at the end of every month, from
February 2024 to October 2025. It stops at October 2025 because, for later
months, a full year has not yet passed, so we do not know yet whether those
customers came back.

This gives **19,401 snapshots**. In **2,280** of them (about 1 in 8), the
customer came back within a year.

The model works in two steps:

1. **A starting guess (logistic regression).** A simple formula gives each
   fact a weight, adds them up, and turns the total into a first chance. It
   stays steady even with little data.
2. **Corrections (XGBoost).** XGBoost then builds small yes/no rules, such as
   "Has this customer booked in the last 90 days?", that adjust the starting
   guess where the formula is wrong. Snaplytics uses **50 small rules**, each
   asking **at most 2 questions**, and each rule must be backed by many
   snapshots. Keeping the rules few, small and cautious stops the model from
   memorising individual customers instead of learning general patterns.

The final chance comes from XGBoost. Starting from the formula's guess made
the model useful even in the earliest test months, when XGBoost on its own
had too little data to tell customers apart.

### How the model was tested fairly

A model can look very good if it is tested on the same customers it learned
from. To avoid that, the test follows the order of time:

1. Pick a test month, for example October 2025.
2. Let the model learn only from snapshots whose one-year result was already
   known by that month.
3. Ask it to predict every customer in the test month.
4. Compare its guesses with what those customers really did.

This was repeated for **7 test months**, from April to October 2025. The
model never sees the answers it is tested on. The same test was run for three
other methods (XGBoost on its own, the starting formula on its own, and a
random forest), so all four can be compared fairly.

### The algorithms, step by step

The return-visit feature uses four algorithms. Each one is written as plain
steps: what goes in (input), what comes out (output), and what happens in
between.

**Algorithm 1: Describe a customer on a given date**

*Input:* a customer's bookings, and a date.
*Output:* the customer's facts on that date.

1. Keep only the customer's accepted bookings on or before the date. If two
   bookings are exactly the same in every detail, count them once.
2. If no bookings are left, stop: the customer has no history yet.
3. **Total bookings** = the number of bookings left.
4. **Bookings in the last year** = how many of them fall in the 365 days
   before the date.
5. **Came back before** = "yes" if any two visits, on different days, were
   at most 366 days apart; otherwise "no".
6. **Days since last visit** = the number of days from the latest booking to
   the date.
7. **Average spend** = total amount paid divided by the number of bookings.
8. **Booking strength**:
   1. Start at 0.05.
   2. Add bookings in the last year ÷ 8, but at most 0.40.
   3. Add total bookings ÷ 10, but at most 0.25.
   4. Add average spend ÷ 15,000, but at most 0.15.
   5. If the customer came back before, add 0.15.
   6. If the total is above 0.99, use 0.99.
9. **Occasion of last visit** = the occasion tag of the package of the latest
   booking ("General" if it has no specific occasion).

**Algorithm 2: Train the model**

*Input:* every accepted booking in the database.
*Output:* the trained model and the cut-off point for the two groups.

1. List every month-end from the first booking up to one year before the last
   booking. (Later months are left out because their one-year result is not
   known yet.)
2. For every month-end, and for every customer who had booked by then:
   1. Describe the customer on that date with Algorithm 1.
   2. Write down whether the customer booked again within the next 365 days
      (yes or no).
   3. Save the facts and the yes/no answer as one snapshot.
3. Run the fair test (Algorithm 3) and print its results.
4. Fit the starting formula (logistic regression) on all snapshots and work
   out each snapshot's starting guess.
5. Build 50 small yes/no rules that correct the starting guesses. Each rule
   asks at most 2 questions about the facts, each new rule mainly corrects the
   mistakes of the rules before it, and every rule must obey the common-sense
   rules above.
6. Describe every current customer with Algorithm 1 (using today's date) and
   score them with the new model.
7. Sort these scores from high to low. The score at the 15% mark becomes the
   cut-off point for the two groups.
8. Save both parts of the model and the cut-off point. The app starts using
   them at once.

**Algorithm 3: Test the model fairly**

*Input:* all snapshots from Algorithm 2.
*Output:* the test scores.

1. For every month-end (the test month):
   1. Take only the snapshots whose one-year answer was already known by the
      test month. These are the learning snapshots.
   2. If there are fewer than 100 learning snapshots, or fewer than 20
      customers who came back, skip this month: there is too little to learn
      from.
   3. Build a model from the learning snapshots only, as in Algorithm 2,
      steps 4 and 5. Do the same for the three comparison methods.
   4. Score every customer in the test month.
   5. Compare the scores with what those customers really did, and record
      the ranking score, the top-10% result and the accuracy.
2. Report the average of every result over all test months.

**Algorithm 4: Show a customer's chance and group in the app**

*Input:* one customer.
*Output:* a percentage and a group.

1. If the customer has no bookings, show 0% and the group "unlikely".
2. Otherwise describe the customer with Algorithm 1, using today's date.
3. Feed the facts to the starting formula to get the starting guess. Every
   one of the 50 rules then adds its small correction, and the total becomes
   the chance, from 0% to 100%.
4. Compare the chance with the cut-off point from Algorithm 2 and pick the
   group:
   - at least the 15% cut-off: **likely**;
   - otherwise: **unlikely**.
5. If the model cannot be loaded, show "Renewal prediction unavailable"
   instead of guessing.

### Results, in plain words

| What we measured | Result | What it means |
|---|---|---|
| Ranking score (ROC-AUC) | **0.607** | If you pick one customer who came back and one who did not, the model ranks the returning customer higher about 61% of the time. A coin flip would be 50%. |
| Top 10% of the list | **22.7% came back** | Of the 10% of customers the model rated highest, about 1 in 4 came back. Across all customers, only 10.7% (about 1 in 9) came back. The top of the list returns about **2.1 times** more often than average. |
| Overall accuracy | **85.5%** | How often a plain yes/no guess was right. |
| "Always say no" | **89.3%** | Simply guessing that nobody comes back would be right 89.3% of the time, because most customers do not come back. |

Why is the accuracy lower than "always say no"? Because "always say no"
never finds a single returning customer. It is right often but useless for
follow-ups. The model is built to **rank** customers so staff can contact the
most promising ones first, and on that task it beats chance.

The same test compared four methods:

| Method | Ranking score | Top 10% came back |
|---|---|---|
| Starting formula + XGBoost (used in the app) | **0.607** | **22.7%** |
| Starting formula (logistic regression) alone | 0.593 | 21.9% |
| XGBoost alone | 0.581 | 17.2% |
| Random forest | 0.570 | 16.1% |

The combination works best. Its biggest advantage is with little data: on the
first test month, with only 323 snapshots to learn from, XGBoost on its own
could not tell customers apart (score 0.500), while the combination already
reached 0.613. On the last test month, with 3,874 snapshots, both reached
about **0.63**, and 25.6% of the combination's top 10% came back.

### The two groups shown in the app

The app sorts customers into two groups by their rank, not by a fixed
percentage:

| Group | Who is in it | Label in the app |
|---|---|---|
| Likely | Top 15% of customers | Likely to renew |
| Unlikely | The remaining 85% | At risk of not renewing |

With the current model, a customer is "likely" from about **13.3%** upwards.
In the customer list, the renewal bar is green for "likely" customers.

### Two worked examples

These two made-up customers were scored by the real model on 20 November
2026. Both booked General packages.

**Customer A** booked twice in the past year, the last time 60 days ago. The
two sessions were within a year of each other, and they spent ₱700 on average.

- Booking strength: 0.05 + 0.25 + 0.20 + 0.05 + 0.15 = **0.70**
- The model's chance: **about 24%**
- Group: **Likely**

**Customer B** booked once, 300 days ago, and spent ₱299.

- Booking strength: 0.05 + 0.125 + 0.10 + 0.02 = **0.29**
- The model's chance: **about 8%**
- Group: **Unlikely** (a good candidate for a win-back coupon)

If Customer B's session had been a Christmas package, the chance would be
**about 16%**, enough for the **Likely** group, because Christmas customers
came back more often.

### Limits

- **Most customers have booked only once.** 1,828 of the 2,178 customers
  (84%) have a single booking, so the model has little history to learn from.
- **Occasions are new.** Almost all past bookings used General packages, so
  the occasion only matters for the few Christmas and Valentine's customers
  until more occasion-tagged bookings build up.
- **The one-year pattern cannot be tested yet.** 30.1% of return visits happen
  10 to 14 months after the previous one, but the data is not long enough yet
  to test whether the model should score customers higher near their one-year
  mark.
- **Use it as a ranked list, not a final answer.** It is good for deciding
  who to contact first. It should not be used to decide automatically what
  any one customer is offered.
- **It is retrained by hand.** A new month of bookings only improves the
  model after someone runs the training again. Each customer's facts, however,
  update live, so their percentage stays current between retrains.

---

## Part 2: Package recommendations

### The question it answers

When a customer is at the kiosk, or when staff open a customer's page, the
system shows **three package cards**. Each card has a package, up to two
suggested add-ons, the total price, and a short reason.

### How the three cards are chosen

The system fills the three cards in this order, and stops once all three are
filled:

1. **The customer's own favourites.** Packages the customer booked before,
   most-booked first. Label: **"Booking Loyalty"**.
2. **"Customers like you also booked".** Packages the customer has not booked
   yet, picked by a model called **SVD++** (explained below). Label:
   **"Similar Customers"**. Only returning customers get these.
3. **Best sellers.** The packages booked most often by all customers. Label:
   **"Popular Choice"**. New customers, and customers who first booked after
   the model was last trained, get these.

A first-time customer therefore sees the three best sellers, which today are
**Delight, Allure and Ecstasy**.

### How SVD++ finds "customers like you"

SVD++ looks at who booked which packages and add-ons. From that it finds
hidden **taste patterns**. A made-up example of such a pattern: "customers
who choose group packages also tend to add extra backdrops". Nobody tells the
model these patterns; it finds them in the data by itself.

Each customer and each package gets a position on these patterns. When a
customer's position is close to a package's position, the package is a good
match. The match is shown as a score from 0 to 1.

The model learns from two kinds of examples:

- **Things the customer booked** (a package or an add-on), marked as a match.
- **Two packages the customer never booked**, picked at random and marked as
  not a match. This teaches the model what a customer is *not* interested in.

It uses 50 taste patterns and goes over the data 20 times while learning.

### How the add-ons are chosen

For each card, the system suggests up to two add-ons:

- On a "Booking Loyalty" card: the add-ons this customer most often bought
  with that package.
- On other cards, or if the customer never bought add-ons with it: the
  add-ons most often bought with that package by all customers.

### The algorithms, step by step

The recommendation feature uses three algorithms.

**Algorithm 5: Train the SVD++ model**

*Input:* every accepted booking in the database.
*Output:* the trained SVD++ model.

1. For every booking, write down "this customer chose this package" and
   "this customer chose this add-on" for each add-on in it. Each pair is a
   match, with the value 1. A pair is written only once, however often it
   was booked.
2. For every customer, pick 2 packages they never booked, at random, and
   write them down as "not a match", with the value 0.
3. Give every customer and every item (package or add-on) a starting
   position on 50 taste patterns.
4. Go through all the pairs 20 times. Each time, move the positions a little
   so that matches come out close to 1 and non-matches close to 0.
5. Save the model. The app starts using it at once.

**Algorithm 6: Choose the three cards for a customer**

*Input:* one customer, and the number of cards (3).
*Output:* three package cards, each with up to two add-ons and a reason.

1. **Own favourites.**
   1. Count the customer's accepted bookings per package.
   2. Sort the packages from most to least booked.
   3. Put up to 3 of them on cards, labelled "Booking Loyalty". The card's
      score is the share of the customer's bookings with that package.
   4. For each of these cards, pick the 2 add-ons the customer bought most
      often with that package.
2. **Customers like you.** If cards are still empty:
   1. If the SVD++ model has never seen this customer, skip to step 3.
   2. Ask the model for a match score for every package that is on sale and
      not already on a card.
   3. Fill the empty cards with the highest-scoring packages, labelled
      "Similar Customers".
3. **Best sellers.** If cards are still empty:
   1. Count all accepted bookings per package, for packages that are on sale.
   2. Go through the packages from most to least booked, skip any already on
      a card, and fill the empty cards. Label: "Popular Choice".
4. For every card without add-ons yet, pick the 2 add-ons bought most often
   with that package by all customers.
5. Add the price (package plus add-ons) and a short reason to each card.

**Algorithm 7: Test the recommendations fairly**

*Input:* every accepted booking.
*Output:* how often the booked package was on a card.

1. Pick 6 test dates, one every two months, from 16 months to 6 months
   before the last booking.
2. For every test date:
   1. Take the bookings before the date as the learning bookings.
   2. Train an SVD++ model from them only (Algorithm 5).
   3. Take every later booking made by a customer who already had a
      learning booking.
   4. For each of these bookings, choose three cards with Algorithm 6, using
      only the learning bookings, and check whether the package really
      booked is one of them.
3. Report the share of bookings where it was, averaged over all test dates.
   For comparison, repeat the test with SVD++ alone, and with best sellers
   in place of SVD++.

### A worked example

A customer booked the **Delight** package once.

| Card | Package | Why |
|---|---|---|
| 1 | Delight | Booking Loyalty: the customer booked it before. |
| 2 | Allure | Similar Customers: match score 0.73. |
| 3 | Ecstasy | Similar Customers: match score 0.39. |

### How the recommendations were tested

The test again follows the order of time. For each of 6 test dates (from
June 2025 to April 2026), the model learned only from bookings before that
date. Then, for every later booking by a customer the model already knew, we
checked: **was the package they actually booked among the three cards?**

| Way of filling the cards | Booked package was on a card |
|---|---|
| Own favourites, then SVD++ (what the app does) | **79.1%** |
| SVD++ only | 77.6% |
| Own favourites, then best sellers | 80.3% |

The first card alone was right **50.3%** of the time, about half.

### What these results mean

The cards show the right package about **4 times out of 5**. However, SVD++
does not do better than simply showing best sellers after the customer's
favourites. The difference is small (about 1 in 100 bookings), but it is not
an improvement. There are two reasons:

1. **Most customers have booked only once,** so there is very little personal
   taste to learn from.
2. **Three packages make up most bookings.** Delight (45%), Allure (25%) and
   Ecstasy (8%) together account for **77%** of all bookings, so best sellers
   are already a very strong guess.

SVD++ is kept because it can suggest packages the customer has not tried yet,
and it should become more useful as more customers return and build up
history.

---

## Summary

| | Return-visit prediction | Package recommendations |
|---|---|---|
| Question | Will this customer book again within a year? | Which three packages should we show this customer? |
| Uses | Total bookings, recent bookings, came back before, days since last visit, average spend, occasion of last visit, booking strength | Packages and add-ons each customer booked |
| Method | A starting formula (logistic regression), then XGBoost: 50 small yes/no rules that correct it, with common-sense rules | Own favourites, then SVD++ "customers like you", then best sellers |
| Fair test | 7 months, learning only from the past | 6 dates, learning only from the past |
| Result | Ranking score 0.607 (coin flip 0.5); top 10% come back about 2.1× more often | Booked package on a card 79.1% of the time |
| Main limit | 84% of customers have one booking | Best sellers are already a strong guess |
| Best use | Ordering a follow-up or coupon list | Helping customers and staff choose quickly |

---

## Keeping both models up to date

Neither model retrains by itself. After new bookings are added, for example
once a month or after an import, staff with access to the server run these
two commands from the `Snaplytics` folder:

```powershell
python manage.py train_renewal_xgboost
python manage.py train_package_recommender
```

Each command first runs its fair test and prints the results, then saves the
new model. The app starts using the new model automatically.

New packages and categories get their occasion tag automatically. To tag
older ones, run `python manage.py tag_occasions`.

For the full technical details, see [renewal-model.md](renewal-model.md) and
[recommendations-and-suggestions.md](../Snaplytics/docs/recommendations-and-suggestions.md).
