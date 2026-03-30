from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0013_add_coupon_max_discount_amount"),
    ]

    operations = [
        migrations.AddField(
            model_name="couponsent",
            name="sender_label",
            field=models.CharField(blank=True, max_length=128, null=True),
        ),
    ]
