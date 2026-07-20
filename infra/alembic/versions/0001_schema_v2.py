"""Full Dira schema v2 — DDL from DIRA-SPEC.md §5.

Revision ID: 0001_schema_v2
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0001_schema_v2"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA_SQL = r"""
CREATE TABLE IF NOT EXISTS clusters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zones (
  id           TEXT PRIMARY KEY,
  cluster_id   TEXT NOT NULL REFERENCES clusters(id),
  name         TEXT NOT NULL,
  country_iso2 CHAR(2) NOT NULL,
  geom         geometry(MultiPolygon, 4326) NOT NULL,
  centroid     geometry(Point, 4326),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zones_geom_gix ON zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS zones_cluster_idx ON zones (cluster_id);

CREATE TABLE IF NOT EXISTS zone_adjacency (
  zone_id              TEXT NOT NULL REFERENCES zones(id),
  neighbor_id          TEXT NOT NULL REFERENCES zones(id),
  shared_border_m      DOUBLE PRECISION NOT NULL DEFAULT 0,
  centroid_distance_km DOUBLE PRECISION NOT NULL,
  cross_border         BOOLEAN NOT NULL,
  PRIMARY KEY (zone_id, neighbor_id),
  CHECK (zone_id <> neighbor_id)
);

CREATE TABLE IF NOT EXISTS zone_exposure (
  zone_id            TEXT PRIMARY KEY REFERENCES zones(id),
  population         INTEGER NOT NULL CHECK (population >= 0),
  pastoralist_share  DOUBLE PRECISION,
  water_points       INTEGER,
  markets            INTEGER,
  source             TEXT NOT NULL DEFAULT 'seeded',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zone_climate_dekadal (
  zone_id            TEXT NOT NULL REFERENCES zones(id),
  dekad_start        DATE NOT NULL,
  rain_mm            DOUBLE PRECISION,
  rain_available_at  TIMESTAMPTZ,
  ndvi_mean          DOUBLE PRECISION,
  ndvi_available_at  TIMESTAMPTZ,
  PRIMARY KEY (zone_id, dekad_start),
  CONSTRAINT zone_climate_dekad_day_chk
    CHECK (EXTRACT(DAY FROM dekad_start)::INT IN (1, 11, 21))
);

CREATE TABLE IF NOT EXISTS acled_events (
  event_id     TEXT PRIMARY KEY,
  event_date   DATE NOT NULL,
  zone_id      TEXT REFERENCES zones(id),
  event_type   TEXT NOT NULL,
  fatalities   INTEGER NOT NULL DEFAULT 0,
  actor1       TEXT,
  actor2       TEXT,
  notes        TEXT,
  geom         geometry(Point, 4326),
  available_at TIMESTAMPTZ NOT NULL,
  source       TEXT NOT NULL DEFAULT 'acled'
);

CREATE INDEX IF NOT EXISTS acled_events_zone_date_idx ON acled_events (zone_id, event_date);
CREATE INDEX IF NOT EXISTS acled_events_available_idx ON acled_events (available_at);

CREATE TABLE IF NOT EXISTS news_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id  TEXT UNIQUE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  source       TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  available_at TIMESTAMPTZ NOT NULL,
  embedding    vector(1024),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID REFERENCES news_documents(id),
  zone_id       TEXT REFERENCES zones(id),
  signal_type   TEXT NOT NULL,
  confidence    DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status        TEXT NOT NULL DEFAULT 'unconfirmed'
                  CHECK (status IN ('unconfirmed', 'corroborated', 'rejected')),
  excerpt       TEXT,
  cycle         DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_signals_zone_cycle_idx ON news_signals (zone_id, cycle);

CREATE TABLE IF NOT EXISTS model_versions (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('lightgbm', 'transparent_index')),
  artifact_path TEXT,
  feature_list  JSONB NOT NULL,
  metrics       JSONB NOT NULL DEFAULT '{}',
  model_card    JSONB NOT NULL DEFAULT '{}',
  trained_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS situations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id                  TEXT NOT NULL REFERENCES zones(id),
  hazard                   TEXT NOT NULL DEFAULT 'conflict_pressure',
  status                   TEXT NOT NULL
                             CHECK (status IN ('open', 'resolved', 'dismissed')),
  opened_cycle             DATE NOT NULL,
  resolved_cycle           DATE,
  cycles_below_threshold   INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS situations_one_open_per_zone_hazard
  ON situations (zone_id, hazard)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS assessments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id       UUID REFERENCES situations(id),
  zone_id            TEXT NOT NULL REFERENCES zones(id),
  cycle              DATE NOT NULL,
  model_version_id   TEXT REFERENCES model_versions(id),
  prob_conflict      DOUBLE PRECISION NOT NULL,
  expected_incidents DOUBLE PRECISION NOT NULL,
  model_risk         DOUBLE PRECISION NOT NULL,
  model_band         TEXT NOT NULL,
  corroboration      DOUBLE PRECISION NOT NULL DEFAULT 0,
  operational_band   TEXT NOT NULL,
  combination_rule   TEXT NOT NULL,
  explanation        TEXT NOT NULL,
  shap               JSONB NOT NULL DEFAULT '{}',
  exposure_snapshot  JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_assessment_per_cycle UNIQUE (zone_id, cycle, situation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_zone_cycle ON assessments (zone_id, cycle);

CREATE TABLE IF NOT EXISTS alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id UUID NOT NULL REFERENCES situations(id),
  status       TEXT NOT NULL
                 CHECK (status IN (
                   'draft', 'pending_approval', 'approved',
                   'dispatching', 'dispatched', 'failed'
                 )),
  language     TEXT NOT NULL DEFAULT 'sw',
  body_text    TEXT NOT NULL,
  audio_url    TEXT,
  created_by   TEXT,
  approved_by  TEXT,
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT alerts_human_gate_chk CHECK (
    status NOT IN ('approved', 'dispatching', 'dispatched')
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS recipients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  zone_id    TEXT REFERENCES zones(id),
  channel    TEXT NOT NULL DEFAULT 'voice',
  language   TEXT NOT NULL DEFAULT 'sw',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recipients_e164_chk CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TABLE IF NOT EXISTS deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id            UUID NOT NULL REFERENCES alerts(id),
  recipient_id        UUID NOT NULL REFERENCES recipients(id),
  channel             TEXT NOT NULL DEFAULT 'voice',
  idempotency_key     TEXT NOT NULL,
  provider_message_id TEXT,
  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN (
                          'queued', 'sending', 'sent', 'delivered',
                          'failed', 'needs_review'
                        )),
  claimed_at          TIMESTAMPTZ,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error          TEXT,
  ack_status          TEXT NOT NULL DEFAULT 'none'
                        CHECK (ack_status IN (
                          'none', 'acknowledged', 'conflict_reported', 'resolved'
                        )),
  ack_method          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deliveries_idempotency_key_uq UNIQUE (idempotency_key),
  CONSTRAINT deliveries_provider_message_id_uq UNIQUE (provider_message_id)
);

CREATE INDEX IF NOT EXISTS deliveries_queue_idx
  ON deliveries (status, next_attempt_at)
  WHERE status IN ('queued', 'sending');

CREATE OR REPLACE FUNCTION dira_notify_event() RETURNS trigger AS $$
DECLARE
  payload JSON;
BEGIN
  payload := json_build_object(
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'id', COALESCE(NEW.id, OLD.id),
    'status', COALESCE(NEW.status, OLD.status)
  );
  PERFORM pg_notify('dira_events', payload::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deliveries_notify ON deliveries;
CREATE TRIGGER deliveries_notify
  AFTER INSERT OR UPDATE OF status, ack_status ON deliveries
  FOR EACH ROW EXECUTE FUNCTION dira_notify_event();

DROP TRIGGER IF EXISTS situations_notify ON situations;
CREATE TRIGGER situations_notify
  AFTER INSERT OR UPDATE OF status ON situations
  FOR EACH ROW EXECUTE FUNCTION dira_notify_event();

DROP TRIGGER IF EXISTS alerts_notify ON alerts;
CREATE TRIGGER alerts_notify
  AFTER INSERT OR UPDATE OF status ON alerts
  FOR EACH ROW EXECUTE FUNCTION dira_notify_event();

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
  a.expected_incidents
FROM situations s
JOIN zones z ON z.id = s.zone_id
LEFT JOIN LATERAL (
  SELECT * FROM assessments asmt
  WHERE asmt.situation_id = s.id
  ORDER BY asmt.cycle DESC
  LIMIT 1
) a ON TRUE;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_meta (key, value)
VALUES ('schema_status', 'v2_full')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
"""


def upgrade() -> None:
    op.execute(SCHEMA_SQL)


def downgrade() -> None:
    op.execute(
        """
        DROP VIEW IF EXISTS v_map_situations;
        DROP TABLE IF EXISTS deliveries;
        DROP TABLE IF EXISTS recipients;
        DROP TABLE IF EXISTS alerts;
        DROP TABLE IF EXISTS assessments;
        DROP TABLE IF EXISTS situations;
        DROP TABLE IF EXISTS model_versions;
        DROP TABLE IF EXISTS news_signals;
        DROP TABLE IF EXISTS news_documents;
        DROP TABLE IF EXISTS acled_events;
        DROP TABLE IF EXISTS zone_climate_dekadal;
        DROP TABLE IF EXISTS zone_exposure;
        DROP TABLE IF EXISTS zone_adjacency;
        DROP TABLE IF EXISTS zones;
        DROP TABLE IF EXISTS clusters;
        DROP FUNCTION IF EXISTS dira_notify_event();
        """
    )
