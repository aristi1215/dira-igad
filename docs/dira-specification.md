# DIRA — Consolidated Specification v2

**The project's authoritative document.** Consolidates the definition of the idea, technical architecture, and worker definition, incorporating corrections from the July 2026 technical review. In any conflict between this document and another project artifact, **this document wins**.

IGAD Husika Hackathon 2026 · "Smarter Early Warning, Stronger Communities"
One developer · ~3 weeks · Python + React

---

## PART 1 — THE IDEA

### 1.1 What it is

Dira ("compass" in Swahili) is a **causal situation room for the Horn of Africa**: a live map that shows in one place two things that are really one chain — environmental hazards (rainfall deficit, vegetation collapse, heat, flooding) and **the conflict those hazards are about to unleash**.

Three modules with their own names:

- **Amani** — the conflict pressure prediction engine (the flagship functionality).
- **Tabiri** — impact cards: who and what is at risk in each critical zone.
- **Onya** — last-mile dispatch: automated voice calls in local language, with keypad acknowledgment.

The one-line pitch: *Dira turns the forecasts that ICPAC already produces into actionable phone calls that reach those who need them, and anticipates climate conflict before it happens — always showing why.*

### 1.2 The real gap

1. **The last mile.** ICPAC already produces world-class forecasts. The documented bottleneck is that alerts don't arrive, aren't understood, or aren't trusted (the Kenya flooding deaths in March 2026 occurred *after* a correct warning).
2. **The CEWARN manual PDF.** The *Climate-Induced Conflict Monthly Alert* is currently produced by hand, with a month's delay. Dira automates it, shifts it from monthly to per-data-cycle, and adds explainability and dispatch.

### 1.3 The conceptual differentiator: the causal chain

> Uneven rainfall → vegetation stress with ~1 month lag → resource pressure → conflict risk **where livestock arrives, not where rain failed**.

The map's environmental layers are the **visible input side of the model** — not a separate product. Zone adjacency (including cross-border) is a *model input*, because spatial displacement is the mechanism of pastoral conflict.

### 1.4 The demo moment (5 minutes)

The operator sees a Mandera zone turn red. The AI advisor explains: rainfall 80% below normal, vegetation collapsed three weeks ago, two unconfirmed water tension signals. Forecast: conflict in 3–4 weeks. The advisor has the alert drafted and translated. **The human approves.** A phone rings with a voice in Swahili. The receiver presses 1. The zone shifts from yellow "sent" to green "acknowledged" in seconds.

### 1.5 Protagonist cluster

**Mandera** (tri-border Kenya–Ethiopia–Somalia). Zero-rain drought visually stark, cleanest causal chain to tell, and catalogued by the CEWARN PDF itself as "very high risk" with livestock migration toward Mandera West and Dolo Bay.

### 1.6 Safety red lines (built, not promised)

1. **Mandatory human gate** before any dispatch — enforced by a database `CHECK`, not code convention.
2. **News signals never trigger an alert alone** — born `unconfirmed` in the schema; a human validates.
3. **Do-no-harm alert content** (new, aligned with CEWARN protocol): the alert drafting prompt explicitly prohibits naming actors, ethnicities, or specific communities. Alerts describe *conditions* (resource pressure, livestock movement, water scarcity) and *actions* (convene peace committee, check wells), never groups. A poorly drafted alert can contribute to the escalation it aims to prevent.
4. **Two separate scores**: model risk (pure, climate + history only) is never contaminated by press coverage; news corroboration is combined via a **written, visible rule**, not learned. If judges ask "does your model depend on the press?": no, and it's deliberate — press is biased and would blind us where coverage is thinnest, which is where people are most vulnerable.

---

## PART 2 — FUNCTIONAL SPECIFICATION

### 2.1 The live map
Two levels: regional view (all the Horn, environmental layers, problem scale) and zoom to protagonist cluster (Mandera), where the complete cycle lives.

### 2.2 Layers
1. Rainfall (deficit vs. climatology) · 2. Drought (accumulated deficit) · 3. Vegetation health (the lag link) · 4. Extreme heat · 5. Flooding **consumed ready-made** from GloFAS/NASA (displayed with card, never modeled by us). Layers 1–4 are "free": the model already calculates them as input.

### 2.3 Tabiri Cards
On any critical zone: `4,000 people · 1 clinic · 2 schools · 3 wells under tension · Forecast: probable conflict in 3–4 weeks · [See why] [Prepare alert]`. The card is built once and works over any hazard. Only critical zones generate cards; the rest is background color.

### 2.4 Amani — the three outputs
Per zone, at a 3-dekad horizon (~30 days, the lag the CEWARN model itself implies):
1. **Conflict probability** (classifier)
2. **Expected incidents** (regressor)
3. **Risk score/band** (calibrated composite → low/watch/elevated/high/very_high)

Each forecast comes with its **explanation**: SHAP decomposition translated to prose. Powerful *and* transparent AI.

### 2.5 News signals
The LLM reads news from the corpus (seeded with real articles from the zones; authorized sources only) and extracts structured signals with confidence and source citation. They raise the zone's **corroboration**; they never trigger anything alone.

