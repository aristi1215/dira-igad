-- Dira schema v2 — authoritative DDL (DIRA-SPEC.md §5).
--
-- This file is the single source of truth for the schema. It is applied by:
--   * Alembic (migration 0001, which executes this file), and
--   * docker-compose's /docker-entrypoint-initdb.d mount on first boot.
--
-- Design notes are inline: they explain WHY (referencing the invariant/ADR), not mechanics.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector; embeddings live in the same Postgres (ADR 12).

-- ---------------------------------------------------------------------------
-- Geography: clusters and zones (ADR 8). Zones are the analytic grain.
-- ---------------------------------------------------------------------------
CREATE TABLE clusters (
    id    text PRIMARY KEY,
    name  text NOT NULL,
    geom  geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE zones (
    id         text PRIMARY KEY,
    cluster_id text NOT NULL REFERENCES clusters (id),
    name       text NOT NULL,
    -- ISO-3166 alpha-2. The tri-border cluster spans KE/ET/SO; cross-border adjacency
    -- (invariant: trans-border pairs must exist) depends on this being correct.
    country    char(2) NOT NULL,
    geom       geometry(MultiPolygon, 4326) NOT NULL,
    centroid   geometry(Point, 4326) NOT NULL
);
CREATE INDEX zones_geom_gix ON zones USING gist (geom);
CREATE INDEX zones_cluster_idx ON zones (cluster_id);

-- Precomputed adjacency (bootstrap). Neighbourhood aggregates read this; a zone with no
-- neighbours yields NULL aggregates (no division by zero).
CREATE TABLE zone_adjacency (
    zone_id              text NOT NULL REFERENCES zones (id),
    neighbor_id          text NOT NULL REFERENCES zones (id),
    shares_border        boolean NOT NULL,
    centroid_distance_km double precision NOT NULL,
    cross_border         boolean NOT NULL,
    PRIMARY KEY (zone_id, neighbor_id),
    CHECK (zone_id <> neighbor_id)
);

-- Population/household exposure per zone (WorldPop/OSM at bootstrap). Frozen per cycle into
-- exposure_snapshots so a card always shows the exposure as of the assessment.
CREATE TABLE zone_exposure (
    zone_id    text PRIMARY KEY REFERENCES zones (id),
    population integer NOT NULL,
    households integer NOT NULL,
    source     text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Bitemporal observations (invariant 2, ADR 9).
-- ---------------------------------------------------------------------------
-- One row per (zone, dekad). Each column GROUP carries its own available_at (the moment the
-- value became knowable). Upserts are FIRST-WRITE-WINS per group: once rain_available_at is
-- set it is NEVER overwritten, so training and inference see identical cut values. A group
-- can be filled in a later cycle if it was NULL (e.g. rain present, NDVI arrives later)
-- without touching an already-populated group.
CREATE TABLE zone_climate_dekadal (
    zone_id            text NOT NULL REFERENCES zones (id),
    dekad_start        date NOT NULL,
    rain_mm            double precision,
    rain_anomaly       double precision,
    rain_available_at  timestamptz,
    ndvi               double precision,
    ndvi_anomaly       double precision,
    ndvi_available_at  timestamptz,
    PRIMARY KEY (zone_id, dekad_start),
    -- Dekadal grain (ADR 13): cycles start on day 1, 11 or 21 only.
    CONSTRAINT ck_dekad_start_day CHECK (extract(day FROM dekad_start) IN (1, 11, 21))
);

-- ---------------------------------------------------------------------------
-- Conflict events (ACLED). available_at = publication date (bitemporal cut).
-- ---------------------------------------------------------------------------
-- zone_id NULL is retained (event outside any zone). It never enters zone features. The
-- feature builder never reads `notes`/`actor*` (do-no-harm; no actor-derived features).
CREATE TABLE acled_events (
    event_id       text PRIMARY KEY,
    event_date     date NOT NULL,
    zone_id        text REFERENCES zones (id),
    event_type     text NOT NULL,
    sub_event_type text,
    fatalities     integer NOT NULL DEFAULT 0,
    actor1         text,
    actor2         text,
    notes          text,
    geom           geometry(Point, 4326),
    available_at   timestamptz NOT NULL
);
CREATE INDEX acled_zone_date_idx ON acled_events (zone_id, event_date);
CREATE INDEX acled_available_idx ON acled_events (available_at);

-- ---------------------------------------------------------------------------
-- News (DATA only — never executed as instructions; do-no-harm, invariant 7).
-- ---------------------------------------------------------------------------
CREATE TABLE news_documents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    url          text,
    title        text NOT NULL,
    body         text NOT NULL,
    published_at timestamptz NOT NULL,
    available_at timestamptz NOT NULL,
    embedding    vector(1024)  -- BGE-M3 (ADR 17); NULL until embedded.
);

-- Signals are born 'unconfirmed' and never trigger anything alone (invariant 7).
CREATE TABLE news_signals (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  uuid NOT NULL REFERENCES news_documents (id),
    zone_id      text REFERENCES zones (id),
    signal_type  text NOT NULL,
    status       text NOT NULL DEFAULT 'unconfirmed'
                 CHECK (status IN ('unconfirmed', 'confirmed', 'dismissed')),
    summary      text NOT NULL,
    available_at timestamptz NOT NULL
);
CREATE INDEX news_signals_zone_idx ON news_signals (zone_id);

-- ---------------------------------------------------------------------------
-- Model registry.
-- ---------------------------------------------------------------------------
CREATE TABLE model_versions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         text NOT NULL CHECK (kind IN ('lightgbm', 'transparent_index')),
    path         text,
    feature_list jsonb NOT NULL,
    metrics      jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Situations: the persistent thread of a hazard in a zone (state machine §4.1).
-- ---------------------------------------------------------------------------
CREATE TABLE situations (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id                text NOT NULL REFERENCES zones (id),
    hazard_type            text NOT NULL,
    status                 text NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'monitoring', 'resolved', 'dismissed')),
    opened_at              timestamptz NOT NULL DEFAULT now(),
    resolved_at            timestamptz,
    dismissed_at           timestamptz,
    cycles_below_threshold integer NOT NULL DEFAULT 0
);
-- At most one non-terminal situation per (zone, hazard). A dismissed/resolved situation plus
-- a re-crossing zone yields a NEW situation (partial index permits it).
CREATE UNIQUE INDEX uq_open_situation_per_zone_hazard
    ON situations (zone_id, hazard_type)
    WHERE status IN ('open', 'monitoring');

