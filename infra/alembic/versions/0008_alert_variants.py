"""Per-language and per-role alert variants.

`recipients.language` was collected by the roster form and read by nothing: an
alert had exactly one body, so a contact registered as Somali received the
Swahili text. This makes the field mean something.

`alerts.body_text` stays as the fallback variant, so nothing existing breaks and
no data migration is needed. `deliveries.body_text` snapshots the resolved text
at *approval* time — the approver is accountable for the exact string each
person receives, and resolving at dispatch time would let the audited text and
the sent text drift apart.

Revision ID: 0008_alert_variants
Revises: 0007_dispatch_selection
"""

from __future__ import annotations

from alembic import op

revision: str = "0008_alert_variants"
down_revision: str | None = "0007_dispatch_selection"
branch_labels = None
depends_on = None

SQL = """
CREATE TABLE IF NOT EXISTS alert_variants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id   UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  language   TEXT NOT NULL,
  role       TEXT,
  body_text  TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'llm'
               CHECK (source IN ('llm', 'human_edited', 'human_authored')),
  llm_draft  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniqueness must go through COALESCE: Postgres treats NULLs as distinct, so a
-- plain UNIQUE (alert_id, language, role) would admit two role-NULL rows for
-- the same language and the resolver would pick between them arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS alert_variants_uq
  ON alert_variants (alert_id, language, COALESCE(role, ''));

CREATE INDEX IF NOT EXISTS alert_variants_alert_idx ON alert_variants (alert_id);

-- A suggested vocabulary, not an enum: the roster is a living contact list and
-- new kinds of contact should not need a migration.
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS role TEXT;

-- The text this specific delivery carries, frozen at approval.
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS body_text TEXT;
"""


def upgrade() -> None:
    op.execute(SQL)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE deliveries DROP COLUMN IF EXISTS body_text;
        ALTER TABLE recipients DROP COLUMN IF EXISTS role;
        DROP INDEX IF EXISTS alert_variants_uq;
        DROP TABLE IF EXISTS alert_variants;
        """
    )
