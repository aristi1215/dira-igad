# DIRA — Consolidated Specification v2 (IGAD Husika Hackathon 2026)

> **Status of this document.** The implementation prompt referenced an authoritative
> `DIRA-SPEC.md` at the repo root, but no such file existed in the repository (only
> `docs/IMPLEMENTATION.md` and `README.md`). This file was authored during implementation
> to consolidate every constraint stated in the prompt, `docs/IMPLEMENTATION.md`, the ADR
> index and the README into a single authoritative reference. See `DEVIATIONS.md` §1.

Dira is an early-warning and conflict-prediction situation room for the Horn of Africa,
built around the Mandera cluster (the Kenya–Ethiopia–Somalia tri-border). It turns
ICPAC-class environmental data plus conflict history into an explained risk score, freezes
the human impact of that risk, and — only after a human approves — dispatches last-mile
voice alerts with keypad acknowledgement.

Three capabilities:

- **Amani** — conflict-pressure prediction (the hero capability).
- **Tabiri** — impact cards: who/what is exposed in a critical zone.
- **Onya** — last-mile dispatch: voice calls with DTMF acknowledgement.

## 1. Modules & bounded contexts

| Package | Responsibility | May import |
|---------|----------------|------------|
| `dira_core` | Pure domain: situation state machine, risk bands, score-combination rule, alert invariants, ports (Protocols). No I/O. | (stdlib only) |
| `dira_features` | Feature engineering shared by training and inference. | `dira_core`, pandas, numpy |
| `dira_data` | Adapters: ACLED, CHIRPS, NDVI, PostGIS repositories, seeded adapters. | `dira_core` |
| `dira_ml` | LightGBM training, calibration, SHAP, baselines, transparent index. | `dira_core`, `dira_features` |
| `dira_llm` | LLM adapters, prompts, news-signal extraction, embeddings. | `dira_core` |
| `dira_dispatch` | Africa's Talking voice adapter, TTS, mock dispatcher. | `dira_core` |
| `apps/api` | FastAPI: routes, webhooks, SSE. | packages |
| `apps/worker` | Dekadal pipeline (E1–E7) + dispatch daemon. | packages |
| `apps/web` | React + MapLibre frontend. | — |

**Dependency rule (verified by import-linter):** `dira_core` imports no other project
package and no I/O library; `dira_features` imports only `dira_core` + pandas/numpy; apps
import packages, never the reverse.

## 2. Seven invariants (the definition of correctness)

1. **Human gate.** No alert reaches `approved`/`dispatching`/`dispatched` without
   `approved_by` and `approved_at`. A DB `CHECK` enforces it; code never bypasses it. The
   LLM proposes, only a human approves.
2. **Bitemporality.** Every model variable is built only from values whose
   `available_at <= data_cutoff` of the cycle — identical in training and inference via
   `dira_features`. Observation upserts are first-write-wins per column group; an existing
   `available_at` is never overwritten.
3. **Pipeline idempotency.** Running the pipeline twice with the same `--cycle` yields the
   exact same final DB state.
4. **Dispatch idempotency.** `idempotency_key` UNIQUE derived from
   `(alert_id, recipient_id, channel)`; `provider_message_id` UNIQUE deduplicates webhooks.
   Physical double-call prevention depends on the provider; the structural mitigation is
   two transactions + zombies → `needs_review`.
5. **No network calls inside open transactions.** Not the LLM, not telephony, not any
   download. E1–E6 compute; E7 writes the storefront in one SQL-only transaction per zone.
6. **Degrade, don't abort.** LLM failure → the cycle finishes with corroboration 0 and a
   template explanation. A live-source failure → a clear error; in `DATA_MODE=seeded`
   everything reads from disk and nothing external can fail.
7. **Do-no-harm.** No generated alert text names actors, ethnicities, clans or specific
   communities; it speaks of conditions and actions. `news_signals` are born `unconfirmed`
   and never trigger anything on their own.

## 3. Architecture

### 3.1 Two independent scores → one visible rule

- `model_risk` (0–1, calibrated) is built **only** from climate + conflict history. It is
  the output of the ML model. `prob_conflict` and `expected_incidents` are the classifier
  and regressor heads.
- `corroboration` (0–1) is built **only** from confirmed news signals near the zone. News
  can never raise `model_risk`.
- `operational_band` is the combination of `model_band` and `corroboration` via a **pure
  function** that also returns the **text of the applied rule**, persisted in
  `combination_rule`.

### 3.2 Risk bands

`model_risk` maps to a `model_band` by fixed thresholds:
`green < 0.25 <= yellow < 0.5 <= orange < 0.75 <= red`. The operational band may be lifted
one step when corroboration is high, never lowered by news.

