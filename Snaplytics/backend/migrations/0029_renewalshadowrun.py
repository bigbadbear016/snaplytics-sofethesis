from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [("backend", "0028_renewaltrainingsettings")]

    operations = [
        migrations.CreateModel(
            name="RenewalShadowRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("run_date", models.DateTimeField(default=django.utils.timezone.now)),
                ("run_type", models.CharField(default="DAILY", max_length=16)),
                ("model_version", models.CharField(max_length=128)),
                ("status", models.CharField(choices=[("SUCCESS", "Success"), ("FAILED", "Failed")], max_length=16)),
                ("created_count", models.IntegerField(default=0)),
                ("updated_count", models.IntegerField(default=0)),
                ("details", models.JSONField(default=dict)),
                ("error_message", models.TextField(blank=True, default="")),
            ],
        ),
    ]
