from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0025_customer_booking_indexes"),
    ]

    operations = [
        migrations.CreateModel(
            name="RenewalShadowPrediction",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("snapshot_date", models.DateField()),
                ("model_version", models.CharField(max_length=128)),
                ("probability", models.FloatField()),
                ("predicted_renewal", models.BooleanField()),
                ("feature_snapshot", models.JSONField(default=dict)),
                ("outcome_due_date", models.DateField()),
                ("actual_renewal", models.BooleanField(blank=True, null=True)),
                ("evaluated_at", models.DateTimeField(blank=True, null=True)),
                (
                    "created_at",
                    models.DateTimeField(default=django.utils.timezone.now),
                ),
                (
                    "customer",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="backend.customer",
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(
                        fields=["model_version", "snapshot_date"],
                        name="renewal_shadow_model_date_idx",
                    ),
                    models.Index(
                        fields=["outcome_due_date", "actual_renewal"],
                        name="renewal_shadow_outcome_idx",
                    ),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("customer", "snapshot_date", "model_version"),
                        name="renewal_shadow_unique_snapshot",
                    )
                ],
            },
        )
    ]
