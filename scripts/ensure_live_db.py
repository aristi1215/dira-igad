"""Create the dira_live database on the shared local Compose Postgres."""

from __future__ import annotations

import os
import sys

import psycopg

DEFAULT_ADMIN = "postgresql://dira:dira@localhost:55432/dira"
LIVE_DB_NAME = "dira_live"


def main() -> int:
    # Connect to the seeded DB (or any existing DB) to issue CREATE DATABASE.
    admin_url = (
        os.environ.get("DATABASE_URL_SEEDED")
        or os.environ.get("DATABASE_URL")
        or DEFAULT_ADMIN
    )
    with psycopg.connect(admin_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (LIVE_DB_NAME,))
            if cur.fetchone():
                print(f"[ensure_live_db] database {LIVE_DB_NAME} already exists")
            else:
                cur.execute(f'CREATE DATABASE "{LIVE_DB_NAME}" OWNER dira')
                print(f"[ensure_live_db] created database {LIVE_DB_NAME}")
            # Extensions are created by Alembic on first migrate of dira_live.
    return 0


if __name__ == "__main__":
    sys.exit(main())
