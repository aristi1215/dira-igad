"""Connection helpers. psycopg3 is used directly (SQLAlchemy Core only for Alembic).

A tiny module on purpose: the invariants live in SQL constraints and transactions, so the
data layer keeps a thin, explicit surface over psycopg.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


def database_url() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://dira:dira@localhost:5432/dira")


def connect(url: str | None = None, *, autocommit: bool = False) -> psycopg.Connection:
    """Open a new connection with dict rows (the default row shape across the codebase)."""
    conn = psycopg.connect(url or database_url(), row_factory=dict_row, autocommit=autocommit)
    return conn


@contextmanager
def transaction(url: str | None = None) -> Iterator[psycopg.Connection]:
    """A connection whose single transaction commits on success and rolls back on error."""
    conn = connect(url)
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()
