"""Schema helpers shared by the seed command and tests (single DDL source of truth)."""

from __future__ import annotations

from pathlib import Path

import psycopg


def ddl_path() -> Path:
    # packages/dira_data/dira_data/schema.py -> repo root / infra / migrations / 001_init.sql
    return Path(__file__).resolve().parents[3] / "infra" / "migrations" / "001_init.sql"


def schema_present(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.situations') AS t")
        row = cur.fetchone()
    value = row["t"] if isinstance(row, dict) else (row[0] if row else None)
    return value is not None


def ensure_schema(conn: psycopg.Connection) -> None:
    """Apply the authoritative DDL if the schema is absent (idempotent)."""
    if schema_present(conn):
        return
    conn.execute(ddl_path().read_text())
    conn.commit()
