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
- Data/ML libraries (`pandas`, `numpy`, `scikit-learn`, `xgboost`, `pyspark`)
- DB driver (`psycopg2-binary`)

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
