from django.db import migrations


def seed_categories_from_packages(apps, schema_editor):
    Category = apps.get_model("backend", "Category")
    Package = apps.get_model("backend", "Package")

    category_names = (
        Package.objects.exclude(category__isnull=True)
        .exclude(category__exact="")
        .values_list("category", flat=True)
        .distinct()
    )
    for name in category_names:
        normalized = (name or "").strip()
        if not normalized:
            continue
        Category.objects.get_or_create(name=normalized)


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0009_category"),
    ]

    operations = [
        migrations.RunPython(seed_categories_from_packages, migrations.RunPython.noop),
    ]

