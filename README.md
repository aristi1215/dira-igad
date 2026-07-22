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

Authoritative reconstructed spec: [`DIRA-SPEC.md`](DIRA-SPEC.md). Honest deviations: [`DEVIATIONS.md`](DEVIATIONS.md).

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
│   ├── dira_data/      ACLED / CHIRPS / PostGIS adapters
│   ├── dira_ml/        LightGBM, baselines, SHAP/transparent index
│   ├── dira_llm/       LLM, prompts, signal extraction
│   └── dira_dispatch/  Africa's Talking, TTS, MockDispatcher
├── artifacts/          model artifacts + PNG tiles
├── data/seeded/        Mandera fixtures — demo insurance
├── infra/              docker-compose, Dockerfiles, Alembic
├── scripts/            bootstrap.py, train.py, demo.py
└── docs/               ADRs + implementation brief
```

**Dependency rule:** everything points inward; `dira_core` imports nothing from sibling packages (enforced by import-linter).

**Resilience:** `DATA_MODE=seeded|live` swaps all data adapters at once. **The demo always runs seeded.**

---

## Safety red lines (schema-enforced where noted)

1. **Human gate** before any dispatch — DB `CHECK` on `alerts` (`approved_by` / `approved_at` required).
2. **News signals never fire alerts alone** — born `unconfirmed`.
3. **Do-not-harm alert copy** — conditions and actions only; never name actors, ethnicities, clans, or communities.
4. **Two separate scores** — pure `model_risk` (climate + history) vs news `corroboration`, combined by a **written visible rule**.
5. **Bitemporal features** — only `available_at <= data_cutoff`; climate upserts are first-write-wins per column group.
6. **No network calls inside open DB transactions.**

---

## Dispatch idempotency (honest scope)

- `idempotency_key UNIQUE` → our system never creates two deliveries for the same (alert, recipient, channel).
- `provider_message_id UNIQUE` → deduplicates provider webhooks.
- Physical double-call prevention depends on the provider; we mitigate with **two short transactions** (claim → HTTP outside Tx → result) and zombies (`sending` > 10 min) → **`needs_review`** (no auto-retry).

Acks enter via the **API webhook**, not the dispatch worker. In seeded mode, `MockDispatcher` simulates the call + delayed keypad ack so the map can turn green without telephony keys.

---

## Quick start (3 commands)

### Prerequisites

- Python 3.12 + [uv](https://github.com/astral-sh/uv)
- Node.js 20+
- PostgreSQL 16 with PostGIS + pgvector (via Docker Compose **or** local apt packages — see D-008)

```bash
cp .env.example .env          # keep DATA_MODE=seeded
uv sync --all-packages
make seed && make demo        # migrate + bootstrap + 3 pipeline cycles
```

Then in three terminals:

```bash
uv run uvicorn dira_api.main:app --host 0.0.0.0 --port 8000
uv run python -m dira_worker.dispatch
npm --prefix apps/web run dev -- --host 0.0.0.0
```

- API docs: http://localhost:8000/docs  
- Web: http://localhost:5173  

### Demo script

1. Map shows Mandera zones (high / very_high bands).
2. Select a red zone → Tabiri card (frozen exposure + explanation + SHAP).
3. Prepare alert → pending approval in advisor panel.
4. Approve as `demo-advisor` → deliveries queued.
5. Dispatch worker / MockDispatcher “calls” → simulated ack.
6. SSE patches Query cache → zone trends green.

`make demo` twice is idempotent (same final storefront state for the three cycles).

---

## Process inventory

| Process | Trigger | Notes |
|---------|---------|--------|
| Bootstrap | `make seed` | Zones, adjacency, exposure, fixtures |
| Training | `python -m scripts.train` / demo | Offline; writes artifact + `model_versions` |
| Pipeline | `python -m dira_worker.pipeline --cycle YYYY-MM-DD` | E1–E7; day must be 1/11/21 |
| Dispatch | `python -m dira_worker.dispatch` | LISTEN + 30s poll |
| API | uvicorn | REST + webhooks + SSE |

---

## Testing / lint

```bash
make lint          # ruff + mypy (core/features) + import-linter
make test          # pytest (unit + Postgres integration)
npm --prefix apps/web run test
npm --prefix apps/web run build
```

Integration tests require a real Postgres (`DATABASE_URL`). They never use SQLite.

---

## When we would change these decisions

- Swap TransparentIndex for a freshly trained LightGBM when Mandera history is long enough for honest lift over the three baselines.
- Replace MockDispatcher with Africa's Talking only after webhook signature verification is wired in live mode.
- Add WhatsApp/SMS channels only after the voice Mandera loop is rock-solid (spec cut order).
- Move embeddings from precomputed/hash to local BGE-M3 once GPU/CPU budget allows.

---

## Decision log

See [docs/adr/README.md](docs/adr/README.md) for ADR index (#1–21).

---

## License

MIT — hackathon deliverable.
