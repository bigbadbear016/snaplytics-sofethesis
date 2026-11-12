from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [("backend", "0027_renewaltrainingrequest")]

    operations = [
        migrations.CreateModel(
            name="RenewalTrainingSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("automatic_training_enabled", models.BooleanField(default=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
    ]
