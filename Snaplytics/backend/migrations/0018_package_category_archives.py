from django.db import migrations, models


def _ensure_archive_fields(apps, schema_editor):
    connection = schema_editor.connection
    introspection = connection.introspection
    existing_tables = set(introspection.table_names())

    def ensure_field(model_name):
        model = apps.get_model("backend", model_name)
        table = model._meta.db_table
        if table not in existing_tables:
            return
        with connection.cursor() as cursor:
            columns = {
                col.name
                for col in introspection.get_table_description(cursor, table)
            }
        if "is_archived" in columns:
            return
        field = models.BooleanField(default=False, db_index=True)
        field.set_attributes_from_name("is_archived")
        schema_editor.add_field(model, field)

    ensure_field("Category")
    ensure_field("Package")


def _noop_reverse(apps, schema_editor):
    return


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0017_emailtemplate_html_body"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    _ensure_archive_fields,
                    reverse_code=_noop_reverse,
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="category",
                    name="is_archived",
                    field=models.BooleanField(db_index=True, default=False),
                ),
                migrations.AddField(
                    model_name="package",
                    name="is_archived",
                    field=models.BooleanField(db_index=True, default=False),
                ),
            ],
        ),
    ]
