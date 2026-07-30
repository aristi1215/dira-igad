"""Add the pgvector retrieval corpus."""

from __future__ import annotations

from alembic import op

revision: str = "0005_retrieval_chunks"
down_revision: str | None = "0004_geological_hazards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute(
        """
        CREATE TABLE retrieval_chunks (
          id UUID PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('news', 'hazard', 'field_report', 'zone_dossier')),
          source_id TEXT NOT NULL,
          zone_id TEXT REFERENCES zones(id),
          content TEXT NOT NULL,
          embedding vector(1024) NOT NULL,
          available_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX retrieval_chunks_kind_source_idx "
        "ON retrieval_chunks (kind, source_id)"
    )
    op.execute(
        "CREATE INDEX retrieval_chunks_embedding_hnsw_idx "
        "ON retrieval_chunks USING hnsw (embedding vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX retrieval_chunks_zone_available_idx "
        "ON retrieval_chunks (zone_id, available_at)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS retrieval_chunks_zone_available_idx")
    op.execute("DROP INDEX IF EXISTS retrieval_chunks_embedding_hnsw_idx")
    op.execute("DROP INDEX IF EXISTS retrieval_chunks_kind_source_idx")
    op.execute("DROP TABLE IF EXISTS retrieval_chunks")
