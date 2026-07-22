# Dira — Technical Architecture

Causal situation room for the Horn of Africa · IGAD Husika Hackathon 2026  
One developer · ~3 weeks · Python + React

## 0. The system's true form

Before choosing architecture you must honestly name the workloads, because they are very different and that difference drives design:

| Workload | Nature | Latency | Fails if… |
|---|---|---|---|
| Data ingestion (CHIRPS, MODIS, ACLED) | Heavy batch, IO/CPU | Minutes | Provider goes down or changes |
| ML training | Offline, occasional | Minutes | — (not in live system) |
| ML inference | Batch per cycle | Seconds | — |
| LLM orchestration | On-demand + batch | Seconds, with streaming | External API goes down |
| Map read API | Request/response | Milliseconds | Must never fail |
| Dispatch (Onya) | External effects, with retries | Seconds | ⚠️ Double-call or drop an alert |
| Realtime push | Server → client | < 2 s | Ack doesn't paint map green |

Three immediate consequences:

1. Raster processing NEVER goes in the request path. It's batch, precalculated.
2. Dispatch needs durability and idempotence. It's the only point with irreversible real-world effects.
3. All external dependencies are volatile — ACLED, S3, GEE, Anthropic, Africa's Talking. Any can fail on demo day.

That third consequence is what drives the backend architecture.

## 1. Backend — Modular monolith + ports and adapters

### What we DON'T do, and why

**Microservices:** no. One dev, three weeks. You'd pay all the distributed systems tax (network, deployment, observability, eventual consistency) for zero benefit at this scale. Judges don't reward microservices; they reward systems that work.

**Serverless:** no. Tempting for scheduled pipeline, but it makes local dev expensive and fragilizes the demo, which we absolutely can't afford.

### What we DO: hexagonal, and for a reason that's not academic

Ports and adapters (hexagonal) architecture here is not purism. It's demo insurance.

The domain (Situation lifecycle, risk assessment, alert approval) is stable and testable. All edges are volatile third parties. If you define one port per external dependency, then having a seeded demo version is changing an adapter, not rewriting anything:

```python
# core/ports.py — the domain defines the interface. Knows no one.
class ConflictDataSource(Protocol):
    def events(self, zone_ids: list[str], since: date) -> list[ConflictEvent]: ...
class RiskModel(Protocol):
    def assess(self, features: FeatureRow) -> Assessment: ...
class VoiceChannel(Protocol):
    def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef: ...

ConflictDataSource → AcledApiAdapter | SeededAcledAdapter
HazardDataSource → ChirpsS3Adapter | SeededRasterAdapter
RiskModel → LightGBMAdapter | TransparentIndexAdapter ← the fallback!
LanguageModel → AnthropicAdapter | CannedResponseAdapter
VoiceChannel → AfricasTalkingAdapter | MockDispatcher
```

Three things fall out free:

- `DATA_MODE = live | seeded` switches all data adapters at once. Demo runs in seeded. Live mode is demonstrated separately. This is the project's single most important resilience decision.
- The model fallback we agreed on (if training drags, a transparent weighted index produces the same three outputs) is an adapter, not a rewrite. It's a different row in `model_versions` and an UPDATE.
- Domain tests run without network, without BD, without keys.

### Module map

Dependency rule: everything points inward; `dira_core` imports nothing.

```
dira/
├── apps/
│   ├── api/            FastAPI: routes, dependencies, SSE. Thin.
│   ├── worker/         Scheduled pipeline + dispatch worker.
│   └── web/            React + TypeScript + MapLibre
├── packages/
│   ├── dira_core/      PURE DOMAIN. No I/O, no network, no DB.
│   │   ├── situations/ lifecycle, state machine, human gate
│   │   ├── risk/       bands, two-score combination rule
│   │   ├── alerts/     approval and idempotence invariants
│   │   └── ports.py
│   ├── dira_features/  ⚠️ SHARED VARIABLE ENGINEERING
│   │                   Imported by dira_ml AND by apps/worker.
│   │                   If this bifurcates → training/serving skew.
│   │                   THE reason for monorepo.
│   ├── dira_data/      Adapters: ACLED, CHIRPS, MODIS, PostGIS repos
│   ├── dira_ml/        Training, evaluation, SHAP → artifacts
│   ├── dira_llm/       LLM adapters, RAG (pgvector), prompts, extraction
│   └── dira_dispatch/  Africa's Talking, retries, webhooks
├── artifacts/          model_v1.lgb + model_card.json
├── data/seeded/        Real Mandera fixtures — demo insurance
└── infra/              docker-compose, migrations
```