### 2.6 Onya
Hero channel: **voice call** (reaches those who cannot read; it's what no other team will do). Backups: SMS, WhatsApp as capability. Full end-to-end language: **Swahili**; the rest is a parameter. Recipients: peace committees and DRM officials, as CEWARN recommends. Keypad acknowledgment: 1 = received and will act · 2 = conflict already occurred (confirmed positive) · 3 = resolved (confirmed negative). These acknowledgments are the **seed of Dira v2's labeled dataset**: "Dira v1 trains on existing data; Dira v2 trains on what Dira v1 generated".

### 2.7 The advisor
Lateral panel with full map context (RAG over our sources: map state, cards, news, CEWARN methodology). Prioritizes zones, drafts the brief in exact CEWARN format (Mean RFE / Max RFE / incident count / risk categorization), prepares translated alert. **The only thing it doesn't do: press "send".**

---

## PART 3 — ARCHITECTURE

### 3.1 The system's true form

| Workload | Nature | Latency | Fails if… |
|---|---|---|---|
| Ingestion (CHIRPS, MODIS, ACLED) | Heavy batch IO/CPU | Minutes | Provider goes down |
| ML training | Offline, manual | Minutes | — (outside live system) |
| ML inference | Batch per cycle | Seconds | — |
| LLM orchestration | On-demand + batch | Seconds, streaming | External API goes down |
| Map read API | Request/response | Milliseconds | Must never fail |
| Dispatch (Onya) | Irreversible external effects | Seconds | ⚠️ Double-call or drop an alert |
| Real-time push | Server → client | < 2 s | Acknowledgment doesn't paint map |

Consequences: (1) raster processing NEVER goes in the request — it's precalculated; (2) dispatch needs durability and idempotence; (3) **all external dependencies are volatile** and any can go down on demo day — this drives the architecture.

### 3.2 Modular monolith, hexagonal

Neither microservices (distributed tax with no benefit for one dev) nor serverless (fragilizes the demo). **Ports and adapters as demo insurance**: the domain is stable and testable; all edges are volatile third parties. One port per external dependency:

```python
# packages/dira_core/ports.py — the domain defines the interface. Knows no one.
class ConflictDataSource(Protocol):
    def events(self, zone_ids: list[str], since: date) -> list[ConflictEvent]: ...
class HazardDataSource(Protocol): ...
class RiskModel(Protocol):
    def assess(self, features: FeatureRow) -> Assessment: ...
class LanguageModel(Protocol): ...
class EmbeddingModel(Protocol): ...
class VoiceChannel(Protocol):
    def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef: ...
class SpeechSynthesizer(Protocol):
    def synthesize(self, text: str, language: str) -> AudioRef: ...
```

| Port | Live adapter | Seeded/fallback adapter |
|---|---|---|
| ConflictDataSource | AcledApiAdapter | SeededAcledAdapter |
| HazardDataSource | ChirpsS3Adapter / GeeNdviAdapter | SeededRasterAdapter |
| RiskModel | LightGBMAdapter | **TransparentIndexAdapter** (weighted index producing same 3 outputs) |
| LanguageModel | AnthropicAdapter | CannedResponseAdapter |
| EmbeddingModel | LocalBgeM3Adapter | PrecomputedEmbeddingsAdapter |
| VoiceChannel | AfricasTalkingAdapter | MockDispatcher |
| SpeechSynthesizer | TtsProviderAdapter | PrerecordedAudioAdapter |

`DATA_MODE = live | seeded` switches all data adapters at once. **The demo always runs in seeded.** Live mode is demonstrated separately. This is the project's most important resilience decision. Domain tests run without network, without BD, without keys.

### 3.3 Module map (monorepo)

```
dira/
├── apps/
│   ├── api/            FastAPI: routes, webhooks, SSE. Thin.
│   ├── worker/         Pipeline per cycle + dispatcher.
│   └── web/            React + TypeScript + MapLibre
├── packages/
│   ├── dira_core/      PURE DOMAIN. No I/O, no network, no DB.
│   │   ├── situations/ lifecycle, state machine, human gate
│   │   ├── risk/       bands, two-score combination rule
│   │   ├── alerts/     approval and idempotence invariants
│   │   └── ports.py
│   ├── dira_features/  ⚠️ SHARED VARIABLE ENGINEERING between
│   │                   training and inference. If it bifurcates → skew.
│   │                   THE reason for monorepo.
│   ├── dira_data/      Adapters: ACLED, CHIRPS, MODIS, PostGIS repos
│   ├── dira_ml/        Training, evaluation, SHAP → artifacts
│   ├── dira_llm/       LLM adapters, RAG (pgvector), prompts, extraction
│   └── dira_dispatch/  Africa's Talking, retries, webhooks, TTS
├── artifacts/          model_v1.lgb + model_card.json
├── data/seeded/        Real Mandera fixtures — demo insurance
└── infra/              docker-compose, migrations
```

Dependency rule: everything points inward; `dira_core` imports nothing. Monorepo because `dira_features` must be importable by training and inference (two repos = guaranteed drift = ML's bug #1), and because judges review one repo.

### 3.4 Process inventory

| # | What | When | Worker? |
|---|---|---|---|
| 1 | **Bootstrap** | Once (zones, adjacency, base exposure) | No — manual script |
| 2 | **Training** | Manual, when data/variables change | No — outside live system; produces artifact + `model_versions` row |
| 3 | **Pipeline worker** | Each data cycle (dekadal, ~10 days) — cron | Yes |
| 4 | **Dispatch worker** | Daemon, always on | Yes |
| 5 | **API** | Request/response + webhooks + SSE | No |

Separation criterion: *distinct trigger, latency, failure mode, or scaling need — not "conceptually different" work*. The dispatcher is the only component with **irreversible** effects in the real world; it deserves its own process, guarantees, and vigilance.

### 3.5 Worker 1 — Pipeline: SEVEN stages (ORDER CORRECTED)

> **Structural correction from prior version (8 stages in order 1–8).** The old order had two flaws: (a) `operational_band NOT NULL` was unsatisfiable because the situations stage inserted the assessment *before* the combination completed it; (b) atomizing the display required wrapping an LLM call in an open transaction. Solution: **news reading moves earlier, all computation happens in memory, and the display is written at the end in a per-zone transaction containing only BD writes.** Absolute rule: **no external network calls inside an open transaction.**

Command: `python -m dira.worker.pipeline --cycle 2026-03-11` (cycle is a dekad). Cron fires it, never a user. Runs → terminates; exit code matters.

**E1 — Download** (only stage depending on third parties; in seeded reads from disk)
- Reads: CHIRPS bucket, NDVI service, ACLED API (paginating 5,000), news corpus.
- Writes: rasters to disk · `acled_events` · `news_documents`. Records `available_at` = actual reception time.
- Idempotence: ACLED native ID as PK → upsert; rasters named by dekad → no re-downloads.

**E2 — Zonal statistics + tiles**
- Clips each raster against zone polygons; calculates mean and anomaly. With the same raster in memory, renders PNG tiles for the visual layer.
- Writes: `zone_climate_dekadal` · tile files.
- Idempotence: upsert with **bitemporal preservation** (see §5.3): values and their `available_at` only written if NULL. First write wins; CHIRPS revisions explicitly out of scope in v1.
- It's the worker's raison d'être: hundreds of millions of pixels in, ~30,000 rows out. The slowest stage.

**E3 — Read the news** (LLM, degradable)
- Reads unprocessed `news_documents`; extracts structured signals (type, zone, summary, confidence, citation) and calculates embeddings.
- Writes: `news_signals` (all born `unconfirmed`) · `news_documents.embedding` · processing mark.
- **If LLM fails: degrade, don't abort.** Pipeline continues and this cycle's corroboration is 0.

**E4 — Build variables** (pure, no writes)
- Constructs the row per zone using the **shared `dira_features` package**, applying bitemporal cut: only values with `available_at <= cycle_date`. Missing values stay NULL (LightGBM handles this natively). Calculates lags, neighborhood aggregates (`zone_adjacency`), and relative advantage.

**E5 — Predict** (pure, no writes)
- Loads active model per `model_versions`; produces 3 outputs + SHAP breakdown per zone. The port allows switching to transparent index without touching anything else.

**E6 — Combine and explain** (in memory; LLM with template fallback)
- Calculates corroboration from zone's `news_signals`; applies the **written rule** → operational band. Generates prose explanation from SHAP via LLM; **if LLM fails, a deterministic template from top-feature SHAP produces readable explanation.** Nothing written yet.
- (CEWARN brief and alert text are NOT generated here: they're on-demand when the operator requests them, because they'll want to iterate.)

**E7 — Write the display** (one transaction per zone, WRITES ONLY)
- For each zone above threshold: if open situation exists, add assessment; if not, create situation. Zones N cycles below threshold → `resolved`. In the SAME transaction: the assessment **complete** (with corroboration, operational band, rule, and explanation — `NOT NULL` satisfied by construction) and exposure snapshot copied from `zone_exposure` with source frozen.
- Idempotence: `UNIQUE (situation_id, model_version_id, data_cutoff)` → re-running same cycle updates, doesn't duplicate.

**Property that falls out free from factory/display separation:** E1–E6 only touch factory tables (which frontend never reads) or memory. If pipeline dies anywhere before E7, **the map keeps showing the prior cycle complete and coherent**. And within E7, the per-zone transaction guarantees the map never sees a situation with assessment but no card.

**Mandatory test:** running pipeline twice with same `--cycle` must produce exactly the same final database state (see agent prompt test catalog).

### 3.6 Worker 2 — The dispatcher (CORRECTED PATTERN)

Daemon: `python -m dira.worker.dispatch`. Awakened by `LISTEN` on DB channel; polls every 30 s as safety net (NOTIFY is fire-and-forget: if worker was restarting, it's lost; notification for zero latency, polling for guarantee).

> **Critical correction: old loop had a zombie state.** If the worker died between marking `sending` and registering result, the row stuck in `sending` forever (queue only picks up `queued`/`failed`). Also, keeping `FOR UPDATE` open during HTTP call to provider held locks during external latency.

**The correct loop — two short transactions, external call outside both:**

```
Tx A (short):  SELECT ... WHERE dispatch_status IN ('queued','failed')
                 AND next_attempt_at <= now()
               ORDER BY next_attempt_at
               FOR UPDATE SKIP LOCKED LIMIT 10;
               UPDATE → dispatch_status='sending', claimed_at=now(); COMMIT.

(no transaction): HTTP call to Africa's Talking with idempotency_key.

Tx B (short):  success → 'sent' + provider_message_id
               error  → 'failed', attempts+1, next_attempt_at with
                        exponential backoff (e.g. 1m, 5m, 25m; max 5 tries →
                        'needs_review'); COMMIT.
```

**Zombie recovery (policy decided):** periodic scan finds `sending` with `claimed_at` older than 10 minutes and moves to **`needs_review`**, NOT auto-retry. Reason: the HTTP call may have gone out before crash; as far as we know, Africa's Talking doesn't deduplicate by idempotency key, so auto-retry risks **double-calling a peace committee** — worse than a few minutes delay with a visible flag. `needs_review` rows appear in dispatch panel with a "retry" button returning them to `queued` after human review. (Decision reversible; recorded in ADR #16.)

**Honest idempotence scope:** `idempotency_key UNIQUE` guarantees our system never creates two deliveries for same (alert, recipient, channel), and `provider_message_id UNIQUE` dedups repeated provider webhooks. Protection against *physical* double-call depends on provider; our structural mitigation is two-transactions + zombie-to-review. This is documented honestly in README — precise guarantee beats inflated promise.

**Acknowledgment does NOT enter via dispatcher.** Two separate directions:

```
OUTBOUND  dispatcher → provider → peace committee phone
INBOUND   committee presses 1 → provider → webhook → THE API → database
```

**Webhook validation (security correction):** acknowledgment endpoint is public and mutates state that paints the map. Africa's Talking doesn't sign webhooks robustly. Rule: **only accept acknowledgment whose provider session ID matches an existing `provider_message_id`**; any other is logged and discarded with 200 (don't give info to attacker). DTMF other than 1/2/3 get recorded as `ack_method` but leave `ack_status='none'`.

### 3.7 Postgres as queue, bus, and vector store — why no broker or Redis

1. Zero new infrastructure. 2. **No double-write**: creating the alert and enqueuing its deliveries is one atomic transaction (durable promise pattern: API registers intention; worker fulfills it). 3. **Queue IS the read model**: map shows `queued → sending → sent → delivered → acked` reading the same row the worker processes — eliminates entire class of sync bugs. 4. At demo scale, Postgres is plenty; the breakpoint (thousands msg/s) is documented in the repo to show the decision was deliberate.

Realtime: `pg_notify` inside the same transaction that persists the fact → API listens (`LISTEN`) → SSE → client patches TanStack Query cache → map re-renders. **SSE, not WebSocket** (server→client only; half the code; native reconnect). Safety net: polling every 3 s if SSE dies. pgvector in same Postgres: one datastore.

### 3.8 Frontend

Almost all state is **server state**. Split: TanStack Query (situations, cards, deliveries — server is sole truth), tiny Zustand (active layers, selection, viewport), useState (forms). SSE event does one thing: `queryClient.setQueryData(['situations'], patchDelivery(evt))` — single path from acknowledgment to map, no parallel store.

Map: MapLibre GL JS. Zones as direct GeoJSON (~50–200 polygons; tile server would be overengineering), rasters as **pre-rendered PNG tiles per cycle** (zero raster compute in request), pressure points as GeoJSON points, flooding as consumed GeoJSON. Layers **declarative** from state via `useMapLayers` hook; canvas is dumb renderer — never scattered imperative manipulation.

Structure by features (`features/map`, `features/situations`, `features/advisor`, `features/dispatch`), not by types.

### 3.9 Deployment

Deliberately boring: one small server with FastAPI (uvicorn) + both workers (same code) + static React build + PostgreSQL 16 with PostGIS and pgvector + static tiles. docker-compose for identical dev and production. Webhooks: tunnel in dev, deployed server in demo. **Video always recorded against `DATA_MODE=seeded`.** Live call is bonus, not dependency. All timestamps UTC; UI converts to EAT (UTC+3).

---

## PART 4 — AI LAYER

### 4.1 Engine division

| Task | Engine | Why |
|---|---|---|
| 3 numeric outputs | LightGBM + SHAP | Cheap (trains in minutes on laptop), tabular domain standard, explainable, defensible |
| Numeric fallback | Transparent weighted index | Same 3 outputs; another `model_versions` row and an UPDATE |
| Comparison baselines | Naive persistence + ACLED CAST | See §4.3 — methodological credibility |
| News → signals | Claude (Opus) + RAG | NLU on unstructured text, with mandatory source citation |
| Draft + translate alerts | Claude (Opus) | Multilingual NLG with do-no-harm constraint in prompt |
| Advisor + CEWARN briefs | Claude (Opus) + RAG | Reasoning anchored to our sources; everything it claims cites |
| Prose explanation | Claude (Opus), template fallback | Natural language from SHAP |

### 4.2 The quantitative model

- **Spatiotemporal grain:** (zone, dekad). Zone = finest admin unit ACLED codes reliably AND that has addressable local authority (KE sub-county, ET woreda, SO district).
- **Variables** (built by `dira_features`, identical train/inference): current and lagged rainfall stats, lagged NDVI (~1 month, CEWARN's lag), anomalies vs. climatology, recent ACLED incident counts and trends, **neighborhood aggregates** via `zone_adjacency` (deficit in neighbors = incoming pressure), seasonality. ACLED `notes` field is free text that DESCRIBES the label → **never enters as variable** (leakage); feeds RAG corpus only.
- **Labels:** binary (conflict event in zone in next 3 dekads?) + count. Training window: 2012-01-01 → 2026-01-01.
- **Bitemporal cut in training:** each training row for cycle T built only with values whose `available_at <= T`. Real latency simulation is a CASE WHEN; resulting NULLs LightGBM handles natively. Makes training/serving skew **structurally impossible**.
- **Validation:** strict temporal split (train early, test recent; never random). Metrics: AUC, PR-AUC, **Brier/calibration** (probabilities shown to operator must be calibrated — isotonic or Platt on validation fold), count error.

### 4.3 Three baselines (methodological correction)

1. **Naive persistence** ("conflict where it recently happened"). In conflict prediction literature notoriously hard to beat, and history variables will dominate SHAP. Reporting honestly is more impressive than AUC without context. If climate adds little marginal AUC, narrative survives: climate channel's value is **anticipation** (arrives weeks before incidents) and **causal explanation** — say it explicitly.
2. **ACLED CAST** — but direct comparison is apples/oranges: CAST predicts monthly counts at country/admin-1; we predict dekadal probability at admin-2. **To compare, aggregate our predictions to CAST grain** (sum expected incidents to monthly, to CAST admin level). Do it right or don't: evaluators will attack this slide.
3. **Simple climatology** (historic rate by zone and season) as floor.

### 4.4 The language layer

RAG over pgvector with our sources: news corpus, CEWARN methodology PDF, current map state, exposure cards. LLM never invents: cites. Signal extraction returns Pydantic-validated JSON; invalid JSON → one retry → discard document with log, never abort pipeline.

**Alert prompt — mandatory do-no-harm constraint:** never name actors, ethnicities, clans, or specific communities; speak of conditions and actions. Verified by test (see agent prompt).

**Embeddings (decision):** **local** multilingual model (BGE-M3, 1024 dims — matches `vector(1024)`), because corpus includes Swahili/Somali/Amharic and local model removes external dependency on demo day. `EmbeddingModel` adapter allows swap. (ADR #17.)

### 4.5 TTS in Swahili (decision)

Demo's hero moment depends on Swahili voice and Africa's Talking's native `<Say>` doesn't cover it with quality. Strategy: **pre-generated audio** — `SpeechSynthesizer` port produces file served at public URL and Africa's Talking plays with `<Play>`. Week 1: verify TTS providers with Swahili (Google Cloud TTS, ElevenLabs, etc.) and choose by quality. **Guaranteed fallback:** audio recorded by native speaker for seeded demo messages — legitimate, robust, sounds better than mediocre TTS. (ADR #18.)

---

## PART 5 — DATABASE SCHEMA (v2, corrected)

Three structural decisions the schema ENFORCES: (1) bitemporality → temporal leakage impossible; (2) human gate → CHECK; (3) idempotence → UNIQUEs. Changes v2 vs v1: dekadal grain, bitemporal preservation in upserts, `uq_assessment_per_cycle`, `needs_review` + `claimed_at` in dispatch, `updated_at` trigger.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ 1. GEOGRAPHIC REFERENCE (bootstrap, once) ============

CREATE TABLE clusters (
  id         TEXT PRIMARY KEY,             -- 'mandera' | 'ateker' | 'abyei_aweil'
  name       TEXT NOT NULL,
  countries  CHAR(2)[] NOT NULL,
  geom       geometry(MultiPolygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clusters_geom ON clusters USING GIST (geom);

-- Alert unit: finest admin that (a) ACLED codes reliably and
-- (b) has addressable local authority. Boundaries: OCHA COD-AB (HDX).
CREATE TABLE zones (
  id          TEXT PRIMARY KEY,            -- 'KE-MDR-WEST'
  cluster_id  TEXT NOT NULL REFERENCES clusters(id),
  name        TEXT NOT NULL,
  country     CHAR(2) NOT NULL,
  admin_level SMALLINT NOT NULL,
  pcode       TEXT,
  geom        geometry(MultiPolygon, 4326) NOT NULL,
  centroid    geometry(Point, 4326) NOT NULL,
  area_km2    NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_zones_geom ON zones USING GIST (geom);
CREATE INDEX idx_zones_cluster ON zones (cluster_id);

-- Pre-calculated adjacency: ENABLES THE MODEL ("conflict occurs where
-- livestock ARRIVES"). Crosses national borders on purpose.
CREATE TABLE zone_adjacency (
  zone_id          TEXT NOT NULL REFERENCES zones(id),
  neighbor_id      TEXT NOT NULL REFERENCES zones(id),
  shares_border    BOOLEAN NOT NULL,
  centroid_dist_km NUMERIC(8,2) NOT NULL,
  cross_border     BOOLEAN NOT NULL,
  PRIMARY KEY (zone_id, neighbor_id),
  CHECK (zone_id <> neighbor_id)
);
CREATE INDEX idx_adjacency_neighbor ON zone_adjacency (neighbor_id);

-- ============ 2. BASE EXPOSURE (bootstrap) ============

CREATE TYPE asset_type AS ENUM
  ('population','clinic','school','water_point','road_km','livestock_corridor');

CREATE TABLE zone_exposure (
  zone_id    TEXT NOT NULL REFERENCES zones(id),
  asset      asset_type NOT NULL,
  value      NUMERIC(14,2) NOT NULL,
  source     TEXT NOT NULL,                -- 'worldpop_2024' | 'osm_2026-07-01'
  as_of_date DATE NOT NULL,
  PRIMARY KEY (zone_id, asset, as_of_date)
);

-- ============ 3. OBSERVATIONS — BITEMPORAL, DEKADAL GRAIN ============
--
-- GOLDEN RULE: two times per observation.
--   dekad_start     → the period the data DESCRIBES (days 1, 11, or 21 of month)
--   *_available_at  → when the data WAS AVAILABLE to us
--
-- For cycle T only values with available_at <= T are used.
--
-- ⚠️ UPSERT SEMANTICS (v2 correction): pipeline idempotence implemented
-- as "first write wins" PER COLUMN GROUP. Naive upsert overwriting values
-- AND available_at on re-runs REWRITES HISTORY and breaks bitemporal guarantee.
-- Pattern:
--
--   INSERT ... ON CONFLICT (zone_id, dekad_start) DO UPDATE SET
--     rain_mm           = COALESCE(zone_climate_dekadal.rain_mm, EXCLUDED.rain_mm),
--     rain_available_at = COALESCE(zone_climate_dekadal.rain_available_at,
--                                  EXCLUDED.rain_available_at),
--     ... (identical per ndvi_* group)
--
-- So re-running same cycle is no-op on existing data, and later cycle can
-- FILL columns that arrived late (NDVI) without touching what's recorded.
-- CHIRPS retroactive revisions out of scope in v1 (documented).

CREATE TABLE zone_climate_dekadal (
  zone_id           TEXT NOT NULL REFERENCES zones(id),
  dekad_start       DATE NOT NULL,
  CHECK (EXTRACT(DAY FROM dekad_start) IN (1, 11, 21)),
  rain_mm           NUMERIC(8,2),
  rain_anomaly_pct  NUMERIC(7,2),
  dry_days          SMALLINT,
  rain_source       TEXT,                  -- 'chirps_v3'
  rain_available_at TIMESTAMPTZ,
  ndvi_mean         NUMERIC(6,4),
  ndvi_anomaly_pct  NUMERIC(7,2),
  ndvi_source       TEXT,                  -- 'MOD13Q1_061'
  ndvi_available_at TIMESTAMPTZ,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (zone_id, dekad_start)
);
CREATE INDEX idx_climate_dekad ON zone_climate_dekadal (dekad_start);

CREATE TABLE acled_events (
  acled_id       BIGINT PRIMARY KEY,       -- native ID = free idempotence
  event_date     DATE NOT NULL,
  zone_id        TEXT REFERENCES zones(id),
  geom           geometry(Point, 4326) NOT NULL,
  event_type     TEXT NOT NULL,
  sub_event_type TEXT,
  actor1         TEXT,
  actor2         TEXT,
  fatalities     SMALLINT NOT NULL DEFAULT 0,
  -- ⚠️ FREE TEXT. RAG corpus only. NEVER model variable:
  -- note DESCRIBES label → leakage.
  notes          TEXT,
  source         TEXT,
  available_at   TIMESTAMPTZ NOT NULL,     -- ACLED publication
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_acled_zone_date  ON acled_events (zone_id, event_date);
CREATE INDEX idx_acled_geom       ON acled_events USING GIST (geom);
CREATE INDEX idx_acled_available  ON acled_events (available_at);

-- ============ 4. MODEL REGISTRY ============

CREATE TABLE model_versions (
  id              TEXT PRIMARY KEY,        -- 'lgbm_v1_2026-07-20'
  kind            TEXT NOT NULL,           -- 'lightgbm' | 'transparent_index'
  artifact_path   TEXT NOT NULL,
  feature_list    JSONB NOT NULL,          -- explicit variable contract
  training_window daterange NOT NULL,
  metrics         JSONB NOT NULL,          -- auc, pr_auc, brier,
                                           -- vs_persistence, vs_cast, vs_climatology
  trained_at      TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX idx_one_active_model ON model_versions (is_active) WHERE is_active;

-- ============ 5. SITUATIONS ============

CREATE TYPE hazard_type AS ENUM
  ('conflict_pressure','rain_deficit','vegetation_stress','heat_stress','flood');

CREATE TYPE situation_status AS ENUM
  ('detected','assessed','proposed','approved','dispatching','dispatched',
   'acknowledged','resolved','dismissed');

-- Situation is DURABLE THREAD, not per-cycle snapshot.
CREATE TABLE situations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id       TEXT NOT NULL REFERENCES zones(id),
  hazard        hazard_type NOT NULL,
  status        situation_status NOT NULL DEFAULT 'detected',
  override_geom geometry(MultiPolygon, 4326),  -- ONLY hazards with own footprint
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  -- Conflict ALWAYS uses zone_id: alert must be addressable
  -- to peace committee with phone.
  CHECK (hazard <> 'conflict_pressure' OR override_geom IS NULL)
);
CREATE UNIQUE INDEX idx_one_open_situation
  ON situations (zone_id, hazard)
  WHERE status NOT IN ('resolved','dismissed');

CREATE TYPE risk_band AS ENUM ('low','watch','elevated','high','very_high');

CREATE TABLE situation_assessments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id     UUID NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  model_version_id TEXT NOT NULL REFERENCES model_versions(id),
  assessed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_cutoff      DATE NOT NULL,          -- up to what date DID IT SEE data
  horizon_days     SMALLINT NOT NULL DEFAULT 30,   -- 3 dekads

  -- The three outputs
  prob_conflict      NUMERIC(5,4) NOT NULL CHECK (prob_conflict BETWEEN 0 AND 1),
  expected_incidents NUMERIC(6,2) NOT NULL,
  model_risk         NUMERIC(5,4) NOT NULL,
  model_band         risk_band NOT NULL,

  -- Two scores: model_risk PURE (climate+history only, auditable) vs.
  -- corroboration (unconfirmed news). Combined by VISIBLE RULE.
  corroboration    NUMERIC(5,4) NOT NULL DEFAULT 0,
  operational_band risk_band NOT NULL,
  combination_rule TEXT NOT NULL,

  shap        JSONB NOT NULL,
  explanation TEXT,                        -- LLM prose or template fallback
  pressure_focus geometry(MultiPoint, 4326),  -- pixel-level diagnosis

  -- ⚠️ E7 IDEMPOTENCE (v2 correction): re-running same cycle
  -- updates this row instead of inserting duplicate.
  CONSTRAINT uq_assessment_per_cycle
    UNIQUE (situation_id, model_version_id, data_cutoff)
);
CREATE INDEX idx_assessments_situation
  ON situation_assessments (situation_id, assessed_at DESC);

-- FROZEN SNAPSHOT: if you dispatched "4,000 people", you must later prove
-- what numbers you had. If you recalculate, your record lies.
CREATE TABLE situation_exposure (
  situation_id UUID NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  asset        asset_type NOT NULL,
  value        NUMERIC(14,2) NOT NULL,
  source       TEXT NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (situation_id, asset)
);

-- ============ 6. UNSTRUCTURED + RAG ============

CREATE TABLE news_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url          TEXT UNIQUE,
  source       TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  language     TEXT NOT NULL,
  title        TEXT,
  raw_text     TEXT NOT NULL,
  embedding    vector(1024),               -- BGE-M3 (ADR #17)
  processed_at TIMESTAMPTZ,                -- E3 mark: NULL = pending
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_news_embedding ON news_documents
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_news_published ON news_documents (published_at DESC);

CREATE TYPE signal_status AS ENUM ('unconfirmed','confirmed','dismissed');

CREATE TABLE news_signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES news_documents(id) ON DELETE CASCADE,
  zone_id      TEXT REFERENCES zones(id),
  signal_type  TEXT NOT NULL,
  summary      TEXT NOT NULL,
  confidence   NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  -- ⚠️ RED LINE, IN SCHEMA: signal born UNCONFIRMED.
  -- Never triggers alert alone. False conflict alert can escalate violence.
  status       signal_status NOT NULL DEFAULT 'unconfirmed',
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extractor    TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX idx_signals_zone ON news_signals (zone_id, extracted_at DESC);

-- ============ 7. ACTION AND DISPATCH (Onya) ============

CREATE TABLE recipients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id            TEXT NOT NULL REFERENCES zones(id),
  name               TEXT NOT NULL,
  role               TEXT NOT NULL,
  phone_e164         TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'sw',
  active             BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (phone_e164, zone_id)
);

CREATE TABLE recommended_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id UUID NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  action_type  TEXT NOT NULL,
  description  TEXT NOT NULL,
  audience     TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'proposed',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE alert_status AS ENUM
  ('draft','pending_approval','approved','dispatching','dispatched','failed');

CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id    UUID NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  status          alert_status NOT NULL DEFAULT 'draft',
  source_language TEXT NOT NULL DEFAULT 'en',
  drafted_by      TEXT NOT NULL,
  -- ⚠️⚠️ HUMAN GATE, ENFORCED BY DATABASE:
  -- IMPOSSIBLE to mark approved/dispatching/dispatched without human signature.
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    status IN ('draft','pending_approval','failed')
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE TABLE alert_contents (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id  UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  language  TEXT NOT NULL,
  channel   TEXT NOT NULL,                 -- voice | sms | whatsapp
  body_text TEXT NOT NULL,
  tts_url   TEXT,                          -- pre-generated audio (ADR #18)
  UNIQUE (alert_id, language, channel)
);

-- v2: adds 'needs_review' — destination for zombies and retry exhaustion.
CREATE TYPE dispatch_status AS ENUM
  ('queued','sending','sent','delivered','failed','needs_review');

-- Extra ack values seed v2's labeled dataset:
-- keypad 2 = confirmed positive; keypad 3 = confirmed negative.
CREATE TYPE ack_status AS ENUM
  ('none','acknowledged','conflict_reported','resolved');

-- ⚠️ THIS TABLE IS THE DISPATCH QUEUE **AND** THE MAP'S READ MODEL.
CREATE TABLE alert_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id            UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  recipient_id        UUID NOT NULL REFERENCES recipients(id),
  channel             TEXT NOT NULL,
  language            TEXT NOT NULL,
  -- Our system never creates two deliveries for the same trio:
  idempotency_key     TEXT NOT NULL UNIQUE, -- hash(alert_id,recipient_id,channel)
  dispatch_status     dispatch_status NOT NULL DEFAULT 'queued',
  provider_message_id TEXT UNIQUE,          -- webhook dedup + validation
  attempts            SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at          TIMESTAMPTZ,          -- v2: zombie detection
  last_error          TEXT,
  ack_status          ack_status NOT NULL DEFAULT 'none',
  ack_method          TEXT,
  ack_at              TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_queue
  ON alert_deliveries (next_attempt_at)
  WHERE dispatch_status IN ('queued','failed');
CREATE INDEX idx_delivery_zombies
  ON alert_deliveries (claimed_at)
  WHERE dispatch_status = 'sending';
CREATE INDEX idx_delivery_alert ON alert_deliveries (alert_id);

-- v2: automatic updated_at maintenance (necessary, was missing)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_delivery_updated_at
  BEFORE UPDATE ON alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============ 8. REALTIME — Postgres AS BUS ============
-- NOTIFY happens inside the same transaction that persists the fact.

CREATE OR REPLACE FUNCTION notify_delivery_change() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('dira_events', json_build_object(
    'type','delivery_updated','delivery_id',NEW.id,'alert_id',NEW.alert_id,
    'dispatch_status',NEW.dispatch_status,'ack_status',NEW.ack_status)::text);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_delivery_notify
  AFTER INSERT OR UPDATE ON alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION notify_delivery_change();

CREATE OR REPLACE FUNCTION notify_situation_change() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('dira_events', json_build_object(
    'type','situation_updated','situation_id',NEW.id,'zone_id',NEW.zone_id,
    'hazard',NEW.hazard,'status',NEW.status)::text);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_situation_notify
  AFTER INSERT OR UPDATE OF status ON situations
  FOR EACH ROW EXECUTE FUNCTION notify_situation_change();

-- ============ 9. MAP READ VIEW ============
-- One query, one object. Frontend doesn't assemble state from 6 endpoints.

CREATE VIEW v_map_situations AS
SELECT
  s.id AS situation_id, s.zone_id, z.name AS zone_name, z.cluster_id,
  s.hazard, s.status,
  COALESCE(s.override_geom, z.geom) AS geom,
  a.prob_conflict, a.expected_incidents, a.model_band,
  a.corroboration, a.operational_band, a.explanation,
  a.pressure_focus, a.data_cutoff, a.assessed_at,
  (SELECT count(*) FROM alert_deliveries d
     JOIN alerts al ON al.id = d.alert_id
    WHERE al.situation_id = s.id)                          AS deliveries_total,
  (SELECT count(*) FROM alert_deliveries d
     JOIN alerts al ON al.id = d.alert_id
    WHERE al.situation_id = s.id
      AND d.ack_status <> 'none')                          AS deliveries_acked,
  (SELECT count(*) FROM alert_deliveries d
     JOIN alerts al ON al.id = d.alert_id
    WHERE al.situation_id = s.id
      AND d.dispatch_status = 'needs_review')              AS deliveries_needs_review
FROM situations s
JOIN zones z ON z.id = s.zone_id
LEFT JOIN LATERAL (
  SELECT * FROM situation_assessments sa
  WHERE sa.situation_id = s.id
  ORDER BY sa.assessed_at DESC LIMIT 1
) a ON true
WHERE s.status NOT IN ('resolved','dismissed');
```

### 5.1 Critical flows over the schema

**Approval → enqueue (durable promise):** the approval endpoint, in ONE transaction: validates `pending_approval → approved` transition, writes `approved_by/approved_at`, and inserts all `alert_deliveries` (one per active recipient × channel) with its `idempotency_key`. Intention is atomically registered; dispatcher fulfills asynchronously. The trigger NOTIFY awakens dispatcher on commit.

**Acknowledgment webhook:** `POST /webhooks/at/dtmf` looks up delivery by provider session ID against `provider_message_id`. No match → log + 200, no mutation. Match: DTMF 1→`acknowledged`, 2→`conflict_reported`, 3→`resolved`; other digits → record `ack_method` only, leave `ack_status='none'`. The update fires NOTIFY → SSE → map turns green. When all alert's deliveries have acks, situation transitions to `acknowledged`.

---

## PART 6 — DECISION REGISTER (ADR v2)

| # | Decision | Why |
|---|---|---|
| 1 | Modular monolith, not microservices | One dev, 3 weeks; distributed tax with no benefit |
| 2 | Hexagonal (ports/adapters) | Demo insurance: seeded and fallbacks are adapter swaps |
| 3 | Monorepo | `dira_features` shared or training/serving skew guaranteed |
| 4 | Postgres as queue (SKIP LOCKED) | No broker, no double-write; queue IS read model |
| 5 | Postgres as bus (LISTEN/NOTIFY) | Event published in transaction that persists fact |
| 6 | SSE, not WebSocket | Server→client only; half the code; native reconnect |
| 7 | TanStack Query + tiny Zustand | Server state dominates; single path from ack to map |
| 8 | GeoJSON zones / pre-rendered raster tiles | Zero raster compute in request |
| 9 | Bitemporal (`available_at`) + first-write-wins upsert | Temporal leakage structurally impossible; idempotence doesn't rewrite history |
| 10 | Human gate as CHECK | DB invariant, not skippable code convention |
| 11 | `idempotency_key` UNIQUE + `provider_message_id` UNIQUE | Never duplicate in our system; webhook dedup. Scope documented honestly (§3.6) |
| 12 | pgvector in same Postgres | One datastore |
| 13 | **Dekadal temporal grain** (v2) | CHIRPS is dekadal; aligning to source grain avoids noisy interpolation in headline variable and speaks ICPAC's language. Reversible but changes central table PK — never decide mid-way |
| 14 | **Pipeline in 7 stages; display atomic per zone; zero network in transactions** (v2) | Resolves `operational_band NOT NULL`, guarantees map always coherent, never holds transaction during LLM/provider call |
| 15 | **Dispatch in two short transactions + `claimed_at`** (v2) | External call never inside transaction; crashes leave no invisible rows |
| 16 | **Zombies (`sending` > 10 min) → `needs_review`, no auto-retry** (v2) | Double-calling a peace committee worse than minutes delay with visible flag and human retry button. Config-reversible |
| 17 | **Local BGE-M3 embeddings, 1024 dims** (v2) | Multilingual (sw/so/am), no external dependency on demo day; swappable via `EmbeddingModel` port |
| 18 | **TTS: pre-generated audio + `<Play>`; fallback human-recorded** (v2) | Provider's `<Say>` doesn't cover Swahili with quality; recorded fallback armors hero moment |
| 19 | **Baselines: persistence + CAST aggregated + climatology** (v2) | Methodological honesty is strong slide; compare vs CAST at CAST grain only |
| 20 | **Do-no-harm in alert content** (v2) | Aligned with CEWARN protocol: conditions and actions, never actors or groups |
| 21 | Timestamps UTC; UI converts to EAT | Avoids "whose midnight is this?" bugs in bitemporal cut |

---

## PART 7 — 3-WEEK PLAN

Absolute priority: **one impeccable end-to-end slice**. Order preserves cycle if something recedes.

**Week 1 — Data + brain.** Real ingestion (ACLED API, CHIRPS S3, NDVI GEE) for Mandera; alignment to zone×dekad index with 1-month lag; train LightGBM with temporal validation; three baselines; SHAP. **Verify this week:** GEE access approved (Plan B: LP DAAC/AppEEARS), ACLED account level (register with institutional email), Swahili TTS provider (Plan B: record human audio), Africa's Talking account + number (Kenya caller ID registration can lag — start NOW). Model fallback: transparent weighted index. Deliverable: seeded dataset + model with 3 explained outputs.

**Week 2 — Map + cards + Onya.** MapLibre regional + zoom Mandera; environmental layers + consumed flooding; Tabiri cards; full voice flow with keypad ack → map green. Deliverable: visible cycle.

**Week 3 — Language AI + polish + demo.** Seeded corpus; signal extraction; advisor with streaming; CEWARN brief; repo clean; **video recorded against seeded**; two 250-word summaries.

**Risks:** live feed down → seeded; training drags → transparent index; scope creeps → deep cycle only conflict; live call fails → pre-recorded video; false alert → human gate + unconfirmed signals + do-no-harm; one dev → one backend, fallbacks per week.

---

## PART 8 — WHAT THIS BUYS ON THE RUBRIC

**Technical depth (30%):** bitemporality with correct upsert semantics, end-to-end idempotence verified by test, transactional queue with crash recovery, schema invariants, honest baselines. **AI innovation (30%):** explainable prediction + news NLU + multilingual voice + agentic advisor — AI carrying weight in four places. **Problem value and impact (25%):** anchored to documented failures (March 2026), named beneficiaries, addresses connectivity/literacy/language, do-no-harm operationalized. **Presentation (15%):** clean repo, demo's ack moment on video, disciplined briefs.
