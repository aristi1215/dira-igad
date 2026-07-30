"""Add news_documents.url and provenance for source transparency."""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0006_news_url_provenance"
down_revision: str | None = "0005_retrieval_chunks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE news_documents
          ADD COLUMN IF NOT EXISTS url TEXT,
          ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb
        """
    )
    op.execute(
        """
        ALTER TABLE hazard_bulletins
          ADD COLUMN IF NOT EXISTS url TEXT
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE hazard_bulletins DROP COLUMN IF EXISTS url")
    op.execute("ALTER TABLE news_documents DROP COLUMN IF EXISTS provenance")
    op.execute("ALTER TABLE news_documents DROP COLUMN IF EXISTS url")
