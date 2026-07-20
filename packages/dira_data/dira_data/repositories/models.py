"""model_versions registry access."""

from __future__ import annotations

import json
from typing import Any

import psycopg


def register(
    conn: psycopg.Connection,
    *,
    kind: str,
    path: str | None,
    feature_list: list[str],
    metrics: dict[str, Any],
) -> str:
    """Insert a model_versions row and return its id. Caller controls the transaction."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO model_versions (kind, path, feature_list, metrics)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (kind, path, json.dumps(feature_list), json.dumps(metrics)),
        )
        return str(cur.fetchone()["id"])


def latest_id(conn: psycopg.Connection, kind: str | None = None) -> str | None:
    with conn.cursor() as cur:
        if kind:
            cur.execute(
                "SELECT id FROM model_versions WHERE kind=%s ORDER BY created_at DESC LIMIT 1",
                (kind,),
            )
        else:
            cur.execute("SELECT id FROM model_versions ORDER BY created_at DESC LIMIT 1")
        row = cur.fetchone()
    return str(row["id"]) if row else None


def ensure_transparent_index(conn: psycopg.Connection, feature_list: list[str]) -> str:
    """Idempotently ensure a transparent_index model_versions row exists; return its id."""
    existing = latest_id(conn, "transparent_index")
    if existing:
        return existing
    return register(
        conn, kind="transparent_index", path=None, feature_list=feature_list,
        metrics={"note": "seeded fallback; transparent weighted index"},
    )
