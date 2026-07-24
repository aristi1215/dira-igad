# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Dira is a causal situation room for the Horn of Africa (IGAD Husika Hackathon 2026): it turns
climate/conflict data into risk assessments per zone, drafts human-gated voice alerts, and dispatches
them via Africa's Talking (or a mock in seeded mode). Full architecture, safety red lines, and the
process inventory are in [`README.md`](README.md) — read it first, it is not duplicated here.

**Ignore `docs/IMPLEMENTATION.md`.** It describes an earlier scaffold-only state ("worker exits 1",
"no pipeline logic exists") that no longer matches the code — the pipeline, dispatch daemon, ML/LLM
adapters, and frontend are all implemented. `AGENTS.md` has been kept current and is safe to trust.

The authoritative spec is [`DIRA-SPEC.md`](DIRA-SPEC.md) (reconstructed, see `DEVIATIONS.md` D-001),
with real ADRs indexed at `docs/adr/README.md`. **[`DEVIATIONS.md`](DEVIATIONS.md) is required reading**
before touching risk-band logic, dispatch, LLM selection, or zone data — it explains 16 deliberate
departures from spec (e.g. D-010: OpenAI is the primary LLM, not Anthropic; D-011: 22 IGAD zones, only
6 of which — Mandera — are real, the rest are deterministic synthetic fixtures; D-015: map-first UI
rework).

## Commands

```bash
uv sync --all-packages          # Python workspace (uv workspace, 8 members) — plain `uv sync` is NOT enough
cd apps/web && npm install      # Frontend deps

make seed && make demo          # migrate + bootstrap + 3 pipeline cycles (idempotent — safe to rerun)
make lint                       # ruff + mypy (dira_core/dira_features only) + import-linter
make test                       # pytest -q (unit + Postgres integration)
npm --prefix apps/web run lint
npm --prefix apps/web run test  # vitest run
npm --prefix apps/web run build # tsc -b && vite build

# Single test:
uv run pytest packages/dira_core/tests/test_field_corroboration.py -q
uv run pytest packages/dira_core/tests/test_field_corroboration.py::test_name -q
npm --prefix apps/web run test -- ssePatch   # vitest name filter

# Run the three services (dev):
uv run uvicorn dira_api.main:app --reload --port 8000          # http://localhost:8000/docs
uv run python -m dira_worker.dispatch                            # LISTEN + 30s poll
npm --prefix apps/web run dev -- --host 0.0.0.0                  # http://localhost:5173
uv run python -m dira_worker.pipeline --cycle YYYY-MM-DD          # day must be 1, 11, or 21
```

`make up-db` prefers Docker Compose Postgres but falls back to whatever answers on `DATABASE_URL`
(D-008: Docker overlay builds fail in some cloud sandboxes). Integration tests require a **real**
Postgres reachable via `DATABASE_URL` and the schema already migrated — they skip (not fail) if either
is missing (see `tests/conftest.py`). They never use SQLite.

Optional extras, installed only when needed:
```bash
uv sync --extra explain --package dira-ml     # SHAP (needs compatible numba/llvmlite)
uv sync --extra rasters --package dira-data   # rasterio for CHIRPS/NDVI tiling
```

## Architecture

Hexagonal monorepo, uv workspace + npm. Dependency direction is inward, enforced by
`importlinter.ini`/`pyproject.toml`: `dira_core` imports **nothing** from sibling packages; `packages/*`
never import `apps/*`.

```
apps/api      FastAPI — routes (dira_api/main.py), context_routes.py, SSE relay, webhooks
apps/worker   dira_worker.pipeline (E1–E7 dekadal cycle), dira_worker.dispatch (delivery daemon)
apps/web      React 19 + Vite + MapLibre + TanStack Query + Zustand

packages/dira_core       Pure domain: ports.py (Protocols: ConflictDataSource, HazardDataSource,
                          RiskModel, LanguageModel, VoiceChannel, ...), risk/ (bands + the written
                          two-score combination rule), alerts/, situations/, time.py (dekad calendar)
packages/dira_features   build_feature_row() — bitemporal feature assembly, train ≡ serve
packages/dira_data       Adapters: db.py (psycopg3), climate.py, context.py (information layer),
                          adapters.py (seeded/ACLED/hazard sources), economy.py, live.py (live-mode
                          connectors: ACLED, HDX, ReliefWeb, UNHCR, World Bank), tiles.py
packages/dira_ml         LightGBMAdapter, TransparentIndexAdapter (fallback), baselines, train.py
packages/dira_llm        OpenAIAdapter / AnthropicAdapter / CannedResponseAdapter, factory.py
                          (get_language_model: OpenAI → Anthropic → Canned), signals.py, prompts.py
packages/dira_dispatch   MockDispatcher (seeded), Africa's Talking adapter (at_adapter.py), tts.py
```

