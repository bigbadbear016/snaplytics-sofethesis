from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from backend.models import StaffProfile


class Command(BaseCommand):
    help = (
        "Create or update an ADMIN account with StaffProfile.dev_mode=True. "
        "Dev mode is only settable here (not via Manage accounts or staff APIs)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--password", required=True)
        parser.add_argument(
            "--email",
            default="",
            help="Defaults to {username}@dev.local",
        )

    def handle(self, *args, **options):
        User = get_user_model()
        username = (options["username"] or "").strip()
        password = options["password"] or ""
        email = (options["email"] or "").strip() or f"{username}@dev.local"

        if not username or not password:
            raise CommandError("username and password are required.")

        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "email": email,
                "first_name": "Dev",
                "last_name": "User",
                "is_staff": True,
                "is_superuser": False,
                "is_active": True,
            },
        )
        if not created:
            user.email = email or user.email
            user.is_staff = True
            user.is_superuser = False
            user.is_active = True
            user.save(update_fields=["email", "is_staff", "is_superuser", "is_active"])

        user.set_password(password)
        user.save(update_fields=["password"])

        profile, _ = StaffProfile.objects.get_or_create(user=user)
        profile.deleted_at = None
        profile.dev_mode = True
        profile.must_change_password = False
        profile.profile_completed = True
        profile.save(
            update_fields=[
                "deleted_at",
                "dev_mode",
                "must_change_password",
                "profile_completed",
            ]
        )

        action = "Created" if created else "Updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"{action} dev account: username={username!r} role=ADMIN dev_mode=True"
            )
        )
