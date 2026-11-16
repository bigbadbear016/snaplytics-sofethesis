from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0030_remove_renewal_shadow"),
    ]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="loyalty_claim",
            field=models.BooleanField(default=False),
        ),
    ]
