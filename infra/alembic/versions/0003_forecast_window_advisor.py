"""Forecast window on assessments/alerts + advisor conversations.

Revision ID: 0003_forecast_window_advisor
Revises: 0002_information_layer
"""

from __future__ import annotations

from alembic import op

revision: str = "0003_forecast_window_advisor"
down_revision: str | None = "0002_information_layer"
branch_labels = None
depends_on = None

SQL = """
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS horizon_dekads INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS window_start DATE,
  ADD COLUMN IF NOT EXISTS window_end DATE;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS window_start DATE,
  ADD COLUMN IF NOT EXISTS window_end DATE;

-- Backfill: the forecast window opens the day after the assessed dekad ends.
UPDATE assessments
SET window_start = cycle + INTERVAL '10 days',
    window_end   = cycle + INTERVAL '40 days'
WHERE window_start IS NULL;

CREATE TABLE IF NOT EXISTS advisor_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS advisor_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         TEXT NOT NULL,
  tool_name       TEXT,
  citations       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS advisor_messages_conversation_idx
  ON advisor_messages (conversation_id, created_at);

CREATE OR REPLACE VIEW v_map_situations AS
SELECT
  s.id AS situation_id,
  s.zone_id,
  s.hazard,
  s.status AS situation_status,
  z.name AS zone_name,
  z.country_iso2,
  z.geom,
  a.id AS assessment_id,
  a.cycle,
  a.model_risk,
  a.model_band,
  a.corroboration,
  a.operational_band,
  a.explanation,
  a.combination_rule,
  a.shap,
  a.exposure_snapshot,
  a.prob_conflict,
  a.expected_incidents,
  a.horizon_dekads,
  a.window_start,
  a.window_end
FROM situations s
JOIN zones z ON z.id = s.zone_id
LEFT JOIN LATERAL (
  SELECT * FROM assessments asmt
  WHERE asmt.situation_id = s.id
  ORDER BY asmt.cycle DESC
  LIMIT 1
) a ON TRUE;
"""


def upgrade() -> None:
    op.execute(SQL)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS advisor_messages;
        DROP TABLE IF EXISTS advisor_conversations;
        DROP VIEW IF EXISTS v_map_situations;
        ALTER TABLE alerts DROP COLUMN IF EXISTS window_start, DROP COLUMN IF EXISTS window_end;
        ALTER TABLE assessments
          DROP COLUMN IF EXISTS horizon_dekads,
          DROP COLUMN IF EXISTS window_start,
          DROP COLUMN IF EXISTS window_end;
        """
    )