-- ---------------------------------------------------------------------------
-- Assessments: one per situation per cycle (the storefront row E7 writes).
-- ---------------------------------------------------------------------------
CREATE TABLE assessments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    situation_id      uuid NOT NULL REFERENCES situations (id),
    cycle             date NOT NULL,
    data_cutoff       timestamptz NOT NULL,
    -- Two independent scores (invariant / ADR): model_* from climate+history only.
    prob_conflict     double precision NOT NULL,
    expected_incidents double precision NOT NULL,
    model_risk        double precision NOT NULL,
    model_band        text NOT NULL,
    -- corroboration from confirmed news only; never raises model_risk.
    corroboration     double precision NOT NULL DEFAULT 0,
    operational_band  text NOT NULL,
    combination_rule  text NOT NULL,   -- the exact rule text applied (invariant: visible rule).
    explanation       text NOT NULL,
    shap              jsonb NOT NULL,
    model_version_id  uuid REFERENCES model_versions (id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    -- Idempotency of the pipeline (invariant 3): re-running a cycle cannot duplicate.
    CONSTRAINT uq_assessment_per_cycle UNIQUE (situation_id, cycle)
);

CREATE TABLE exposure_snapshots (
    assessment_id uuid PRIMARY KEY REFERENCES assessments (id) ON DELETE CASCADE,
    population    integer NOT NULL,
    households    integer NOT NULL,
    captured_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Alerts: human-gated (invariant 1, ADR 10).
-- ---------------------------------------------------------------------------
CREATE TABLE alerts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    situation_id uuid NOT NULL REFERENCES situations (id),
    status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'pending_approval', 'approved',
                                   'dispatching', 'dispatched', 'cancelled')),
    draft_text   text NOT NULL,
    language     text NOT NULL DEFAULT 'sw',
    approved_by  text,
    approved_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    -- THE HUMAN GATE. No path to dispatch without a signer. Never disabled, even for tests.
    CONSTRAINT ck_human_gate CHECK (
        status NOT IN ('approved', 'dispatching', 'dispatched')
        OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
    )
);

