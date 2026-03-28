from django.core.management.base import BaseCommand
from etl.scripts.run_etl import run_etl

class Command(BaseCommand):
    help = "Run the ETL pipeline"

    def add_arguments(self, parser):
        parser.add_argument("--merge", action="store_true")

    def handle(self, *args, **options):
        merge = options["merge"]
        run_etl(merge=merge)
        self.stdout.write(self.style.SUCCESS("ETL completed"))
