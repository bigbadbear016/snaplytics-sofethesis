from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0026_renewalshadowprediction"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RenewalTrainingRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source_model_version", models.CharField(max_length=128)),
                ("requested_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("status", models.CharField(choices=[("PENDING", "Pending"), ("APPROVED", "Approved"), ("REJECTED", "Rejected")], default="PENDING", max_length=16)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("candidate_model_path", models.TextField(blank=True, null=True)),
                ("metrics", models.JSONField(default=dict)),
                ("notes", models.TextField(blank=True, default="")),
                ("reviewed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="renewal_training_reviews", to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
