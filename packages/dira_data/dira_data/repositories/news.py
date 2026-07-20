"""News documents and signals. Documents are DATA (never executed as instructions).

Signals are always born ``unconfirmed`` (invariant 7) and never trigger anything alone.
Deterministic UUIDs (uuid5) keep seeding idempotent.
"""

from __future__ import annotations

import uuid
from typing import Any

import psycopg

_NS = uuid.UUID("0d17a000-0000-5000-8000-000000000001")


def doc_uuid(natural_id: str) -> uuid.UUID:
    return uuid.uuid5(_NS, f"doc:{natural_id}")


def signal_uuid(natural_id: str, idx: int) -> uuid.UUID:
    return uuid.uuid5(_NS, f"sig:{natural_id}:{idx}")


def upsert_document(conn: psycopg.Connection, doc: dict[str, Any]) -> uuid.UUID:
    did = doc_uuid(doc["id"])
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO news_documents (id, url, title, body, published_at, available_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (did, doc.get("url"), doc["title"], doc["body"],
             doc["published_at"], doc["available_at"]),
        )
    return did


def read_documents_available(conn: psycopg.Connection, cutoff: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, body, published_at, available_at FROM news_documents "
            "WHERE available_at <= %s ORDER BY published_at",
            (cutoff,),
        )
        return [dict(r) for r in cur.fetchall()]


def insert_signals_for_document(
    conn: psycopg.Connection,
    document_id: uuid.UUID,
    signals: list[dict[str, Any]],
    available_at: Any,
) -> None:
    """Insert extracted signals (born 'unconfirmed'). Deterministic ids -> idempotent E3."""
    with conn.cursor() as cur:
        for idx, s in enumerate(signals):
            sid = uuid.uuid5(_NS, f"sig:{document_id}:{idx}")
            cur.execute(
                """
                INSERT INTO news_signals
                    (id, document_id, zone_id, signal_type, status, summary, available_at)
                VALUES (%s, %s, %s, %s, 'unconfirmed', %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (sid, document_id, s.get("zone_id"), s["signal_type"], s["summary"], available_at),
            )


def count_confirmed_signals(
    conn: psycopg.Connection, zone_id: str, cutoff: Any, since: Any
) -> int:
    """Confirmed signals for a zone, available by cutoff and published since ``since``.

    Corroboration uses ONLY confirmed signals (invariant 7: unconfirmed news never counts).
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) AS n FROM news_signals ns JOIN news_documents nd "
            "ON nd.id = ns.document_id "
            "WHERE ns.zone_id=%s AND ns.status='confirmed' "
            "AND ns.available_at <= %s AND nd.published_at >= %s",
            (zone_id, cutoff, since),
        )
        return int(cur.fetchone()["n"])


def confirm_signal(conn: psycopg.Connection, signal_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE news_signals SET status='confirmed' WHERE id=%s", (signal_id,))


def upsert_signals(
    conn: psycopg.Connection,
    document_natural_id: str,
    document_id: uuid.UUID,
    signals: list[dict[str, Any]],
    available_at: str,
) -> None:
    with conn.cursor() as cur:
        for idx, s in enumerate(signals):
            cur.execute(
                """
                INSERT INTO news_signals
                    (id, document_id, zone_id, signal_type, status, summary, available_at)
                VALUES (%s, %s, %s, %s, 'unconfirmed', %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (signal_uuid(document_natural_id, idx), document_id, s.get("zone_id"),
                 s["signal_type"], s["summary"], available_at),
            )
