"""Bitemporal pgvector retrieval repository."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Any

RETRIEVAL_NAMESPACE = uuid.UUID("4f7d4b58-4c8f-4b56-bb31-3f4f7c6f8e49")


def chunk_id(kind: str, source_id: str) -> uuid.UUID:
    return uuid.uuid5(RETRIEVAL_NAMESPACE, f"{kind}:{source_id}")


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(format(value, ".9g") for value in values) + "]"


def upsert_chunks(conn: Any, rows: Iterable[dict[str, Any]]) -> None:
    """Upsert already-embedded rows in one caller-controlled transaction."""
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                INSERT INTO retrieval_chunks (
                  id, kind, source_id, zone_id, content, embedding, available_at
                ) VALUES (%s, %s, %s, %s, %s, %s::vector, %s)
                ON CONFLICT (kind, source_id) DO UPDATE SET
                  content = EXCLUDED.content,
                  embedding = EXCLUDED.embedding,
                  zone_id = EXCLUDED.zone_id,
                  available_at = EXCLUDED.available_at
                """,
                (
                    row.get("id") or chunk_id(row["kind"], row["source_id"]),
                    row["kind"],
                    row["source_id"],
                    row.get("zone_id"),
                    row["content"],
                    _vector_literal(row["embedding"]),
                    row["available_at"],
                ),
            )


def search_corpus(
    conn: Any,
    query_embedding: list[float],
    *,
    cutoff: datetime,
    zone_id: str | None = None,
    kinds: list[str] | None = None,
    limit: int = 6,
) -> list[dict[str, Any]]:
    """Return nearest chunks visible at ``cutoff`` with cosine similarity."""
    clauses = ["available_at <= %s"]
    params: list[Any] = [_vector_literal(query_embedding), cutoff]
    if zone_id is not None:
        clauses.append("zone_id = %s")
        params.append(zone_id)
    if kinds:
        clauses.append("kind = ANY(%s)")
        params.append(kinds)
    params.append(max(1, limit))
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, kind, source_id, zone_id, content, available_at,
                   1 - (embedding <=> %s::vector) AS similarity
            FROM retrieval_chunks
            WHERE {' AND '.join(clauses)}
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            [params[0], *params[1:-1], params[0], params[-1]],
        )
        return [dict(row) for row in cur.fetchall()]
