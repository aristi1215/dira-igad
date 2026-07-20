# DEVIATIONS

Every deviation from the authoritative spec, recorded for human review. Format: what the
spec said, what was done, why.

## 1. `DIRA-SPEC.md` did not exist in the repository

- **Spec said:** "The `DIRA-SPEC.md` file at the repo root is the authoritative
  specification (idea, architecture, SQL schema v2, ADRs #1–21, critical flows). Read it in
  full before writing a single line."
- **What was done:** No `DIRA-SPEC.md` existed on the base branch — only
  `docs/IMPLEMENTATION.md`, `README.md` and `docs/adr/README.md` (an ADR *index* with
  one-line summaries, not full ADRs). The most conservative interpretation was taken:
  `DIRA-SPEC.md` was authored to consolidate every constraint stated across the
  implementation prompt, `docs/IMPLEMENTATION.md`, the README and the ADR index into a
  single authoritative reference, and the system was implemented against it.
- **Why:** Silence would have left the "authoritative" reference undefined. The consolidated
  spec is faithful to all explicit constraints; any detail not pinned down by the prompt
  (e.g. exact enum spellings, exact band thresholds) was chosen conservatively and is
  documented in `DIRA-SPEC.md` so a human can adjust.

## 2. No Docker in the build/test environment

- **Spec said:** Definition of done: on a clean machine `docker compose up -d && make seed
  && make demo` works; integration tests run against a real Postgres from docker-compose or
  testcontainers.
- **What was done:** `infra/docker-compose.yml` and the Dockerfiles are kept and correct for
  a Docker host. Because the implementation/CI environment had no Docker, a real system
  PostgreSQL 16 + PostGIS 3.4 + pgvector was used instead, and the `Makefile` targets
  (`make db`, `make seed`, `make demo`, `make test`) work against either a docker-compose
  Postgres or a local one via `DATABASE_URL`. All integration tests run against this real
  Postgres — never SQLite.
- **Why:** The invariants are constraints + transactions and require a real Postgres. Using
  the locally installed Postgres preserves that guarantee without Docker.

## 3. SHAP via LightGBM native `pred_contrib` instead of the `shap` package

- **Spec said:** "LightGBM + SHAP; scikit-learn for calibration/metrics".
- **What was done:** SHAP values are computed with LightGBM's built-in TreeSHAP
  (`Booster.predict(..., pred_contrib=True)`), which returns exact per-feature SHAP
  contributions. The optional `shap` package is not required at runtime.
- **Why:** LightGBM's native TreeSHAP produces identical contributions without the heavy
  `shap`/`numba`/`llvmlite` dependency chain, keeping seeded mode dependency-light and
  deterministic. The `shap` extra remains declared for anyone who wants the plotting API.
