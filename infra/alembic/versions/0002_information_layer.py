"""Information layer — CEWARN multi-source indicators.

Adds the observation tables IGAD/CEWARN actually monitor beyond climate and
ACLED: IPC food security, displacement, market prices, health surveillance,
hazard bulletins (locust/flood/heat/drought) and field-monitor reports.

Every table carries `source` + `available_at` so the bitemporal rule
("only data available at the cycle cutoff") extends to the new sources.

Red line preserved: field reports are born `unverified` and only `verified`
ones may ever contribute to corroboration — never to model risk.

Revision ID: 0002_information_layer
Revises: 0001_schema_v2
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002_information_layer"
down_revision: str | None = "0001_schema_v2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA_SQL = r"""
CREATE TABLE IF NOT EXISTS food_security (
  zone_id         TEXT NOT NULL REFERENCES zones(id),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  ipc_phase       SMALLINT NOT NULL CHECK (ipc_phase BETWEEN 1 AND 5),
  pop_phase3_plus INTEGER CHECK (pop_phase3_plus >= 0),
  source          TEXT NOT NULL DEFAULT 'seeded_ipc',
  available_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (zone_id, period_start)
);
CREATE INDEX IF NOT EXISTS food_security_period_idx ON food_security (period_start);

CREATE TABLE IF NOT EXISTS displacement (
  zone_id       TEXT NOT NULL REFERENCES zones(id),
  snapshot_date DATE NOT NULL,
  idps          INTEGER NOT NULL DEFAULT 0 CHECK (idps >= 0),
  refugees      INTEGER NOT NULL DEFAULT 0 CHECK (refugees >= 0),
  returnees     INTEGER NOT NULL DEFAULT 0 CHECK (returnees >= 0),
  source        TEXT NOT NULL DEFAULT 'seeded_dtm',
  available_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (zone_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS displacement_date_idx ON displacement (snapshot_date);

CREATE TABLE IF NOT EXISTS market_prices (
  zone_id        TEXT NOT NULL REFERENCES zones(id),
  market_name    TEXT NOT NULL,
  month          DATE NOT NULL,
  commodity      TEXT NOT NULL,
  unit           TEXT NOT NULL,
  price          DOUBLE PRECISION NOT NULL CHECK (price >= 0),
  currency       TEXT NOT NULL,
  pct_vs_3m_avg  DOUBLE PRECISION,
  source         TEXT NOT NULL DEFAULT 'seeded_wfp',
  available_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (zone_id, market_name, month, commodity),
  CONSTRAINT market_prices_month_chk CHECK (EXTRACT(DAY FROM month)::INT = 1)
);
CREATE INDEX IF NOT EXISTS market_prices_month_idx ON market_prices (month);

CREATE TABLE IF NOT EXISTS health_surveillance (
  zone_id      TEXT NOT NULL REFERENCES zones(id),
  week_start   DATE NOT NULL,
  disease      TEXT NOT NULL,
  cases        INTEGER NOT NULL DEFAULT 0 CHECK (cases >= 0),
  deaths       INTEGER NOT NULL DEFAULT 0 CHECK (deaths >= 0),
  status       TEXT NOT NULL DEFAULT 'monitoring'
               CHECK (status IN ('monitoring', 'alert', 'outbreak', 'closed')),
  source       TEXT NOT NULL DEFAULT 'seeded_who',
  available_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (zone_id, week_start, disease)
);
CREATE INDEX IF NOT EXISTS health_week_idx ON health_surveillance (week_start);

CREATE TABLE IF NOT EXISTS hazard_bulletins (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id      TEXT NOT NULL REFERENCES zones(id),
  hazard_type  TEXT NOT NULL CHECK (hazard_type IN ('locust', 'flood', 'heat', 'drought')),
  severity     TEXT NOT NULL CHECK (severity IN ('advisory', 'watch', 'warning')),
  headline     TEXT NOT NULL,
  detail       TEXT,
  valid_from   DATE NOT NULL,
  valid_to     DATE,
  source       TEXT NOT NULL DEFAULT 'seeded_bulletin',
  available_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT hazard_bulletins_validity_chk CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS hazard_zone_idx ON hazard_bulletins (zone_id, valid_from DESC);

-- CEWARN's core primary channel: structured reports from trained field
-- monitors. Born unverified; a named human verifies before the report can
-- count toward corroboration (mirrors the news-signal red line).
CREATE TABLE IF NOT EXISTS field_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id       TEXT NOT NULL REFERENCES zones(id),
  reporter_role TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN (
                  'livestock_raid', 'water_dispute', 'pasture_dispute',
                  'migration_influx', 'market_disruption', 'road_blockage',
                  'peace_meeting', 'armed_presence', 'other')),
  severity      SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 3),
  narrative     TEXT NOT NULL,
  reported_at   TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'unverified'
                CHECK (status IN ('unverified', 'verified', 'dismissed')),
  verified_by   TEXT,
  verified_at   TIMESTAMPTZ,
  available_at  TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT field_reports_verification_chk CHECK (
    status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS field_reports_zone_idx ON field_reports (zone_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS field_reports_status_idx ON field_reports (status);

DROP TRIGGER IF EXISTS field_reports_notify ON field_reports;
CREATE TRIGGER field_reports_notify
  AFTER INSERT OR UPDATE ON field_reports
  FOR EACH ROW EXECUTE FUNCTION dira_notify_event();

-- Latest value of every indicator per zone: feeds map overlays and cards.
CREATE OR REPLACE VIEW v_zone_context AS
SELECT
  z.id AS zone_id,
  z.name AS zone_name,
  z.cluster_id,
  z.country_iso2,
  fs.ipc_phase,
  fs.pop_phase3_plus,
  fs.period_start AS ipc_period_start,
  d.idps,
  d.refugees,
  d.snapshot_date AS displacement_date,
  mp.staple_pct_vs_3m_avg,
  mp.staple_commodity,
  hz.active_hazards,
  hs.active_health_alerts,
  fr.verified_field_reports_recent,
  fr.unverified_field_reports_recent
FROM zones z
LEFT JOIN LATERAL (
  SELECT ipc_phase, pop_phase3_plus, period_start
  FROM food_security fs WHERE fs.zone_id = z.id
  ORDER BY period_start DESC LIMIT 1
) fs ON TRUE
LEFT JOIN LATERAL (
  SELECT idps, refugees, snapshot_date
  FROM displacement d WHERE d.zone_id = z.id
  ORDER BY snapshot_date DESC LIMIT 1
) d ON TRUE
LEFT JOIN LATERAL (
  SELECT pct_vs_3m_avg AS staple_pct_vs_3m_avg, commodity AS staple_commodity
  FROM market_prices m
  WHERE m.zone_id = z.id AND m.commodity IN ('maize', 'sorghum')
  ORDER BY m.month DESC, m.commodity LIMIT 1
) mp ON TRUE
LEFT JOIN LATERAL (
  SELECT count(*) AS active_hazards
  FROM hazard_bulletins h
  WHERE h.zone_id = z.id AND (h.valid_to IS NULL OR h.valid_to >= CURRENT_DATE)
) hz ON TRUE
LEFT JOIN LATERAL (
  SELECT count(*) AS active_health_alerts
  FROM health_surveillance s
  WHERE s.zone_id = z.id AND s.status IN ('alert', 'outbreak')
) hs ON TRUE
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE r.status = 'verified')   AS verified_field_reports_recent,
    count(*) FILTER (WHERE r.status = 'unverified') AS unverified_field_reports_recent
  FROM field_reports r
  WHERE r.zone_id = z.id AND r.reported_at >= now() - INTERVAL '180 days'
) fr ON TRUE;

INSERT INTO schema_meta (key, value) VALUES ('information_layer', 'v1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
"""

DOWNGRADE_SQL = r"""
DROP VIEW IF EXISTS v_zone_context;
DROP TABLE IF EXISTS field_reports;
DROP TABLE IF EXISTS hazard_bulletins;
DROP TABLE IF EXISTS health_surveillance;
DROP TABLE IF EXISTS market_prices;
DROP TABLE IF EXISTS displacement;
DROP TABLE IF EXISTS food_security;
DELETE FROM schema_meta WHERE key = 'information_layer';
"""


def upgrade() -> None:
    op.execute(SCHEMA_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
