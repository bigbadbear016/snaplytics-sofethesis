#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Snaplytics.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    # Plain `manage.py runserver` listens on all interfaces so phones (Expo Go)
    # on the same Wi-Fi can reach the API. An explicit address still wins, e.g.
    # `manage.py runserver 127.0.0.1:8000`. Override with DJANGO_RUNSERVER_ADDR.
    if len(sys.argv) >= 2 and sys.argv[1] == "runserver":
        if not any(not arg.startswith("-") for arg in sys.argv[2:]):
            sys.argv.append(os.environ.get("DJANGO_RUNSERVER_ADDR", "0.0.0.0:8000"))
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
