from django.conf import settings
from django.core.mail import send_mail
from django.utils.crypto import get_random_string

from .models import StaffProfile


def issue_staff_temporary_password(
    user,
    *,
    can_send_email=False,
    reset_profile_completed=False,
):
    """
    Set a new random password for a staff account and optionally email it.
    """
    temporary_password = get_random_string(12)
    user.set_password(temporary_password)
    user.save(update_fields=["password"])

    profile, _ = StaffProfile.objects.get_or_create(user=user)
    profile.must_change_password = True
    if reset_profile_completed:
        profile.profile_completed = False

    update_fields = ["must_change_password"]
    if reset_profile_completed:
        update_fields.append("profile_completed")
    profile.save(update_fields=update_fields)

    email_sent = False
    if can_send_email and user.email and (user.is_staff or user.is_superuser):
        subject = "Your Snaplytics account credentials"
        display_name = user.first_name or user.username or "User"
        username_or_email = user.email or user.username
        message = (
            f"Hi {display_name},\n\n"
            "A temporary password has been generated for your Snaplytics account.\n\n"
            f"Login email/username: {username_or_email}\n"
            f"Temporary password: {temporary_password}\n\n"
            "Please log in and change this password immediately.\n\n"
            "If you did not request this, please contact your administrator."
        )
        send_mail(
            subject,
            message,
            getattr(settings, "DEFAULT_FROM_EMAIL", None),
            [user.email],
            fail_silently=True,
        )
        email_sent = True

    return {
        "temporary_password": temporary_password,
        "email_sent": email_sent,
    }
