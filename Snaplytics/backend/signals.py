from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import StaffProfile

User = get_user_model()


@receiver(post_save, sender=User)
def ensure_staff_profile(sender, instance, created, **kwargs):
    if created:
        StaffProfile.objects.get_or_create(user=instance)
        return
    StaffProfile.objects.get_or_create(user=instance)
