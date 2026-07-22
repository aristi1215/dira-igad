# DIRA-SPEC.md — Dira consolidated specification (reconstructed)

> **Status:** Reconstructed for implementation because the original consolidated
> Dira v2 document was missing from the repository at agent start. See
> `DEVIATIONS.md` D-001. Where the long-horizon implementation prompt and the
> scaffold disagree, this document chooses the conservative reading that
> preserves the seven non-negotiable invariants.

**Dira** is a causal situation room for early warning and conflict-pressure
prediction in the Horn of Africa (IGAD Husika Hackathon 2026). Protagonist
cluster: **Mandera** (Kenya–Ethiopia–Somalia tri-border).

| Module | Role |
|--------|------|
| **Amani** | Conflict-pressure prediction (hero) |
| **Tabiri** | Impact cards: frozen exposure + explanation |
| **Onya** | Last-mile Swahili voice calls with keypad ack |

---

## 1. Non-negotiable invariants

1. **Human gate.** No alert reaches `approved` / `dispatching` / `dispatched`
   without `approved_by` and `approved_at`. Enforced by a DB `CHECK`.
2. **Bitemporality.** Features use only observations with
   `available_at <= data_cutoff`. Shared package `dira_features`. Climate
   upserts are **first-write-wins** per column group.
3. **Pipeline idempotency.** Same `--cycle` twice → identical final DB state.
4. **Dispatch idempotency.** `idempotency_key` UNIQUE
   `(alert_id, recipient_id, channel)`; `provider_message_id` UNIQUE for
   webhooks. Physical double-call prevention depends on the provider; mitigation
   is two short transactions + zombies → `needs_review`.
5. **No network inside open DB transactions.**
6. **Degrade, don’t abort.** LLM failure → corroboration 0 + template
   explanation. Seeded mode reads only from disk.
7. **Do-no-harm.** Alert copy never names actors, ethnicities, clans, or
   specific communities. `news_signals` are born `unconfirmed` and never fire
   alone.

---

## 2. Architecture

Modular hexagonal monorepo. Dependency rule (enforced by import-linter):

- `dira_core` → no project packages, no I/O libraries
- `dira_features` → only `dira_core` + pandas/numpy
- apps import packages; never the reverse

### 2.1 Repo layout (§3.3)

```
dira-igad/
├── apps/{api,worker,web}
├── packages/{dira_core,dira_features,dira_data,dira_ml,dira_llm,dira_dispatch}
├── artifacts/
├── data/seeded/
├── infra/          # docker-compose, Dockerfiles, alembic
├── scripts/        # bootstrap.py, train.py
├── docs/adr/
├── DIRA-SPEC.md
├── DEVIATIONS.md
└── Makefile
```

### 2.2 Pipeline (E1–E7)

CLI: `python -m dira_worker.pipeline --cycle YYYY-MM-DD`  
Cycle day must be 1, 11, or 21. Exit ≠ 0 on hard failure; = 0 on degradable
failure (with warning).

| Stage | Work | Persistence |
|-------|------|-------------|
| E1 | Ingest conflict + hazard (seeded=disk / live=network) | observations |
| E2 | Zonal stats + PNG tiles; first-write-wins climate upsert | climate + tiles |
| E3 | News → signals (LLM; degrade on failure) | signals |
| E4 | Features via `dira_features` (bitemporal cut) | in-memory |
| E5 | Predict (3 outputs + SHAP) | in-memory |
| E6 | Combine + explain (written rule; template fallback) | in-memory |
| E7 | Storefront write — **one Tx per zone, SQL only** | situations/assessments |

### 2.3 Dispatch loop (§3.6)

1. `LISTEN` + 30 s poll safety net
2. **Tx A:** claim row (`FOR UPDATE SKIP LOCKED`), mark `sending` + `claimed_at`
3. Provider call **outside** any transaction
4. **Tx B:** record result; exponential backoff 1m/5m/25m/2h;
   `MAX_DISPATCH_ATTEMPTS` → `needs_review`
5. Zombie sweep: `sending` older than `ZOMBIE_TIMEOUT_MINUTES` → `needs_review`
6. Manual retry: `needs_review` → `queued`

Acks enter via **API webhooks**, not the dispatch worker.

---

