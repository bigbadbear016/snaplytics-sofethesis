# Snaplytics Backend Requirements

## Runtime Requirements

- Python 3.11+ (3.12 recommended)
- pip (latest recommended)
- Virtual environment support (`venv`)
- PostgreSQL (if configured for production/local usage)

## Python Dependencies

Install from:

```bash
pip install -r requirements.txt
```

Core stack includes:

- Django + Django REST Framework
- `django-cors-headers`
- Data/ML libraries (`pandas`, `numpy`, `scikit-learn`, `xgboost`)
- DB driver (`psycopg2-binary`)

The default install does not include the optional `scikit-surprise` model
trainer or PySpark. Live recommendations use booking history and popularity
data, so they do not need native C++ build tools. To enable offline
recommender-model training and evaluation, install
`requirements-ml.txt` separately.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

API default: `http://localhost:8000/api/...`

Create a new `OWNER` account from the repository root with:

```bash
cd Snaplytics
python manage.py createsuperuser
```

## Dev Account (CLI only)

To create or update a dev-enabled admin account:

```bash
cd Snaplytics
python manage.py create_dev_account --username zxcdev --password zxcdev
```

Behavior:
- Creates/updates an `ADMIN` user (not `OWNER`)
- Sets `StaffProfile.dev_mode=True`
- Used for elevated Internal Records actions (for example permanent delete)
- `dev_mode` is not editable from Manage accounts UI/API

## Recommendation and suggestion behavior

For the package recommendation flow, personalized booking-history ranking,
popular new-customer suggestions, add-on selection, API response fields, and
refresh behavior, see
[docs/recommendations-and-suggestions.md](docs/recommendations-and-suggestions.md).

## Renewal shadow mode

Renewal predictions are initially recorded without changing the customer-facing
heuristic or triggering outreach. Run the shadow capture daily:

```bash
python manage.py migrate
python manage.py run_renewal_shadow
```

After a prediction's 365-day outcome window has closed, resolve it against
live bookings and report the mature metrics:

```bash
python manage.py evaluate_renewal_shadow
python manage.py report_renewal_shadow_metrics
```

The capture command is safe to rerun on the same day. Predictions are keyed by
customer, snapshot date, and model version. Use the resulting mature precision,
recall, accuracy, and majority-class baseline for quarterly promotion reviews.
Do not replace the live heuristic until a future, mature cohort demonstrates
useful lift and the model has passed a separate time-based validation.

### Automatic localhost run

The application does not start a background timer. For a localhost setup,
create a daily Windows Task Scheduler task that runs:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\run_renewal_shadow.ps1
```

Set the task's working directory to the `Snaplytics` folder. This is safer
than starting a timer inside Django because Django may run more than one
worker. The task must have access to the `.env` file and the Supabase database.

### Monthly challenger training

Create a second Windows Task Scheduler task that runs
`scripts\run_renewal_monthly.ps1` once per month. It checks mature outcomes,
then follows the automatic-training switch. With the switch off, it creates
a training request. Staff and admins see the request, but only ADMIN or OWNER
can approve and start training. With the switch on, it starts challenger
training automatically and still creates a notice. Neither path replaces the
live heuristic automatically.

ADMIN and OWNER can use the same notification panel to turn automatic monthly
training on or off. The switch is off by default. When it is on, the monthly
job starts challenger training automatically, but still does not replace the
live heuristic. Automatic runs also create a notice for staff and admins.
Automatic notices stay visible for 30 days. Manual requests show an approval
button only to ADMIN and OWNER.

Shadow monitoring is always on. Daily successful runs are recorded quietly.
If a daily run fails, staff and admins see an alert in the notification panel.
The monthly job also creates a shadow review summary; ADMIN and OWNER can see
its run details.
