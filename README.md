# Dira

**Causal situation room for the Horn of Africa** — IGAD Husika Hackathon 2026  
*"Smarter Early Warning, Stronger Communities"*

Dira turns ICPAC-class environmental forecasts into actionable last-mile voice alerts, and anticipates climate-linked conflict pressure — always showing *why*.

| Module | Role |
|--------|------|
| **Amani** | Conflict-pressure prediction (hero capability) |
| **Tabiri** | Impact cards: who/what is at risk in critical zones |
| **Onya** | Last-mile dispatch: Swahili voice calls with keypad ack |

**Protagonist cluster:** Mandera (Kenya–Ethiopia–Somalia tri-border), inside a **full IGAD regional view** — 9 clusters / 22 zones across Kenya, Ethiopia, Somalia, South Sudan, Sudan, Uganda, and Djibouti (D-011). A per-country **economy panel** (World Bank WDI-derived, D-012) rounds out the situation room.

Beyond climate + conflict, Dira carries a CEWARN-style **information layer** (D-018): IPC food
security, displacement (IOM DTM / UNHCR-shaped), WFP-shaped market & livestock prices (incl.
goat→maize terms of trade), weekly disease surveillance, locust/flood/heat/drought hazard
bulletins, and human field-monitor reports with a verification gate. All of it is bitemporal
(`available_at`), context-only for the model, and browsable per zone in the web app.

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
2. **News signals never fire alerts alone** — born `unconfirmed`. Field-monitor reports are born `unverified` and contribute **exactly 0** to corroboration until a named human verifies them; dismissed reports stay at 0 forever.
3. **Do-not-harm alert copy** — conditions and actions only; never name actors, ethnicities, clans, or communities.
4. **Two separate scores** — pure `model_risk` (climate + history) vs `corroboration` from two independent channels (news signals and **verified** field reports, merged by max, not sum), combined by a **written visible rule** persisted on every assessment.
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

### The six screens (D-017)

| Route | Screen | What it's for |
|-------|--------|---------------|
| `/` | **Map & watchlist** | Full-bleed light map; choropleth overlays (Conflict pressure · IPC phase · Displacement · Incidents · Hazards); situation markers sized by model risk; ranked watchlist rail; compact zone card with actions |
| `/situations` | **Situation registry** | Filterable table of every situation → detail with risk trajectory, SHAP drivers, the two-score panel (written combination rule), frozen exposure snapshot, signals, verified field reports, alert timeline |
| `/zones` | **Zone registry & dossiers** | All 22 zones with context chips → per-zone dossier: rain, NDVI, incidents, IPC, displacement, market prices + terms of trade, health surveillance, hazard bulletins, field reports (verify/dismiss/new), recipients |
| `/dispatch` | **Onya console** | Approval gate (named signer required), delivery board by status with needs-review retry, keypad-ack semantics, recipient roster |
| `/analytics` | **Regional analytics** | Incidents & fatalities, band distribution, rainfall heat-strip per cluster, IPC 3+ and IDP totals by country, economy panel |
| `/sources` | **Data catalog** | Every source with mode (live/seeded), freshness, row counts, licences, the bitemporal note, and the red lines |

An **Ask Dira** advisor drawer is available on every screen (OpenAI in live mode, deterministic canned fallback in seeded mode).

### Demo script

1. Map opens on the IGAD region: all 22 zones choropleth-shaded by operational band, open situations as graduated markers, watchlist ranked by model risk.
2. Flip overlays (IPC / Displacement / Incidents / Hazards) to see the same region through CEWARN's other lenses.
3. Select the red Mandera zone → zone card → **Open dossier** for the full picture (IPC 5, IDP inflow, staple price spike, cholera alert, verified water-dispute reports).
4. **View situation** → two-score panel shows pure model risk vs corroboration and the exact written rule, including the `verified_field_reports` channel.
5. **Prepare alert** → Dispatch screen; read the Swahili draft, type your name, approve → deliveries queue atomically.
6. Dispatch worker / MockDispatcher "calls" → simulated keypad ack; SSE patches the UI live.
7. Verify or dismiss an unverified field report in the dossier — only verification by a named person moves corroboration, and only on the next pipeline cycle.

LLM: set `OPENAI_API_KEY` for live alert drafting/advisor (D-010); Anthropic is a fallback and seeded mode needs no key.

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