### 3.3 Repo layout

See README "Architecture". Exactly `apps/{api,worker,web}`, `packages/dira_*`,
`artifacts/`, `data/seeded/`, `infra/`, `scripts/`, `docs/`.

### 3.4 Dekadal grain

Cycles start on day 1, 11 or 21 of a month (a "dekad"). Any other day is rejected. The
third dekad of a month runs to a variable month-end.

### 3.5 Seven-stage pipeline (`python -m dira_worker.pipeline --cycle YYYY-MM-DD`)

1. **E1 Ingest** — download (seeded = disk) conflict events + hazard rasters; upsert with
   bitemporal `available_at`, first-write-wins.
2. **E2 Zonal stats** — raster → per-zone aggregates; render PNG tiles per layer/cycle.
3. **E3 News → signals** — LLM extracts structured signals (Pydantic-validated; invalid →
   1 retry → discard doc with log). Signals born `unconfirmed`.
4. **E4 Features** — `dira_features` builds the bitemporal feature row (in memory).
5. **E5 Predict** — 3 model outputs + SHAP (in memory).
6. **E6 Combine + explain** — pure combination rule + explanation (template fallback from
   top-3 SHAP), in memory.
7. **E7 Storefront** — one transaction per zone, writes only: open/append/resolve
   situations, full assessment, exposure snapshot.

E1–E6 never touch the storefront tables; E7 contains only SQL. A crash before E7 leaves the
storefront exactly as the previous cycle; a crash mid-E7 leaves every visible zone with a
complete assessment + exposure (atomic per zone).

### 3.6 Dispatch loop

`LISTEN dira_dispatch` + 30s polling. **Tx A** claims a delivery
(`FOR UPDATE SKIP LOCKED`, marks `sending` + `claimed_at`). The provider call happens
**outside** any transaction. **Tx B** records the result with exponential backoff
(1m/5m/25m/2h; `MAX_DISPATCH_ATTEMPTS` → `needs_review`). A zombie sweep moves
`sending` older than `ZOMBIE_TIMEOUT_MINUTES` → `needs_review`. Manual retry re-queues
`needs_review` → `queued`.

### 3.7 Real-time

`GET /events` (SSE): the API holds one dedicated `LISTEN` connection and relays
`dira_events` NOTIFY payloads (minimal — ids + statuses only); heartbeat every 15s; the
client reconnects and refetches on reconnect. Backup polling every 3s if SSE drops.

## 4. State machines

### 4.1 Situation

States: `open`, `monitoring`, `resolved`, `dismissed`. Valid transitions:

- `open → monitoring` (risk fell below high threshold but not yet resolvable)
- `monitoring → open` (risk crossed the high threshold again)
- `open → resolved`, `monitoring → resolved` (N cycles below the low threshold)
- `open → dismissed`, `monitoring → dismissed` (human dismissal)

`resolved` and `dismissed` are terminal. Any other transition raises a domain error.
Hysteresis: open at the high threshold, resolve only after
`RESOLVE_AFTER_CYCLES_BELOW_THRESHOLD` cycles below the low threshold (avoids flapping). A
partial unique index allows at most one non-terminal situation per `(zone_id, hazard_type)`;
a dismissed situation plus a re-crossing zone yields a **new** situation.

### 4.2 Alert

States: `draft`, `pending_approval`, `approved`, `dispatching`, `dispatched`, `cancelled`.
The DB `CHECK` requires `approved_by` + `approved_at` for `approved`/`dispatching`/
`dispatched`.

### 4.3 Delivery

States: `queued`, `sending`, `sent`, `delivered`, `failed`, `needs_review`. Terminal:
`delivered`, `failed`(after exhaustion is represented as `needs_review`). `needs_review` is
the human-recoverable state.

## 5. Database schema (authoritative DDL)

The full DDL lives in `infra/migrations/001_init.sql` and is applied by Alembic
(`alembic upgrade head`) and by docker-compose's init mount. Key elements:

- **Extensions:** `postgis`, `vector`, `pgcrypto`.
- **`clusters`** `(id text pk, name, geom geometry(MultiPolygon,4326))`.
- **`zones`** `(id text pk, cluster_id fk, name, country char(2), geom geometry(MultiPolygon,4326), centroid geometry(Point,4326))`.
- **`zone_adjacency`** `(zone_id, neighbor_id, shares_border bool, centroid_distance_km, cross_border bool, pk(zone_id,neighbor_id))`.
- **`zone_exposure`** `(zone_id pk fk, population int, households int, source, updated_at)`.
- **`zone_climate_dekadal`** — bitemporal, first-write-wins per column group:
  `(zone_id, dekad_start, rain_mm, rain_anomaly, rain_available_at, ndvi, ndvi_anomaly, ndvi_available_at, pk(zone_id,dekad_start))`,
  `CHECK (extract(day from dekad_start) IN (1,11,21))`. Comment documents first-write-wins.
