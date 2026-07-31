# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Dira is a causal situation room for the Horn of Africa (IGAD Husika Hackathon 2026): it turns
climate/conflict data into risk assessments per zone, drafts human-gated voice alerts, and dispatches
them via voice dispatch (Twilio migration underway; mock in seeded mode). Full architecture, safety red lines, and the
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
packages/dira_dispatch   MockDispatcher (seeded), legacy AT adapter; Twilio replacing AT (D-016), tts.py
```

### `DATA_MODE=seeded|live`

Swaps every data/LLM/dispatch adapter at once **and** which Postgres database is used
(`DATABASE_URL_SEEDED` → `dira`, `DATABASE_URL_LIVE` → `dira_live` on the same Compose
instance). **Seeded is deterministic and network-free** — LLM calls use
`CannedResponseAdapter`, conflict/hazard data comes from `data/seeded/`, dispatch uses
`MockDispatcher`. The demo (`make demo`) always runs seeded; running the same `--cycle` twice must
produce identical final state (`stage_e3` fully re-derives that cycle's `news_signals` each run; E4–E7
upserts are idempotent per zone×cycle). Live ops: `make live-bootstrap`, `make live-sync`,
`make backfill-climate` (needs `EE_PROJECT`); never share climate/news state with seeded.

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
`/webhooks/twilio/gather` and `/webhooks/twilio/status`, not the dispatch worker itself, and are idempotent
against repeated provider callbacks.

The gate can also say **no**: `/alerts/{id}/reject` moves `pending_approval → rejected` and queues
nothing, guarded by `alerts_rejection_chk`, the mirror of `alerts_human_gate_chk`. Approval records
`approved_body_sha256` so an edit landing after approval is detectable.

**Who gets an alert** is decided by one rule in one place — `_default_recipients` in
`apps/api/dira_api/main.py`, exposed as `GET /alerts/{id}/recipients` so the dispatch screen renders
the server's answer instead of recomputing it. It dedupes by phone (zone-specific beats all-zones;
widest channel wins; a re-registration beats an older row). `approve` takes an optional
`recipient_ids` list — omitted means that default set, a list is used verbatim and may include
contacts outside the alert's zone. An empty list is a 422 pointing at reject.

**What each person hears** comes from `alert_variants` (language × optional role), resolved by the
pure `resolve_alert_body` in `dira_core.alerts` and frozen onto `deliveries.body_text` **at approval
time, not dispatch time** — the approver is accountable for the exact string, so a later edit must
not change it underneath them. `alerts.body_text` is the last-resort rung, so an alert with no
variants behaves exactly as before variants existed. `ResolvedBody.is_fallback` means *nobody wrote
anything in this recipient's language*, deliberately not "no variant row matched": a Swahili speaker
receiving a Swahili alert is served correctly, and a warning that is always on is not a warning.

Voice language reaches the provider through `SAY_VOICES` in `dira_dispatch.twilio_adapter`. Twilio
`<Say>` has no voice for Somali or Amharic; those degrade to English **with a logged warning** —
the silent degrade is the bug that hid the hardcoded `sw-KE` for so long.

### Frontend

Multi-screen Apple-reskinned app (D-021, restyles D-017; do not revert to the flat light-Carbon
look): react-router routes **/** (map), **/situations(/:id)**, **/zones(/:id)**, **/dispatch**,
**/analytics**, **/model**, **/sources**. `App.tsx` is routing only; the chrome (command bar with
the dark-mode sun/moon toggle, the single SSE EventSource, the advisor `Sheet`, the tour) lives in
`src/layouts/AppLayout.tsx`, and the five chart-heavy screens are `React.lazy`-loaded so the map
route does not pay for recharts.

Type is **Geist and nothing else** (Google Fonts). There is deliberately **no monospaced family** —
numerals are set in Geist with `tabular-nums`, and `--font-mono` is aliased to the sans stack so a
stray `font-mono` cannot fall through to Tailwind's default. Because Preflight is off, `@layer base`
sets `font-family` on `html` **explicitly**; without that line the whole app renders in the UA serif.

Every screen composes the `Bento` primitive (`BentoGrid`/`BentoCard`/`BentoSpan`,
`src/components/ui/Bento.tsx`); motion uses `motion/react` (never `framer-motion`) with tokens in
`src/lib/motion.ts` (`EASE`; panel/spotlight spring `stiffness 380 / damping 32`). Dates use the
shared `DateStamp` treatment. **Dark mode** (D-022) is a `@custom-variant dark` + `html.dark`
semantic-token override, persisted via `stores/theme.ts` with an OS fallback and a pre-paint init
script in `index.html`; band/IPC palettes are NOT redefined in dark and stay byte-identical (guarded
by `lib/tokens.test.ts`).

`cx` (`src/lib/cx.ts`) is a **configured tailwind-merge**, not a join: it resolves same-property
conflicts so a `className` prop actually overrides a primitive's own utility. Every custom token
outside a Tailwind namespace needs a `classGroups` entry — an unrecognised `text-*` is read as a
*color* and would silently drop `text-eyebrow`. `cx.test.ts` guards it.

`App.css` has been **deleted** (D-021) — all styling is Tailwind utilities; do not reintroduce it.

Styling is **Tailwind v4**, configured entirely in `src/index.css`. Two things there are load-bearing:

- **Layer order is `theme, base, vendor, components, utilities`.** `maplibre-gl.css` is imported
  *into* the `vendor` layer. Unlayered CSS beats every layered rule regardless of specificity, so an
  unlayered `.maplibregl-map { position: relative }` silently overrides Tailwind's `absolute` and
  collapses the map container to zero height.
- **Preflight is disabled**; `@layer base` in `index.css` supplies a minimal stand-in. Consequences:
  always write `border border-line`, never a bare `border`; and the stand-in must set
  `font-family` on `html` itself, because nothing else will.
- **Tailwind v4 has no `--z-*` theme namespace.** Declaring `--z-drawer: 45` in `@theme` publishes
  the custom property but generates no class. The named layers are therefore declared with explicit
  `@utility z-<name>` rules against those tokens, and `lib/zScale.test.ts` asserts the two lists stay
  in step. The same caveat applies to any future scale outside Tailwind's own namespaces.

> **Variable class names must come from an explicit `Record<K, string>` of full literal class
> names** (see `components/ui/Chips.tsx`). Tailwind's scanner cannot see `` `bg-band-${band}` `` and
> the class simply never gets generated — it fails silently, with no build error.
>
> The general lesson: this codebase has shipped several classes that generate **no CSS at all**. When
> a style mysteriously does nothing, `npm run build` and grep `dist/assets/*.css` for the selector
> before assuming a specificity problem.

Band and IPC fills are theme-invariant by design, so the ink on them must be too: use `bandInk` /
`ipcInk` from `lib/format.ts`, never the semantic `text-ink`, which inverts in dark mode.
Chart *chrome* (gridlines, axis ink, empty cells) is the opposite — it carries no meaning and must
follow the theme, so it lives in `lib/chartChrome.ts` and is read per render via `useChartChrome()`.
`BentoCard tone="inverse"` is the one hero tile per screen; it applies `.tone-inverse`, which
re-points the semantic tokens for its subtree so ordinary `text-muted`/`border-line` descendants work
inside it unchanged.

Primitives live in `src/components/ui/` (Button, Field/Select, Tabs, DataTable, Skeleton, Tooltip,
Sheet, Meter, Stat, Card, Chips, Callout, Bento, DateStamp, Eyebrow). Band/IPC palettes are
duplicated by necessity in `@theme` (for Tailwind) and `lib/format.ts` (for MapLibre paint
expressions and recharts); `src/lib/tokens.test.ts` asserts the two agree and that dark mode does not
redefine them.

The map (`src/features/map/`) loads CARTO's key-less **vector** Positron style, tuned in place by
`basemap.ts` (hide competing detail, mute water, insert data layers `beforeId` the first symbol
layer so place labels stay above the choropleth), with the raster style kept as an offline fallback.
`useMapLayers.ts` is the single declarative source for layers: a choropleth of all 22 zones from
`/indicators/regional` under near-constant-size situation markers, with hover, selection and band
filtering expressed as **`feature-state`** (the source uses `promoteId: 'zone_id'`) rather than extra
filtered layers. Zone selection and the active overlay live in the **URL** (`useSelectedZone.ts`), so
a view is shareable; `stores/mapUi.ts` keeps only viewport, hover and band filter.

Charts follow the dataviz mark spec (≤24px bars, 2px lines, hairline grids, official IPC colors,
band colors reserved; never dual axes). SSE (`lib/ssePatch.ts`) patches the TanStack Query cache
live from `/events` rather than polling.

The onboarding tour (`src/features/tour/`) is an anchored spotlight that navigates between routes.
It finds targets via `data-tour="…"` attributes declared in `tourAnchors.ts`; a deleted attribute
would silently skip a step, so `tourSteps.test.ts` asserts every anchor is actually rendered.

**The React Compiler is enabled.** Do not write refs during render, and be careful with `useMemo`
whose body does not reference all its declared deps — the compiler may treat it as depending only on
what it actually reads and cache the first result forever. Imperative cache reads belong in effects.

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
