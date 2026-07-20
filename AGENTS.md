# AGENTS.md

## Cursor Cloud specific instructions

Dira is a scaffolded modular monorepo. Business logic, pipeline stages, ML training,
and live adapters are **not** implemented yet (see `docs/IMPLEMENTATION.md`). Only two
services actually run today; the rest are intentional stubs.

### Services

| Service | Location | Run (dev) | State |
|---------|----------|-----------|-------|
| API (FastAPI) | `apps/api` | `uv run uvicorn dira_api.main:app --reload --port 8000` | Runnable — only `/health` exists |
| Web (React+Vite) | `apps/web` | `npm --prefix apps/web run dev` (add `-- --host 0.0.0.0`) | Runnable — static shell only |
| Worker (pipeline/dispatch) | `apps/worker` | `python -m dira_worker.pipeline` / `.dispatch` | Scaffold — **intentionally `exit(1)`**, do not treat as broken |
| DB (Postgres+PostGIS) | `infra/docker-compose.yml` | `docker compose -f infra/docker-compose.yml up -d db` | Optional — **nothing in the current code connects to it**; Docker is not preinstalled |

- API docs / manual testing: `http://localhost:8000/docs` (Swagger). Web dev server: `http://localhost:5173`.
- `scripts/bootstrap.py` and `scripts/train.py` are stubs that `exit(1)` by design.

### Python workspace (uv)

- This is a **uv workspace with 8 members**. Plain `uv run`/`uv sync` only installs the root
  dev group; you MUST use `uv sync --all-packages` to install the workspace member packages
  (fastapi, uvicorn, lightgbm, etc.). This is the most common setup gotcha here.
- `uv` is installed at `$HOME/.local/bin` and added to PATH via `~/.bashrc`.

### Lint / test / build

- Python lint: `uv run ruff check .` — Python tests: `uv run pytest` (0 tests exist yet; collection succeeds).
- `uv run mypy` prints a `dira_core ... missing py.typed marker` note; this is a scaffold
  limitation, not a code error.
- Web lint: `npm --prefix apps/web run lint` — Web build: `npm --prefix apps/web run build`.

### Env

- Copy `.env.example` to `.env`. Keep `DATA_MODE=seeded` for local work. All live-mode
  secrets (Anthropic, ACLED, Africa's Talking, TTS) are optional in seeded mode.
