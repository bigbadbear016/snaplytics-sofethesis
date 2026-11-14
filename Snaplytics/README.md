# Snaplytics Backend Requirements

## Runtime Requirements

- Python 3.12 (3.11 also works; 3.13+ is not supported because `numpy==1.26.4` has no wheels for it)
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
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

API default: `http://localhost:8000/api/...`

`runserver` with no address listens on `0.0.0.0:8000` so phones on the same
Wi-Fi can reach it. Set `DJANGO_RUNSERVER_ADDR` to change the default.

On Windows, `install.bat` in the repository root does all of this for you.

## Code layout

| Path | Contents |
| --- | --- |
| `Snaplytics/` | Settings (`settings.py`, `settings_test.py`) and root URLs |
| `backend/` | Models, signals, admin, helpers (coupons, loyalty, booking email, renewal), management commands |
| `endpoints/urls.py` | All `/api/...` routes |
| `endpoints/views/` | Views, one module per area: `customers`, `bookings`, `catalog`, `coupons`, `recommendations`, `dashboard`, `renewal`, `accounts`, `records`; shared helpers in `_common.py` and `recycle.py` |
| `endpoints/permissions.py` | `StaffOrKioskAction`: which actions work without a login |
| `endpoints/serializers.py` | Request/response serializers |
| `recommender/`, `renewal/` | Recommendation and renewal model pipelines |
| `etl/` | Booking data import jobs |
| `scripts/` | Task Scheduler scripts for renewal shadow runs |
| `docs/` | Architecture, setup, feature, and generated code reference docs |

## API access

Signed-in staff (STAFF, ADMIN, OWNER) can call every endpoint; views add
their own role checks, for example ADMIN/OWNER-only restore. Without a login,
only the kiosk's actions work: reading the catalog, finding or creating a
customer, creating a `Pending` booking, recommendations, loyalty settings,
customer coupons, coupon validation, and the booking confirmation email.
Each viewset lists its anonymous actions in `kiosk_actions`.

## Tests

Run from this folder:

```bash
python manage.py test endpoints --settings=Snaplytics.settings_test
```

The test settings use an in-memory SQLite database, so tests need no Supabase
connection and send no real email.

## Management commands

| Command | Purpose |
| --- | --- |
| `create_dev_account` | Create or update an ADMIN account with `dev_mode` (see below) |
| `run_etl` | Import booking files into staging; `--merge` writes customers and bookings |
| `send_coupon_emails` | Send pending coupon emails over SMTP (`--dry-run` to preview) |
| `suggest_coupons_for_at_risk` | Send the `COUPON_AT_RISK_ID` coupon to low-renewal customers |
| `remigrate_coupons` | Unapply and re-run the coupon migrations (after deleting coupon tables) |
| `run_renewal_shadow` | Record today's renewal shadow predictions |
| `evaluate_renewal_shadow` | Resolve shadow predictions whose 365-day window has closed |
| `report_renewal_shadow_metrics` | Print precision, recall, accuracy, and baseline for mature predictions |
| `request_renewal_training` | Monthly job: create a training request or start training |
| `train_renewal_challenger` | Train a challenger renewal model |

Coupon cron setup (Supabase `pg_cron` or Task Scheduler) is described in
[docs/windows_vscode_setup_documentation.md](docs/windows_vscode_setup_documentation.md).

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

## Documentation

- [docs/overall_architecture_documentation.md](docs/overall_architecture_documentation.md): components, data model, API surface, and access rules
- [docs/windows_vscode_setup_documentation.md](docs/windows_vscode_setup_documentation.md): Windows + VS Code setup and coupon cron jobs
- [docs/recommendations-and-suggestions.md](docs/recommendations-and-suggestions.md): recommendation and add-on suggestion logic
- [../Docs/renewal-shadow-mode.md](../Docs/renewal-shadow-mode.md): renewal predictions, shadow mode, and training
- Generated code reference: `file_by_file_documentation.md`,
  `method_line_by_line_documentation*.md`, and
  `function_groups_documentation.md`. Regenerate them after code changes
  (needs Node.js and `npm install` in `HeigenKiosk`; pandoc is optional and
  only needed for the `.docx` copies):

  ```bash
  cd docs
  python generate_method_docs.py
  python generate_file_by_file_docs.py
  python generate_function_groups_docs.py
  ```

## Recommendation and suggestion behavior

For the package recommendation flow, personalized booking-history ranking,
popular new-customer suggestions, add-on selection, API response fields, and
refresh behavior, see
[docs/recommendations-and-suggestions.md](docs/recommendations-and-suggestions.md).

## Renewal prediction

Renewal predictions come from one XGBoost model in `backend/ml/`. Train or
retrain it from every accepted booking in the live database (Supabase):

```bash
python manage.py train_renewal_xgboost            # test, train, and save
python manage.py train_renewal_xgboost --dry-run  # test only
```

The app reloads the model when the files change. If the model cannot be
loaded, the app shows the renewal prediction as unavailable.

## Booking data cleanup

`clean_booking_data` finds data problems that distort renewal predictions:
identical duplicate bookings, customer records with the same name and the
same phone or email, and leftover `nan` / `pending` text.

```bash
python manage.py clean_booking_data                  # dry run: report only
python manage.py clean_booking_data --apply          # back up, then fix
python manage.py clean_booking_data --restore FILE   # undo an --apply run
```

`--apply` writes a backup to `Snaplytics/backups/` before changing anything.
The backup contains customer personal data and is git-ignored; keep it
private. Duplicate bookings are deleted only when they have no add-ons or
coupon, and loyalty points credited for them are subtracted. Merged customer
records move to Internal Records. Problems that need a person to decide, such
as prices that differ from the package price, are reported but not changed.
Retrain the renewal model afterwards with `train_renewal_xgboost`.

## Renewal shadow mode

Shadow mode records the live model's predictions without changing what
customers see or triggering outreach. Run the shadow capture daily:

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
Do not replace the live model with a challenger until a future, mature cohort
demonstrates useful lift and the challenger has passed a separate time-based
validation.

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
live model automatically.

ADMIN and OWNER can use the same notification panel to turn automatic monthly
training on or off. The switch is off by default. When it is on, the monthly
job starts challenger training automatically, but still does not replace the
live model. Automatic runs also create a notice for staff and admins.
Automatic notices stay visible for 30 days. Manual requests show an approval
button only to ADMIN and OWNER.

Shadow monitoring is always on. Daily successful runs are recorded quietly.
If a daily run fails, staff and admins see an alert in the notification panel.
The monthly job also creates a shadow review summary; ADMIN and OWNER can see
its run details.