## 3. Domain

### 3.1 Situations

Statuses: `open`, `resolved`, `dismissed`.

Transitions:

- create → `open`
- `open` → `resolved` | `dismissed`
- terminal states have no further transitions

Hysteresis: open when operational band crosses the high threshold; resolve only
after `RESOLVE_AFTER_CYCLES_BELOW_THRESHOLD` consecutive cycles below the low
threshold. A human-`dismissed` situation does not block a **new** open situation
when the zone re-crosses the threshold (partial unique index only covers
`status = 'open'`).

### 3.2 Alerts

Statuses: `draft`, `pending_approval`, `approved`, `dispatching`, `dispatched`,
`failed`.

Human gate: `approved` / `dispatching` / `dispatched` require signer fields.

`idempotency_key = sha256(f"{alert_id}:{recipient_id}:{channel}")`.

### 3.3 Risk bands & combination

Bands: `low`, `watch`, `elevated`, `high`, `very_high`.

`model_risk` is pure (climate + history). News yields `corroboration ∈ [0,1]`.
Combination is a **written visible rule** (persisted as `combination_rule`),
never learned into the quantitative model.

Default rule v1:

- operational score = `0.7 * model_risk + 0.3 * corroboration`
- map score → band; if corroboration ≥ 0.7 and model band ≥ elevated, bump one
  band (cap `very_high`)

### 3.4 Dekads

Dekad starts are days **1, 11, 21** of each month. February day-21 runs to
month end. Non-dekadal cycle dates are rejected.

---

## 4. ADRs (index)

See `docs/adr/README.md` for #1–21. Summaries are binding for this reconstruction.

---

## 5. SQL schema v2 (authoritative DDL)

The initial Alembic revision applies this DDL verbatim (extensions + tables +
constraints + triggers + view).

