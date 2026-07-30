"""Build the deterministic retrieval corpus and persist its embeddings."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from dira_data.db import connect
from dira_data.retrieval import chunk_id, upsert_chunks
from dira_llm import get_embedding_model

SEEDED_CUTOFF = datetime(2026, 3, 21, 23, 59, tzinfo=UTC)


def gather_corpus(conn: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT nd.id, nd.title, nd.body, nd.source, nd.published_at,
                   nd.available_at, ns.zone_id
            FROM news_documents nd
            LEFT JOIN LATERAL (
              SELECT zone_id FROM news_signals
              WHERE document_id = nd.id
              ORDER BY cycle DESC, zone_id
              LIMIT 1
            ) ns ON TRUE
            ORDER BY nd.id
            """
        )
        for row in cur.fetchall():
            rows.append(
                {
                    "kind": "news",
                    "source_id": str(row["id"]),
                    "zone_id": row["zone_id"],
                    "content": (
                        f"News report: {row['title']}\n"
                        f"Source: {row['source']}\n"
                        f"Published: {row['published_at']}\n"
                        f"{row['body']}"
                    ),
                    "available_at": row["available_at"],
                }
            )
        cur.execute(
            """
            SELECT id, zone_id, hazard_type, severity, headline, detail,
                   valid_from, valid_to, source, available_at
            FROM hazard_bulletins
            ORDER BY id
            """
        )
        for row in cur.fetchall():
            rows.append(
                {
                    "kind": "hazard",
                    "source_id": str(row["id"]),
                    "zone_id": row["zone_id"],
                    "content": (
                        f"Hazard bulletin: {row['headline']}\n"
                        f"Type: {row['hazard_type']}; severity: {row['severity']}; "
                        f"valid: {row['valid_from']} to {row['valid_to'] or 'open-ended'}\n"
                        f"Source: {row['source']}\n{row['detail'] or ''}"
                    ),
                    "available_at": row["available_at"],
                }
            )
        cur.execute(
            """
            SELECT id, zone_id, reporter_role, category, severity, narrative,
                   reported_at, status, available_at
            FROM field_reports
            WHERE status = 'verified'
            ORDER BY id
            """
        )
        for row in cur.fetchall():
            rows.append(
                {
                    "kind": "field_report",
                    "source_id": str(row["id"]),
                    "zone_id": row["zone_id"],
                    "content": (
                        f"Verified field report: {row['category']}\n"
                        f"Reporter role: {row['reporter_role']}; severity: {row['severity']}; "
                        f"reported: {row['reported_at']}\n{row['narrative']}"
                    ),
                    "available_at": row["available_at"],
                }
            )
        cur.execute(
            """
            SELECT z.id, z.name, z.country_iso2,
                   COALESCE(vc.active_hazards, 0) AS active_hazards,
                   COALESCE(vc.active_health_alerts, 0) AS active_health_alerts,
                   COALESCE(vc.verified_field_reports_recent, 0)
                     AS verified_field_reports_recent,
                   COALESCE(vc.unverified_field_reports_recent, 0)
                     AS unverified_field_reports_recent
            FROM zones z
            LEFT JOIN v_zone_context vc ON vc.zone_id = z.id
            ORDER BY z.id
            """
        )
        for row in cur.fetchall():
            rows.append(
                {
                    "kind": "zone_dossier",
                    "source_id": str(row["id"]),
                    "zone_id": row["id"],
                    "content": (
                        f"Zone dossier: {row['name']} ({row['country_iso2']})\n"
                        f"Active hazards: {row['active_hazards']}; "
                        f"health alerts: {row['active_health_alerts']}\n"
                        f"Verified field reports (recent): "
                        f"{row['verified_field_reports_recent']}; "
                        f"unverified: {row['unverified_field_reports_recent']}"
                    ),
                    "available_at": SEEDED_CUTOFF,
                }
            )
    return rows


def main() -> None:
    with connect() as conn:
        corpus = gather_corpus(conn)
    model = get_embedding_model()
    embeddings = model.embed([row["content"] for row in corpus])
    if len(embeddings) != len(corpus):
        raise RuntimeError("Embedding adapter returned the wrong number of vectors")
    for row, embedding in zip(corpus, embeddings, strict=True):
        if len(embedding) != model.dimensions:
            raise RuntimeError("Embedding adapter returned the wrong vector dimension")
        row["id"] = chunk_id(row["kind"], row["source_id"])
        row["embedding"] = embedding
    with connect() as conn:
        with conn.transaction():
            upsert_chunks(conn, corpus)
    print(f"[embed] upserted {len(corpus)} retrieval chunks (dimensions={model.dimensions})")


if __name__ == "__main__":
    main()
