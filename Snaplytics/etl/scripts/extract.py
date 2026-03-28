# etl/scripts/extract.py
import pandas as pd
from pathlib import Path
import hashlib

INCOMING = Path("etl/incoming")

def checksum(path: Path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def extract():
    dfs = []
    for path in INCOMING.glob("*.xlsx"):
        print(f"📄 Reading {path.name} ...")
        try:
            df = pd.read_excel(path, header=None, engine="openpyxl", dtype=str)

            # keep original file source
            df["_source_file"] = path.name

            # ------------------------------------------------
            # 🔥 PATCH: Decide CONSENT vs BOOKING by the filename
            # ------------------------------------------------
            name = path.name.lower()

            if "consent" in name:
                df["record_type"] = "consent"
            else:
                df["record_type"] = "booking"

            dfs.append(df)

        except Exception as e:
            print(f"❌ Error reading {path.name}: {e}")
            continue

    return dfs
