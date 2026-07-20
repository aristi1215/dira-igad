# Implementation brief (for the coding agent)

This repo is **scaffolded only**. Do not assume pipeline, ML, map, or dispatch logic exist.

Authoritative product/tech spec: consolidated Dira v2 (IGAD Husika 2026). On conflict, the consolidated spec wins.

## What is already done

- Monorepo layout (`apps/*`, `packages/*`, `infra/`, `data/seeded/`, `artifacts/`)
- `dira_core.ports` Protocols + domain enum stubs
- FastAPI `/health` shell + settings
- Worker entrypoints that exit 1 (scaffold)
- React + Query + Zustand shell + feature folders
- docker-compose for PostGIS, Dockerfiles, `.env.example`
- English README documenting architecture and safety guarantees

## What you must implement

### Database

Replace `infra/migrations/001_scaffold.sql` with the **full Part 5 schema** (bitemporal `zone_climate_dekadal`, human-gate CHECK, `uq_assessment_per_cycle`, `needs_review` + `claimed_at`, LISTEN/NOTIFY triggers, `v_map_situations`). Prefer an image that supports both PostGIS and pgvector.

### Pipeline (7 stages, corrected order)

`python -m dira_worker.pipeline --cycle YYYY-MM-DD`

1. Download (seeded = disk)
2. Zonal stats + PNG tiles (first-write-wins upsert)
3. News → signals (LLM degradable; never abort pipeline)
4. Features via `dira_features` (bitemporal cut; in-memory)
5. Predict (3 outputs + SHAP; in-memory)
6. Combine + explain (written rule; template fallback; in-memory)
7. Write storefront — **one transaction per zone, writes only**

**Mandatory test:** same `--cycle` twice → identical final state.

### Dispatch daemon

Two short transactions; HTTP outside both. Zombies → `needs_review`. Ack webhook on API validates `provider_message_id`.

### Frontend

MapLibre regional + Mandera zoom; layers via declarative `useMapLayers`; Tabiri cards; advisor; dispatch panel; SSE → Query patch.

### ML / LLM

LightGBM + three honest baselines; TransparentIndex fallback; do-not-harm prompt tests; local BGE-M3 embeddings (1024).

Install optional extras when needed:

```bash
uv sync --extra explain --package dira-ml    # SHAP (needs compatible numba/llvmlite)
uv sync --extra rasters --package dira-data  # rasterio for CHIRPS/NDVI tiling
```

## Priority

One impeccable end-to-end slice (Mandera, seeded) beats incomplete breadth. Demo video always against `DATA_MODE=seeded`.
