from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0016_actionlog"),
    ]

    operations = [
        migrations.AddField(
            model_name="emailtemplate",
            name="html_body",
            field=models.TextField(blank=True, default=""),
        ),
    ]
