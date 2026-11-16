from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0031_booking_loyalty_claim"),
    ]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="loyalty_points_spent",
            field=models.DecimalField(blank=True, decimal_places=1, max_digits=12, null=True),
        ),
    ]
