# Generated manually for soft-delete recycle bin (separate from is_archived).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0018_package_category_archives"),
    ]

    operations = [
        migrations.AddField(
            model_name="category",
            name="deleted_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="package",
            name="deleted_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="addon",
            name="deleted_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="coupon",
            name="deleted_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]
