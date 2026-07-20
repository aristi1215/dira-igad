"""Request-scoped dependencies: a DB connection per request (autocommit; endpoints that need
a multi-statement atomic block use conn.transaction())."""

from __future__ import annotations

from collections.abc import Iterator

import psycopg
from psycopg.rows import dict_row

from dira_api.settings import get_settings


def get_conn() -> Iterator[psycopg.Connection]:
    settings = get_settings()
    conn = psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()
