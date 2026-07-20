# Dira

**Causal situation room for the Horn of Africa** — IGAD Husika Hackathon 2026  
*"Smarter Early Warning, Stronger Communities"*

Dira turns ICPAC-class environmental forecasts into actionable last-mile voice alerts, and anticipates climate-linked conflict pressure — always showing *why*.

| Module | Role |
|--------|------|
| **Amani** | Conflict-pressure prediction (hero capability) |
| **Tabiri** | Impact cards: who/what is at risk in critical zones |
| **Onya** | Last-mile dispatch: Swahili voice calls with keypad ack |

**Protagonist cluster:** Mandera (Kenya–Ethiopia–Somalia tri-border).

This repository is scaffolded for implementation. Business logic, pipeline stages, ML training, and live adapters are **not** implemented yet — see [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

---

## Architecture (modular hexagonal monorepo)

```
dira-igad/
├── apps/
│   ├── api/            FastAPI — routes, webhooks, SSE (thin)
│   ├── worker/         Dekadal pipeline + dispatch daemon
│   └── web/            React + TypeScript + MapLibre
├── packages/
│   ├── dira_core/      Pure domain + ports (no I/O)
│   ├── dira_features/  Shared features (train ≡ serve)
│   ├── dira_data/      ACLED / CHIRPS / MODIS / PostGIS adapters
│   ├── dira_ml/        LightGBM, baselines, SHAP artifacts
│   ├── dira_llm/       LLM, RAG (pgvector), prompts
│   └── dira_dispatch/  Africa's Talking, TTS, retries
├── artifacts/          model_v1.lgb + model_card.json
├── data/seeded/        Mandera fixtures — demo insurance
├── infra/              docker-compose, Dockerfiles, migrations
├── scripts/            bootstrap.py, train.py (manual)
└── docs/               ADRs + implementation brief
```

**Dependency rule:** everything points inward; `dira_core` imports nothing external.

**Resilience:** `DATA_MODE=seeded|live` swaps all data adapters at once. **The demo always runs seeded.** Live mode is shown separately.

Ports (defined in `packages/dira_core/dira_core/ports.py`):

| Port | Live adapter | Seeded / fallback |
|------|--------------|-------------------|
| ConflictDataSource | AcledApiAdapter | SeededAcledAdapter |
| HazardDataSource | ChirpsS3 / GeeNdvi | SeededRasterAdapter |
| RiskModel | LightGBMAdapter | TransparentIndexAdapter |
| LanguageModel | AnthropicAdapter | CannedResponseAdapter |
| EmbeddingModel | LocalBgeM3Adapter | PrecomputedEmbeddingsAdapter |
| VoiceChannel | AfricasTalkingAdapter | MockDispatcher |
| SpeechSynthesizer | TtsProviderAdapter | PrerecordedAudioAdapter |

---

## Safety red lines (schema-enforced where noted)

1. **Human gate** before any dispatch — DB `CHECK` on `alerts` (approved_by / approved_at required).
2. **News signals never fire alerts alone** — born `unconfirmed`.
3. **Do-not-harm alert copy** — conditions and actions only; never name actors, ethnicities, clans, or communities.
4. **Two separate scores** — pure `model_risk` (climate + history) vs news `corroboration`, combined by a **written visible rule**.

---

## Dispatch idempotency (honest scope)

- `idempotency_key UNIQUE` → our system never creates two deliveries for the same (alert, recipient, channel).
- `provider_message_id UNIQUE` → deduplicates provider webhooks.
- Physical double-call prevention depends on the provider; we mitigate with **two short transactions** (claim → HTTP outside Tx → result) and zombies (`sending` > 10 min) → **`needs_review`** (no auto-retry).

Acks enter via the **API webhook**, not the dispatch worker.

---

## Quick start

### Prerequisites

- Python 3.11+
- Node.js 20+
- Docker (for Postgres + PostGIS)

### 1. Environment

```bash
cp .env.example .env
```

Keep `DATA_MODE=seeded` for local demo work.

### 2. Database

```bash
docker compose -f infra/docker-compose.yml up -d db
```

Full schema is applied by the implementation agent from the consolidated spec (Part 5). The scaffold migration only creates extensions + a meta marker.

### 3. Python workspace

```bash
# Prefer uv (uses .venv automatically)
uv sync

# Optional extras when implementing rasters / SHAP (may need compatible Python):
# uv sync --extra rasters --package dira-data
# uv sync --extra explain --package dira-ml

# Or pip editable installs
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -e packages/dira_core -e packages/dira_features -e packages/dira_data -e packages/dira_ml -e packages/dira_llm -e packages/dira_dispatch -e apps/api -e apps/worker
```

### 4. API

```bash
uvicorn dira_api.main:app --reload --port 8000
```

Health: [http://localhost:8000/health](http://localhost:8000/health)

### 5. Web

```bash
cd apps/web
npm install
npm run dev
```

### Workers (after implementation)

```bash
python -m dira_worker.pipeline --cycle 2026-03-11
python -m dira_worker.dispatch
```

---

## Process inventory

| Process | Trigger | Notes |
|---------|---------|--------|
| Bootstrap | Manual once | Zones, adjacency, exposure |
| Training | Manual | Offline; writes artifact + `model_versions` |
| Pipeline worker | Cron / dekadal | Seven stages E1–E7; exit code matters |
| Dispatch worker | Daemon | LISTEN + 30s poll safety net |
| API | Always | Request/response + webhooks + SSE |

**Hard rule:** no external network calls inside an open DB transaction.

---

## Frontend state

- **TanStack Query** — situations, cards, deliveries (server is source of truth)
- **Zustand (tiny)** — active layers, selection, viewport
- **useState** — forms
- **SSE** — only patches Query cache (`setQueryData`); polling every 3s if SSE drops
- Timestamps stored in **UTC**; UI displays **EAT (UTC+3)**

---

## Decision log

See [docs/adr/README.md](docs/adr/README.md) for ADR index (hexagonal monorepo, Postgres as queue/bus, dekadal grain, BGE-M3 embeddings, pre-generated TTS, etc.).

---

## License

MIT — hackathon deliverable.
