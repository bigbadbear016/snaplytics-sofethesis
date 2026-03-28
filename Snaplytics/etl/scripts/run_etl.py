import shutil
import logging
from pathlib import Path

from etl.scripts.extract import extract, checksum
from etl.scripts.transform import transform
from etl.scripts.load import insert_staging, merge_consent, merge_bookings

logger = logging.getLogger(__name__)


def run_etl(merge=False):

    raw_files = extract()

    for df_raw in raw_files:

        file_path = Path("etl/incoming") / df_raw["_source_file"].iloc[0]
        file_name = file_path.name
        file_hash = checksum(file_path)

        df_can = transform(df_raw)

        if df_can.empty:
            logger.warning("⚠ No records extracted from file. Skipping.")
            continue

        # Staging always
        insert_staging(df_can, file_name, file_hash)

        # Merge into customers / bookings
        if merge:
            if df_can["record_type"].iloc[0] == "consent":
                print("🔄 Merging CONSENT …")
                merge_consent(df_can)
            else:
                print("🔄 Merging BOOKINGS …")
                merge_bookings(df_can)

        # Move processed file
        dest = Path("etl/processed") / file_path.name
        shutil.move(str(file_path), str(dest))
