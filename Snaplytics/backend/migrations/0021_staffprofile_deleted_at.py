from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0020_staffprofile_dev_mode"),
    ]

    operations = [
        migrations.AddField(
            model_name="staffprofile",
            name="deleted_at",
            field=models.DateTimeField(
                blank=True,
                db_index=True,
                help_text="Soft-delete marker for managed staff/admin/owner accounts.",
                null=True,
            ),
        ),
    ]
