# Customer soft-delete for Internal Records (recycle bin).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0022_loyalty_points"),
    ]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="deleted_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="customer",
            name="email_recycled",
            field=models.EmailField(blank=True, max_length=254, null=True),
        ),
    ]