CREATE TABLE recipients (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id    text NOT NULL REFERENCES zones (id),
    name       text,
    -- E.164 validated at creation (edge case: reject non-E.164 phones).
    phone      text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
    language   text NOT NULL DEFAULT 'sw',
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deliveries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id            uuid NOT NULL REFERENCES alerts (id),
    recipient_id        uuid NOT NULL REFERENCES recipients (id),
    channel             text NOT NULL DEFAULT 'voice',
    status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'sending', 'sent', 'delivered',
                                          'failed', 'needs_review')),
    -- Our system never creates two deliveries for the same (alert, recipient, channel).
    idempotency_key     text NOT NULL UNIQUE,
    -- Deduplicates provider webhooks (invariant 4).
    provider_message_id text UNIQUE,
    attempts            integer NOT NULL DEFAULT 0,
    next_attempt_at     timestamptz,
    claimed_at          timestamptz,   -- set in Tx A; basis for the zombie sweep.
    ack_status          text NOT NULL DEFAULT 'none'
                        CHECK (ack_status IN ('none', 'acknowledged', 'need_help', 'not_affected')),
    ack_method          text,
    last_error          text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_queue_idx ON deliveries (status, next_attempt_at);
CREATE INDEX deliveries_alert_idx ON deliveries (alert_id);

-- ---------------------------------------------------------------------------
-- Map view (ADR 8): one row per visible (open/monitoring) situation.
-- ---------------------------------------------------------------------------
CREATE VIEW v_map_situations AS
SELECT
    s.id                AS situation_id,
    s.zone_id,
    z.name              AS zone_name,
    z.country,
    s.hazard_type,
    s.status            AS situation_status,
    a.id                AS assessment_id,
    a.cycle,
    a.model_risk,
    a.model_band,
    a.corroboration,
    a.operational_band,
    a.explanation,
    es.population       AS exposed_population,
    es.households       AS exposed_households,
    ST_AsGeoJSON(z.geom)::json AS geometry
FROM situations s
JOIN zones z ON z.id = s.zone_id
JOIN LATERAL (
    SELECT * FROM assessments aa
    WHERE aa.situation_id = s.id
    ORDER BY aa.cycle DESC
    LIMIT 1
) a ON true
LEFT JOIN exposure_snapshots es ON es.assessment_id = a.id
WHERE s.status IN ('open', 'monitoring');

-- ---------------------------------------------------------------------------
-- LISTEN/NOTIFY bus (ADR 5). Payloads are minimal (ids + status) — well under the 8000-byte
-- pg_notify limit by design (edge case: payload size test).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_dira_event() RETURNS trigger AS $$
DECLARE
    payload json;
BEGIN
    -- Assessments have no status column; publish the situation + band instead.
    IF TG_ARGV[0] = 'assessment' THEN
        payload := json_build_object('type', 'assessment', 'id', NEW.id::text,
            'situation_id', NEW.situation_id::text, 'band', NEW.operational_band,
            'cycle', NEW.cycle::text);
    ELSE
        payload := json_build_object('type', TG_ARGV[0], 'id', NEW.id::text,
            'status', NEW.status);
        -- Newly queued deliveries also wake the dispatch daemon (ADR 4).
        IF TG_ARGV[0] = 'delivery' AND NEW.status = 'queued' THEN
            PERFORM pg_notify('dira_dispatch', NEW.id::text);
        END IF;
    END IF;
    PERFORM pg_notify('dira_events', payload::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_delivery
    AFTER INSERT OR UPDATE OF status ON deliveries
    FOR EACH ROW EXECUTE FUNCTION notify_dira_event('delivery');

CREATE TRIGGER trg_notify_alert
    AFTER INSERT OR UPDATE OF status ON alerts
    FOR EACH ROW EXECUTE FUNCTION notify_dira_event('alert');

CREATE TRIGGER trg_notify_assessment
    AFTER INSERT ON assessments
    FOR EACH ROW EXECUTE FUNCTION notify_dira_event('assessment');
