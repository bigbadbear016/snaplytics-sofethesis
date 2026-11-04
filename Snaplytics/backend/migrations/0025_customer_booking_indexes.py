from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0024_alter_staffprofile_dev_mode"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="customer",
            index=models.Index(
                fields=["deleted_at", "created_at"],
                name="cust_del_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="customer",
            index=models.Index(
                fields=["last_updated"],
                name="cust_updated_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="booking",
            index=models.Index(
                fields=["customer", "session_status"],
                name="book_cust_status_idx",
            ),
        ),
    ]
