from __future__ import annotations

from datetime import UTC, datetime

import pytest
from dira_data.retrieval import chunk_id, search_corpus, upsert_chunks


@pytest.mark.integration
def test_search_corpus_is_bitemporal_and_ranked(db_conn) -> None:
    source_id = "integration-retrieval-test"
    vector = [0.0] * 1024
    vector[0] = 1.0
    with db_conn.transaction():
        with db_conn.cursor() as cur:
            cur.execute(
                "DELETE FROM retrieval_chunks WHERE kind = 'zone_dossier' AND source_id = %s",
                (source_id,),
            )
        upsert_chunks(
            db_conn,
            [
                {
                    "id": chunk_id("zone_dossier", source_id),
                    "kind": "zone_dossier",
                    "source_id": source_id,
                    "zone_id": None,
                    "content": "Integration retrieval fixture",
                    "embedding": vector,
                    "available_at": datetime(2026, 3, 1, tzinfo=UTC),
                }
            ],
        )
    db_conn.commit()
    hits = search_corpus(
        db_conn,
        vector,
        cutoff=datetime(2026, 3, 2, tzinfo=UTC),
        kinds=["zone_dossier"],
    )
    assert hits
    assert hits[0]["source_id"] == source_id
    assert float(hits[0]["similarity"]) > 0.99
    with db_conn.transaction():
        with db_conn.cursor() as cur:
            cur.execute(
                "DELETE FROM retrieval_chunks WHERE kind = 'zone_dossier' AND source_id = %s",
                (source_id,),
            )
    db_conn.commit()
