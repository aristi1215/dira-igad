"""Reject at the human gate, and proof of what the approver read.

The gate could only ever say yes: an operator could approve a drafted alert or
leave it sitting in the queue forever, but never decline one on the record.
This adds 'rejected' as a first-class terminal state, guarded by a CHECK that
mirrors `alerts_human_gate_chk` — declining is as much a human decision as
approving, and gets the same proof at the database level.

`approved_body_sha256` records the exact text the approver stood behind. The
delivery rows already record *who* was targeted; nothing recorded *what* was
read, so an edit landing after approval was undetectable.

Revision ID: 0007_dispatch_selection
Revises: 0006_news_url_provenance
"""

from __future__ import annotations

from alembic import op

revision: str = "0007_dispatch_selection"
down_revision: str | None = "0006_news_url_provenance"
branch_labels = None
depends_on = None

SQL = """
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS rejected_by          TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason     TEXT,
  ADD COLUMN IF NOT EXISTS approved_body_sha256 TEXT;

-- The status CHECK was declared inline and unnamed in 0001, so its name is
-- whatever Postgres generated. Resolve it rather than guessing, and re-add it
-- named so the next migration does not repeat this dance.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'alerts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%pending_approval%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE alerts DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE alerts ADD CONSTRAINT alerts_status_chk CHECK (
  status IN (
    'draft', 'pending_approval', 'approved',
    'dispatching', 'dispatched', 'failed', 'rejected'
  )
);

ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_rejection_chk;
ALTER TABLE alerts ADD CONSTRAINT alerts_rejection_chk CHECK (
  status <> 'rejected' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL)
);
"""


def upgrade() -> None:
    op.execute(SQL)


def downgrade() -> None:
    op.execute(
        """
        -- Rejected alerts have no home in the old enum; drop them rather than
        -- leave rows the restored CHECK would reject.
        DELETE FROM alerts WHERE status = 'rejected';

        ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_rejection_chk;
        ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_status_chk;
        ALTER TABLE alerts ADD CONSTRAINT alerts_status_chk CHECK (
          status IN (
            'draft', 'pending_approval', 'approved',
            'dispatching', 'dispatched', 'failed'
          )
        );

        ALTER TABLE alerts
          DROP COLUMN IF EXISTS rejected_by,
          DROP COLUMN IF EXISTS rejected_at,
          DROP COLUMN IF EXISTS rejection_reason,
          DROP COLUMN IF EXISTS approved_body_sha256;
        """
    )