- **`acled_events`** `(event_id text pk, event_date, zone_id fk NULL, event_type, sub_event_type, fatalities int, actor1, actor2, notes, geom point, available_at)`. `zone_id` NULL is retained (out-of-zone events), never enters zone features. Feature builder never reads `notes`.
- **`news_documents`** `(id, url, title, body, published_at, available_at, embedding vector(1024) NULL)`.
- **`news_signals`** `(id, document_id fk, zone_id fk NULL, signal_type, status default 'unconfirmed', summary, available_at)`.
- **`situations`** `(id uuid pk, zone_id fk, hazard_type, status, opened_at, resolved_at, dismissed_at, cycles_below_threshold int default 0)` + partial unique index `uq_open_situation_per_zone_hazard` on `(zone_id, hazard_type) WHERE status IN ('open','monitoring')`.
- **`assessments`** `(id uuid pk, situation_id fk, cycle date, data_cutoff timestamptz, prob_conflict, expected_incidents, model_risk, model_band, corroboration, operational_band, combination_rule text, explanation text, shap jsonb, model_version_id fk, created_at)` + `uq_assessment_per_cycle UNIQUE(situation_id, cycle)`.
- **`exposure_snapshots`** `(assessment_id pk fk, population, households, captured_at)` — frozen exposure.
- **`alerts`** `(id uuid pk, situation_id fk, status, draft_text, language, approved_by, approved_at, created_at, updated_at)` + `CHECK (status NOT IN ('approved','dispatching','dispatched') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))`.
- **`recipients`** `(id uuid pk, zone_id fk, phone text CHECK E.164, language, active bool default true, created_at)`.
- **`deliveries`** `(id uuid pk, alert_id fk, recipient_id fk, channel, status, idempotency_key text UNIQUE, provider_message_id text UNIQUE NULL, attempts int default 0, next_attempt_at timestamptz, claimed_at timestamptz, ack_status, ack_method, last_error, created_at, updated_at)`.
- **`model_versions`** `(id uuid pk, kind, path, feature_list jsonb, metrics jsonb, created_at)`.
- **`v_map_situations`** — view joining latest assessment per open/monitoring situation with zone geometry + exposure for the map.
- **Triggers:** `AFTER INSERT/UPDATE` on `deliveries`, `assessments`, `alerts` `pg_notify('dira_events', json)` with minimal payload (`{type, id, status}`); `deliveries` also notifies `dira_dispatch` on `queued`.

### 5.1 Durable-promise approval transaction

`POST /alerts/{id}/approve` runs one transaction: set `status='approved'`, `approved_by`,
`approved_at`, then insert **all** deliveries (one per active recipient in the zone) with
derived `idempotency_key`. Either all rows commit or none (atomic). Concurrent second
approval fails cleanly (row already approved / unique key).

## 6. Adapters (ports & DATA_MODE)

| Port | Live | Seeded / fallback |
|------|------|-------------------|
| ConflictDataSource | AcledApiAdapter | SeededAcledAdapter |
| HazardDataSource | ChirpsS3 / GeeNdvi | SeededRasterAdapter |
| RiskModel | LightGBMAdapter | TransparentIndexAdapter |
| LanguageModel | AnthropicAdapter | CannedResponseAdapter |
| EmbeddingModel | LocalBgeM3Adapter | PrecomputedEmbeddingsAdapter |
| VoiceChannel | AfricasTalkingAdapter | MockDispatcher |
| SpeechSynthesizer | TtsProviderAdapter | PrerecordedAudioAdapter |

`DATA_MODE=seeded|live` swaps all data adapters together. The demo always runs seeded.

## 7. DTMF acknowledgement mapping

- `1` → `ack_status='acknowledged'`
- `2` → `ack_status='need_help'`
- `3` → `ack_status='not_affected'`
- `9` → replay request: `ack_method='keypad'` recorded, `ack_status` stays `none`.

Unknown session → 200, zero mutations. Duplicate callback → single state change
(deduplicated by `provider_message_id`).

## 8. Baselines (model card must report all three)

- **Persistence** — next-dekad incidents = last observed.
- **Climatology** — long-run seasonal mean per zone/dekad-of-year.
- **CAST aggregate** — conflict-forecast baseline aggregated to the CAST grain.
