"""Shared test fixtures.

Integration tests run against a REAL PostgreSQL (never SQLite) — the invariants are DB
constraints and transactions, and only a real Postgres proves them (DIRA-SPEC.md §6). The
schema is applied once per session from the authoritative DDL; each test starts from empty
data tables (TRUNCATE, schema preserved).
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

_DDL = Path(__file__).resolve().parent / "infra" / "migrations" / "001_init.sql"

# Data tables cleared between tests (schema-owned rows like spatial_ref_sys are left alone).
_DATA_TABLES = [
    "deliveries",
    "recipients",
    "alerts",
    "exposure_snapshots",
    "assessments",
    "situations",
    "model_versions",
    "news_signals",
    "news_documents",
    "acled_events",
    "zone_climate_dekadal",
    "zone_exposure",
    "zone_adjacency",
    "zones",
    "clusters",
]


def _database_url() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://dira:dira@localhost:5432/dira")


def _schema_present(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.situations') IS NOT NULL AS ok")
        row = cur.fetchone()
        return bool(row["ok"]) if row else False


@pytest.fixture(scope="session")
def db_url() -> str:
    return _database_url()


@pytest.fixture(scope="session")
def _ensure_schema(db_url: str) -> None:
    """Apply the authoritative DDL once per session if the schema is absent.

    NOT autouse: pure-domain tests must run with no DB and no ``.env``. Only fixtures that
    actually need a database depend on this.
    """
    try:
        conn = psycopg.connect(db_url, autocommit=True, row_factory=dict_row)
    except psycopg.OperationalError as exc:  # pragma: no cover - environment guard
        pytest.skip(f"PostgreSQL not reachable at DATABASE_URL: {exc}")
    with conn:
        if not _schema_present(conn):
            conn.execute(_DDL.read_text())


def _truncate(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("TRUNCATE " + ", ".join(_DATA_TABLES) + " RESTART IDENTITY CASCADE")
    conn.commit()


@pytest.fixture
def db(db_url: str, _ensure_schema: None) -> Iterator[psycopg.Connection]:
    """A clean, migrated DB connection (dict rows). Data is truncated before and after."""
    conn = psycopg.connect(db_url, row_factory=dict_row)
    _truncate(conn)
    try:
        yield conn
    finally:
        conn.rollback()
        _truncate(conn)
        conn.close()
