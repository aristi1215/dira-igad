# AGENTS.md

## Cursor Cloud specific instructions

Dira is a fully implemented modular monorepo (not a scaffold — see `CLAUDE.md` and
`DEVIATIONS.md` for what changed and why). All four services below run today.

### Services

| Service | Location | Run (dev) | State |
|---------|----------|-----------|-------|
| API (FastAPI) | `apps/api` | `uv run uvicorn dira_api.main:app --reload --port 8000` | Full REST + SSE + webhooks — see `apps/api/dira_api/main.py`, `context_routes.py` |
| Web (React+Vite) | `apps/web` | `npm --prefix apps/web run dev` (add `-- --host 0.0.0.0`) | Multi-screen situation room, light Carbon style (react-router: Map / Situations / Zones / Dispatch / Analytics / Sources; MapLibre, TanStack Query, Zustand, recharts) |
| Worker — pipeline | `apps/worker` | `uv run python -m dira_worker.pipeline --cycle YYYY-MM-DD` | Runs the E1–E7 dekadal cycle end-to-end; day must be 1/11/21 |
| Worker — dispatch | `apps/worker` | `uv run python -m dira_worker.dispatch` | LISTEN/NOTIFY + 30s poll daemon; `DISPATCH_MODE=mock` by default (Africa's Talking wired but sandbox key rejected — D-016) |
| DB (Postgres+PostGIS+pgvector) | `infra/docker-compose.yml` | `docker compose -f infra/docker-compose.yml up -d db` | Required — everything above connects to it; schema applied via Alembic, not init scripts |

- API docs / manual testing: `http://localhost:8000/docs` (Swagger). Web dev server: `http://localhost:5173`.
- `scripts/bootstrap.py` seeds zones/adjacency/exposure/fixtures; `scripts/train.py` trains the
  LightGBM model card; `scripts/demo.py` runs bootstrap + 3 pipeline cycles. None of these are stubs.
- `make seed && make demo` is the one-shot path (see `Makefile`); it's idempotent — running it twice
  produces the same final storefront state.

### Python workspace (uv)

- This is a **uv workspace with 8 members**. Plain `uv run`/`uv sync` only installs the root
  dev group; you MUST use `uv sync --all-packages` to install the workspace member packages
  (fastapi, uvicorn, lightgbm, etc.). This is the most common setup gotcha here.
- `uv` is installed at `$HOME/.local/bin` and added to PATH via `~/.bashrc`.
- Optional extras (only when the task needs them): `uv sync --extra explain --package dira-ml` (SHAP),
  `uv sync --extra rasters --package dira-data` (rasterio for CHIRPS/NDVI tiling).

### Lint / test / build

- Python lint: `uv run ruff check .` (or `make lint`, which also runs mypy on `dira_core`/`dira_features`
  and `lint-imports`) — Python tests: `uv run pytest -q` (or `make test`).
- Integration tests require a **real Postgres** reachable via `DATABASE_URL` with the schema already
  migrated; they skip (not fail) when either is missing. They never use SQLite.
- Web lint: `npm --prefix apps/web run lint` — Web tests: `npm --prefix apps/web run test` (vitest) —
  Web build: `npm --prefix apps/web run build`.

### Env

- Copy `.env.example` to `.env`. Keep `DATA_MODE=seeded` for local work — it's deterministic and
  network-free (canned LLM responses, seeded conflict/hazard data, `MockDispatcher`). All live-mode
  secrets (OpenAI/Anthropic, ACLED, HDX, Africa's Talking, TTS) are optional in seeded mode.
- Default `DATABASE_URL` in `.env.example` points at host port `55432` (Compose maps it there to avoid
  clashing with a local Postgres on 5432–5434).
