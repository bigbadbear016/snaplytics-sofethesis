"""Launch the Django API as a packaged desktop-app backend."""

import os
import sys


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Snaplytics.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(
        [
            "manage.py",
            "runserver",
            "127.0.0.1:8000",
            "--noreload",
        ]
    )


if __name__ == "__main__":
    main()