Why monorepo and not two repos: the artifact crosses the boundary, not the code. But `dira_features` must be importable by training and inference. If they're in separate repos, either you duplicate code (guaranteed drift = ML's bug #1) or publish a package (pointless overhead in 3 weeks). Also: judges review one repo.

## 2. Postgres as dispatch queue — and why there's no broker

Dispatch needs durability and retries. The obvious choice would be Celery + Redis. We don't do it.

`alert_deliveries` IS the queue. The worker does:

```sql
SELECT * FROM alert_deliveries
WHERE dispatch_status IN ('queued','failed')
AND next_attempt_at <= now()
ORDER BY next_attempt_at
FOR UPDATE SKIP LOCKED
LIMIT 10;
```

`FOR UPDATE SKIP LOCKED` is the standard and correct pattern for this. Four reasons it beats a broker here:

1. Zero new infrastructure. You already have Postgres.
2. No double-write. With an external broker, creating the alert (DB) and enqueuing it (Redis) are two writes that can diverge. Here it's one transaction: alert and deliveries created atomically.
3. The queue IS the read model. The map shows `queued → sent → delivered → acked` reading the same row the worker processes. No sync between "the queue" and "what you see" — they're the same data. Eliminates an entire class of bugs.
4. At demo scale (hundreds of messages) Postgres is overkill.

When you'd change: at thousands of messages/second. Not this case. Stating it explicitly in the repo shows the decision was deliberate, not ignorance.

**Idempotence:** `idempotency_key UNIQUE` derived from (alert_id, recipient_id, channel). Retrying is safe by construction. And `provider_message_id UNIQUE` dedups webhooks — Africa's Talking can deliver the same callback twice.

## 3. Realtime — Postgres as event bus

Demo moment: ack arrives, map turns green in seconds.

DTMF "1" → Africa's Talking webhook → UPDATE alert_deliveries
→ TRIGGER → pg_notify('dira_events', {...})
→ API listens (LISTEN) → relays via SSE
→ client patches TanStack Query cache → map re-renders

**SSE, not WebSocket.** Server→client only. SSE runs over plain HTTP, reconnects automatically, half the code. Client commands go by REST.

One realtime primitive for everything (including advisor streaming).

No Redis. NOTIFY happens inside the same transaction that registers the ack. Publishing the event and persisting the fact are atomic.

**Safety net:** client polls every 3 s if SSE connection dies. If you're time-pressed, polling-only also works and nobody notices in a 5-minute video. Don't die on this hill.

## 4. Frontend — server state dominates

### The diagnosis

Almost all Dira state is server state: situations, assessments, cards, deliveries. Genuinely local client state is tiny: which layer is active, which card is open, where the map camera is.

Putting everything in Redux/Zustand would be the classic error: you'd end up with two sources of truth (server and store) and a permanent sync bug — exactly in the flow that matters most (ack painting the map).

### The correct division

| State type | Tool | Why |
|---|---|---|
| Server state (situations, cards, deliveries) | TanStack Query | Cache, staleness, refetch, invalidation are its reason for being. Server is sole truth; cache is derived. |
| UI state (active layers, selected situation, viewport) | Zustand (tiny store) | Genuinely local, small, no server semantics. |
| Form state (approval, text edit) | Local (useState) | Ephemeral. |

The payoff is in realtime. The SSE event arrives and does one thing:

```javascript
// Ack arrives → patch cache → map re-renders. Single path.
queryClient.setQueryData(['situations'], patchDelivery(evt));
```

No parallel store to update. The map, card, and dispatch panel all read from same cache and re-paint together. That's the architectural reason for the choice, not fashion.

### The map

MapLibre GL JS. Open source, no token, WebGL, handles vector and raster layers smoothly. ICPAC's own Hazards Watch is built on open-source geo stack — you speak its language.

Data delivery, by layer type:

| Layer | Format | Why |
|---|---|---|
| Zones (~50–200 polygons) | Direct GeoJSON | Running a vector tile server for 50 polygons is overengineering. |
| Rasters (rain, NDVI, heat) | Pre-rendered PNG/COG tiles per cycle | Zero raster compute in request. Robust. Already decided: pre-computed tiles. |
| Pressure points (wells, hotspots) | GeoJSON points | "Diagnosis at pixel level". |
| Flooding | GeoJSON consumed from GloFAS/NASA | Own footprint → override_geom. |

