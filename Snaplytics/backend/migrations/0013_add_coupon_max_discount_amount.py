# Add all missing columns to backend_coupon (fixes schema drift)

from django.db import migrations


# Columns that may be missing due to schema drift. (column_name, sql_add)
COUPON_COLUMNS = [
    ("max_discount_amount", "ALTER TABLE backend_coupon ADD COLUMN max_discount_amount DOUBLE PRECISION NULL"),
    ("per_customer_limit", "ALTER TABLE backend_coupon ADD COLUMN per_customer_limit INTEGER NOT NULL DEFAULT 1"),
    ("expires_at", "ALTER TABLE backend_coupon ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE NULL"),
    ("created_at", "ALTER TABLE backend_coupon ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()"),
    ("last_updated", "ALTER TABLE backend_coupon ADD COLUMN last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()"),
]


def add_missing_coupon_columns(apps, schema_editor):
    """Add any missing columns to backend_coupon (handles schema drift). Skip if table doesn't exist."""
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'backend_coupon'
        """)
        if cursor.fetchone() is None:
            return  # Table doesn't exist; 0012 will create it with all columns
        for col_name, add_sql in COUPON_COLUMNS:
            cursor.execute("""
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'backend_coupon' AND column_name = %s
            """, [col_name])
            if cursor.fetchone() is None:
                cursor.execute(add_sql)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0012_coupon_models"),
    ]

    operations = [
        migrations.RunPython(add_missing_coupon_columns, noop),
    ]