### `DATA_MODE=seeded|live`

Swaps every data/LLM/dispatch adapter at once. **Seeded is deterministic and network-free** — LLM
calls use `CannedResponseAdapter`, conflict/hazard data comes from `data/seeded/`, dispatch uses
`MockDispatcher`. The demo (`make demo`) always runs seeded; running the same `--cycle` twice must
produce identical final state (`stage_e3` fully re-derives that cycle's `news_signals` each run; E4–E7
upserts are idempotent per zone×cycle).

### Pipeline (`apps/worker/dira_worker/pipeline.py`), stages E1–E7

1. **E1/E2** (`stage_e1_e2`) — ingest ACLED-shape conflict events + first-write-wins climate upsert
   (`dira_data.climate.upsert_climate_first_write_wins`) + information-layer refresh (IPC,
   displacement, prices, health, hazard bulletins, field reports — degrades to a warning, never
   aborts the cycle) + placeholder rain/NDVI tiles.
2. **E3** (`stage_e3`) — news documents (bounded by bitemporal cutoff) → LLM signal extraction →
   `news_signals`, born `status='unconfirmed'`. On LLM failure, degrades to zero corroboration for
   every zone rather than failing the cycle.
3. **E4–E7** (`stage_e4_e7`, one Postgres transaction per zone) — build bitemporal `FeatureRow` →
   `RiskModel.assess()` → merge two independent corroboration channels via
   `dira_core.risk.merge_corroboration` (max, not sum — they corroborate the same tension, not stack)
   → `combine_scores()` (pure `model_risk` × news+field `corroboration`, weighted 0.7/0.3, with a
   corroboration bump above threshold) → open/resolve `situations` via hysteresis
   (`RESOLVE_AFTER_CYCLES_BELOW_THRESHOLD`) → upsert `assessments`.

The **combination rule is a plain string persisted on every assessment** (`combination_rule` column) —
never a black box. Verified field reports contribute via
`corroboration_from_field_reports`; unverified/dismissed reports contribute exactly 0, always (a red
line, not a bug).

### Dispatch

Human gate is a DB `CHECK` on `alerts` (`approved_by`/`approved_at` required) — the API's
`/alerts/{id}/approve` route inserts all recipient `deliveries` atomically in the same transaction that
flips the alert to `approved`. The dispatch daemon then claims deliveries in two short transactions
(claim → HTTP call *outside* any open transaction → write result) — no network calls inside open DB
transactions is a hard rule throughout this codebase. `idempotency_key` (our side) and
`provider_message_id` (provider side) are both `UNIQUE`; zombies (`sending` for
`ZOMBIE_TIMEOUT_MINUTES`) become `needs_review` with no auto-retry. Acks land via
`/webhooks/at/dtmf` and `/webhooks/at/status`, not the dispatch worker itself, and are idempotent
against repeated provider callbacks.

### Frontend

Multi-screen light-Carbon app (D-017, supersedes D-015): react-router routes **/** (map),
**/situations(/:id)**, **/zones(/:id)**, **/dispatch**, **/analytics**, **/sources**, built from
`src/screens/*` on shared primitives (`src/components/ui.tsx`, `charts.tsx`) and design tokens in
`index.css` (IBM Plex, white surfaces, `#0f62fe` accent, band palette in `lib/format.ts`).
The map (`src/features/map/`) uses the CARTO *light* basemap; `useMapLayers.ts` is the single
declarative source for layers: a base choropleth of all 22 zones from `/indicators/regional`
(overlays: pressure / IPC / displacement / incidents / hazards, switched via `stores/mapUi.ts`)
under situation point markers sized by `model_risk`. SSE (`lib/ssePatch.ts`) patches the TanStack
Query cache live from `/events` (Postgres LISTEN/NOTIFY relay) rather than polling; the single
EventSource lives in `App.tsx`. Charts follow the dataviz mark spec (≤24px bars, 2px lines,
hairline grids, official IPC colors, band colors reserved; never dual axes).

### Database

Alembic migrations live in `infra/alembic/versions/` (`0001_schema_v2.py` is the full Part-5 schema:
bitemporal `zone_climate_dekadal`, `v_map_situations` view, LISTEN/NOTIFY triggers; `0002` adds the
information layer). `infra/migrations/001_scaffold.sql` is the old pre-Alembic scaffold — dead, not
used by `make migrate`.

### IGAD zone coverage

22 zones across 9 clusters / 7 countries. Only the 6 Mandera zones (Kenya–Ethiopia–Somalia tri-border)
are the real protagonist cluster; the other 16 are deterministic synthetic fixtures generated by
`scripts/generate_igad_fixtures.py` (fixed seed — rerunning it is a no-op, not a re-randomization).
Don't treat non-Mandera geometries/timeseries as real data when debugging.
