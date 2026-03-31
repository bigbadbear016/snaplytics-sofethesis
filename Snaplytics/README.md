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
python manage.py runserver
```

API default: `http://localhost:8000/api/...`