```sql
-- Applied by Alembic revision 0001_schema_v2
-- Comments explain WHY (ADR references), not mechanics.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Geography ──────────────────────────────────────────────────────────────

CREATE TABLE clusters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE zones (
  id           TEXT PRIMARY KEY,
  cluster_id   TEXT NOT NULL REFERENCES clusters(id),
  name         TEXT NOT NULL,
  country_iso2 CHAR(2) NOT NULL,
  geom         geometry(MultiPolygon, 4326) NOT NULL,
  centroid     geometry(Point, 4326),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX zones_geom_gix ON zones USING GIST (geom);
CREATE INDEX zones_cluster_idx ON zones (cluster_id);

-- Adjacency precomputed at bootstrap (ADR #8 / Mandera cross-border pairs).
CREATE TABLE zone_adjacency (
  zone_id              TEXT NOT NULL REFERENCES zones(id),
  neighbor_id          TEXT NOT NULL REFERENCES zones(id),
  shared_border_m      DOUBLE PRECISION NOT NULL DEFAULT 0,
  centroid_distance_km DOUBLE PRECISION NOT NULL,
  cross_border         BOOLEAN NOT NULL,
  PRIMARY KEY (zone_id, neighbor_id),
  CHECK (zone_id <> neighbor_id)
);

CREATE TABLE zone_exposure (
  zone_id            TEXT PRIMARY KEY REFERENCES zones(id),
  population         INTEGER NOT NULL CHECK (population >= 0),
  pastoralist_share  DOUBLE PRECISION,
  water_points       INTEGER,
  markets            INTEGER,
  source             TEXT NOT NULL DEFAULT 'seeded',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Bitemporal climate (ADR #9, #13) ───────────────────────────────────────
-- First-write-wins per column group: never overwrite an existing available_at.
-- rain_* and ndvi_* are independent groups so a later cycle can fill NULLs.

CREATE TABLE zone_climate_dekadal (
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

-- ── Observations ───────────────────────────────────────────────────────────

CREATE TABLE acled_events (
  event_id     TEXT PRIMARY KEY,
  event_date   DATE NOT NULL,
  zone_id      TEXT REFERENCES zones(id),  -- NULL if outside all zones; keep row
  event_type   TEXT NOT NULL,
  fatalities   INTEGER NOT NULL DEFAULT 0,
  actor1       TEXT,
  actor2       TEXT,
  notes        TEXT,                       -- never a model feature (ADR honesty)
  geom         geometry(Point, 4326),
  available_at TIMESTAMPTZ NOT NULL,
  source       TEXT NOT NULL DEFAULT 'acled'
);

CREATE INDEX acled_events_zone_date_idx ON acled_events (zone_id, event_date);
CREATE INDEX acled_events_available_idx ON acled_events (available_at);

CREATE TABLE news_documents (
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

-- Signals are born unconfirmed and never fire alerts alone (invariant 7).
CREATE TABLE news_signals (
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

CREATE INDEX news_signals_zone_cycle_idx ON news_signals (zone_id, cycle);

-- ── Models ─────────────────────────────────────────────────────────────────

CREATE TABLE model_versions (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('lightgbm', 'transparent_index')),
  artifact_path TEXT,
  feature_list  JSONB NOT NULL,
  metrics       JSONB NOT NULL DEFAULT '{}',
  model_card    JSONB NOT NULL DEFAULT '{}',
  trained_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active     BOOLEAN NOT NULL DEFAULT FALSE
);

-- ── Storefront ─────────────────────────────────────────────────────────────

CREATE TABLE situations (
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

-- One open situation per (zone, hazard) — ADR storefront invariant.
CREATE UNIQUE INDEX situations_one_open_per_zone_hazard
  ON situations (zone_id, hazard)
  WHERE status = 'open';

CREATE TABLE assessments (
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

-- Dedup storefront writes even when situation_id is stable across reruns.
CREATE UNIQUE INDEX uq_assessment_zone_cycle ON assessments (zone_id, cycle);

CREATE TABLE alerts (
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
  -- Human gate (ADR #10): cannot reach dispatch states without a signer.
  CONSTRAINT alerts_human_gate_chk CHECK (
    status NOT IN ('approved', 'dispatching', 'dispatched')
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE TABLE recipients (
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

CREATE TABLE deliveries (
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

CREATE INDEX deliveries_queue_idx
  ON deliveries (status, next_attempt_at)
  WHERE status IN ('queued', 'sending');

-- ── LISTEN/NOTIFY bus (ADR #5) — minimal payloads (ids + states only) ─────

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
  -- Keep under pg_notify 8000-byte limit by design (ADR #5).
  PERFORM pg_notify('dira_events', payload::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deliveries_notify
  AFTER INSERT OR UPDATE OF status, ack_status ON deliveries
  FOR EACH ROW EXECUTE FUNCTION dira_notify_event();

CREATE TRIGGER situations_notify
  AFTER INSERT OR UPDATE OF status ON situations
  FOR EACH ROW EXECUTE FUNCTION dira_notify_event();

CREATE TRIGGER alerts_notify
  AFTER INSERT OR UPDATE OF status ON alerts
  FOR EACH ROW EXECUTE FUNCTION dira_notify_event();

-- Map storefront view (API returns this as GeoJSON FeatureCollection).
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
```

### 5.1 Approve transaction (durable promise)

`POST /alerts/{id}/approve` in **one** transaction:

1. Verify alert is `pending_approval`
2. Set `status=approved`, `approved_by`, `approved_at`
3. Insert **all** deliveries for active recipients of the situation’s zone
   (idempotency keys derived deterministically)
4. Commit — or roll back entirely on any failure

---

## 6. Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | — | required |
| `DATA_MODE` | `seeded` | `live\|seeded` |
| `ANTHROPIC_API_KEY` | | optional in seeded |
| `AT_USERNAME` / `AT_API_KEY` | | Africa's Talking |
| `PUBLIC_BASE_URL` | | webhooks/audio |
| `TTS_PROVIDER` | | |
| `ZOMBIE_TIMEOUT_MINUTES` | `10` | |
| `MAX_DISPATCH_ATTEMPTS` | `5` | |
| `RESOLVE_AFTER_CYCLES_BELOW_THRESHOLD` | `3` | |
| `DISPATCH_POLL_SECONDS` | `30` | |

---

## 7. Demo script (seeded)

1. Zone paints red (`operational_band` high)
2. Tabiri card → explanation + SHAP
3. Advisor prepares alert → `pending_approval`
4. Human approves → deliveries queued
5. `MockDispatcher` “calls” → simulated ack
6. Map turns green via SSE patch
