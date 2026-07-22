# Deviations from DIRA-SPEC.md

This file records honest deviations from the authoritative specification for human review.

## D-001 — Authoritative spec file missing from repository

**Spec said:** `DIRA-SPEC.md` at the repo root is authoritative (idea, architecture, SQL schema v2, ADRs #1–21, critical flows).

**What we did:** The file was not present in `main` at implementation start. We reconstructed `DIRA-SPEC.md` from the long-horizon implementation prompt, the scaffold README/ADR index, and `docs/IMPLEMENTATION.md`, choosing the most conservative interpretation wherever details conflicted.

**Why:** Implementation cannot proceed without a concrete schema and domain contract. The reconstruction is marked as reconstructed and must be reviewed against the original consolidated Dira v2 document when available.

## D-002 — Situation status enum (scaffold vs storefront lifecycle)

**Spec / scaffold tension:** The scaffold `SituationStatus` enum included alert-like states (`approved`, `dispatching`, `dispatched`, `acknowledged`). Milestone M5 describes situations as open assessment threads that resolve after N cycles below threshold (or are dismissed by a human).

**What we did:** Situations use `open | resolved | dismissed`. Alert delivery lifecycle lives on `alerts` / `deliveries`.

**Why:** Preserves the storefront model (one open situation per zone×hazard, assessments per cycle) without conflating human-gated dispatch with situation threading.

## D-003 — React version

**Spec said:** React 18.

**What we did:** Kept the scaffold’s React 19 + Vite 8 toolchain.

**Why:** Avoid unnecessary downgrade churn; TypeScript strictness and Query/Zustand patterns are unchanged.

## D-004 — Pipeline module path

**Spec said:** `python -m dira.worker.pipeline` (prompt) and also `python -m dira_worker.pipeline` (scaffold/README).

**What we did:** Kept `python -m dira_worker.pipeline` / `dira_worker.dispatch` to match the installed package layout.

**Why:** Matches the existing monorepo packaging; functionally identical.

## D-005 — Postgres image for PostGIS + pgvector

**Spec said:** PostgreSQL 16 + PostGIS 3.4 + pgvector.

**What we did:** Custom `infra/Dockerfile.db` based on `postgis/postgis:16-3.4` installing `postgresql-16-pgvector`.

**Why:** No single official image ships both extensions reliably for local compose.

## D-006 — Seeded rasters are synthetic dekadal grids

**Spec said:** Cropped real CHIRPS/NDVI rasters for Mandera.

**What we did:** Deterministic GeoTIFF-like numeric grids (and/or pre-aggregated zonal climate CSV) generated for Mandera zones so `DATA_MODE=seeded` needs no network.

**Why:** Real multi-year raster archives are too large for the scaffold; bitemporal `available_at` semantics and first-write-wins upserts are preserved.

## D-007 — Do-not-harm content test is a minimum net

**Spec said:** Programmatic check against forbidden actor/group terms from the seeded ACLED extract; document honesty.

**What we did:** Exactly that — term list derived from seeded ACLED actor fields; not a linguistic guarantee.

**Why:** Matches the prompt’s honesty requirement.

## D-008 — Docker image build / overlay whiteouts on Cloud VM

**Spec said:** `docker compose up -d db` with PostGIS + pgvector.

**What we did:** Custom `Dockerfile.db` and `docker pull` of pgvector images fail on this Cloud VM with `failed to convert whiteout file ... operation not permitted`. Development/tests use a local PostgreSQL 16 with `postgresql-16-postgis-3` + `postgresql-16-pgvector` apt packages. Compose still documents the intended PostGIS service for machines where Docker overlay works. `make up-db` falls back to `DATABASE_URL` when Compose fails.

**Why:** Cannot complete the mission if blocked solely on Docker storage driver limits; schema and invariants are identical against real Postgres.

## D-009 — Seeded demo pins TransparentIndex as active model

**Spec said:** LightGBM + three baselines; TransparentIndex as registrable fallback.

**What we did:** `make demo` still trains LightGBM for the model card, then activates `transparent_v1` for inference so Mandera drought stress reliably opens high/very_high situations for the demo script.

**Why:** A freshly trained LightGBM on the short seeded history scored bands too low to open situations, leaving `v_map_situations` empty and breaking the red→green demo.
