"""Settings for the test suite.

Same as settings.py, but uses an in-memory SQLite database and never sends
real email, so tests do not need Supabase/PostgreSQL or SMTP.

Run from the Snaplytics folder:
    python manage.py test --settings=Snaplytics.settings_test
"""

from .settings import *  # noqa: F401,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}


class _DisableMigrations(dict):
    """Build test tables straight from the models.

    Some migrations run PostgreSQL-only SQL (information_schema), which
    SQLite cannot execute.
    """

    def __contains__(self, item):
        return True

    def __getitem__(self, item):
        return None


MIGRATION_MODULES = _DisableMigrations()

EMAIL_BACKEND ="django.core.mail.backends.locmem.EmailBackend"

# Fast hashing: tests create users but never need strong password hashes.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