Layers are declarative from state. A `useMapLayers` hook syncs MapLibre sources/layers with React state. Never manipulate the map imperatively from scattered handlers — that's how map code rots. The canvas is a dumb renderer guided by state.

**Structure by features, not by types**

```
web/src/
├── features/
│   ├── map/        canvas, layers, zoom/layer controls
│   ├── situations/ Tabiri card, risk timeline, SHAP explanation
│   ├── advisor/    lateral panel with LLM streaming
│   └── dispatch/   approval queue, delivery status, acks
├── lib/            API client, SSE client, shared types
└── app/            routes, providers
```

Folders by feature, not components/ + hooks/ + utils/. The first scales; the second becomes junk drawers.

## 5. The complete path, end to end

### DATA CYCLE (batch, scheduled)

1. worker: ingest CHIRPS + MODIS + ACLED → observations (bitemporal)
2. worker: zonal statistics PostGIS → zone_climate_weekly
3. worker: dira_features builds row → respecting available_at <= cutoff
4. worker: RiskModel.assess() → prob, incidents, band, SHAP
5. worker: create/update Situation → situation_assessments
6. worker: exposure cross → situation_exposure (frozen snapshot)
7. worker: signal extraction (LLM) → news_signals (status='unconfirmed')
8. worker: corroboration + operational band → VISIBLE rule, not learned

### OPERATOR (interactive)

9. Map shows zone in red, with card and prose explanation
10. Advisor prioritizes, drafts CEWARN brief, prepares translated alert
11. ⚠️ HUMAN APPROVES → alerts.approved_by (enforced by CHECK)

### DISPATCH (Onya)

12. alert_deliveries enqueued (one per recipient × channel), idempotent
13. worker: FOR UPDATE SKIP LOCKED → voice call via Africa's Talking
14. Recipient PRESSES 1
15. webhook → UPDATE ack_status → pg_notify → SSE → cache patched
16. 🟢 MAP TURNS GREEN

## 6. Deployment

Deliberately boring. Each extra piece is a new way the demo breaks.

```
┌─ One small server ────────────────────┐
│ FastAPI (uvicorn) ──┐ │
│ worker (same code)─┼── PostgreSQL 16 │
│ Static React build ─┘ + PostGIS + pgvector│
│ Pre-rendered tiles (static)  │
└───────────────────────────────────────┘
```

- One language on server (Python). Less context-switch for one dev.
- One database. Postgres is the BD, the vector index, the queue, and the event bus.
- docker-compose for identical local-to-production dev.
- Webhooks: Africa's Talking needs a public URL. In dev, a tunnel; in demo, the deployed server.
- Video recorded against `DATA_MODE=seeded`, always. Live call is a bonus, not a dependency.

## 7. Decision register (abbreviated ADR)

| # | Decision | Why |
|---|---|---|
| 1 | Modular monolith, not microservices | One dev, 3 weeks. Distributed tax with no benefit. |
| 2 | Hexagonal (ports/adapters) | Demo insurance: seeded is an adapter swap. Model fallback too. |
| 3 | Monorepo, not two repos | `dira_features` shared or guaranteed training/serving skew. |
| 4 | Postgres as queue (SKIP LOCKED) | No broker, no double-write, queue IS read model. |
| 5 | Postgres as bus (LISTEN/NOTIFY) | Event published in transaction that persists fact. |
| 6 | SSE, not WebSocket | Server→client only. Half the code, native reconnect. |
| 7 | TanStack Query + tiny Zustand | Server state dominates. Single path from ack to map. |
| 8 | GeoJSON zones, pre-rendered raster tiles | Zero raster compute in request. No tile server for 50 polygons. |
| 9 | Bitemporal design (available_at) | Temporal leakage structurally impossible, not a discipline. |
| 10 | Human gate as BD CHECK | Invariant, not skippable code convention. |
| 11 | idempotency_key UNIQUE | Never double-call, never drop alert. |
| 12 | pgvector in same Postgres | One datastore. External vector store adds moving part for zero benefit at this scale. |

## 8. What this design buys you on the rubric

- **Technical depth (30%):** bitemporality, idempotence, transactional queue, schema invariants. Student teams don't do this.
- **Demonstrable resilience:** seeded mode and model fallback are architecture, not patches.
- **Defensible safety:** human gate and unconfirmed signal red line are in the database. Not README promises.
