from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0019_recycle_bin_deleted_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="staffprofile",
            name="dev_mode",
            field=models.BooleanField(
                default=False,
                help_text="When True, user may permanently purge soft-deleted catalog rows (non-owner only).",
            ),
        ),
    ]
