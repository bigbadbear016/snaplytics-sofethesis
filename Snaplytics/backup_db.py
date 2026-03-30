import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv


def main() -> None:
    project_root = Path(__file__).resolve().parent
    workspace_root = project_root.parent

    # Load .env from workspace root, then from project root as fallback.
    load_dotenv(workspace_root / ".env")
    load_dotenv(project_root / ".env")

    db_name = os.getenv("DB_NAME")
    db_user = os.getenv("DB_USER")
    db_password = os.getenv("DB_PASSWORD")
    db_host = os.getenv("DB_HOST")
    db_port = os.getenv("DB_PORT", "5432")

    required = {
        "DB_NAME": db_name,
        "DB_USER": db_user,
        "DB_PASSWORD": db_password,
        "DB_HOST": db_host,
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")

    pg_dump = shutil.which("pg_dump")
    if not pg_dump:
        raise SystemExit(
            "pg_dump not found in PATH. Install PostgreSQL client tools and try again."
        )

    backup_dir = workspace_root / "db_backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"{db_name}_{timestamp}.sql"

    env = os.environ.copy()
    env["PGPASSWORD"] = db_password

    command = [
        pg_dump,
        "-h",
        db_host,
        "-p",
        db_port,
        "-U",
        db_user,
        "-d",
        db_name,
        "-F",
        "p",
        "-f",
        str(backup_file),
    ]

    print(f"Creating backup: {backup_file}")
    subprocess.run(command, env=env, check=True)
    print("Backup complete.")


if __name__ == "__main__":
    main()