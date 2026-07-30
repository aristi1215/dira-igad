.PHONY: lint test seed embed demo pulse migrate migrate-live up-db down-db sync ensure-db ensure-live-db live-bootstrap live-sync backfill-climate

UV ?= uv
COMPOSE ?= docker compose -f infra/docker-compose.yml
export DATABASE_URL_SEEDED ?= postgresql://dira:dira@localhost:55432/dira
export DATABASE_URL_LIVE ?= postgresql://dira:dira@localhost:55432/dira_live
export DATA_MODE ?= seeded
# Legacy single-URL tools fall back to the seeded DB unless DATA_MODE=live.
export DATABASE_URL ?= $(DATABASE_URL_SEEDED)

sync:
	$(UV) sync --all-packages
	cd apps/web && npm install

# Prefer Docker Compose DB; fall back to whatever answers on DATABASE_URL
# (local Postgres+PostGIS+pgvector) when Docker overlay builds fail (D-008).
up-db:
	@if $(COMPOSE) up -d db 2>/tmp/dira-compose.err; then \
	  echo "Waiting for Compose Postgres..."; \
	  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do \
	    $(COMPOSE) exec -T db pg_isready -U dira -d dira && exit 0; \
	    sleep 2; \
	  done; \
	else \
	  echo "Compose DB unavailable; using DATABASE_URL=$(DATABASE_URL)"; \
	  pg_isready -d "$(DATABASE_URL)" || pg_isready -h localhost -p 5432; \
	fi

down-db:
	-$(COMPOSE) down

ensure-db: up-db

migrate: ensure-db
	DATABASE_URL=$(DATABASE_URL_SEEDED) $(UV) run alembic -c infra/alembic.ini upgrade head

ensure-live-db: ensure-db
	DATABASE_URL_SEEDED=$(DATABASE_URL_SEEDED) $(UV) run python -m scripts.ensure_live_db

migrate-live: ensure-live-db
	DATABASE_URL=$(DATABASE_URL_LIVE) $(UV) run alembic -c infra/alembic.ini upgrade head

# Reference tables only on dira_live (zones/adjacency/exposure/recipients).
live-bootstrap: migrate-live
	DATABASE_URL=$(DATABASE_URL_LIVE) $(UV) run python -m scripts.bootstrap --reference-only --database-url "$(DATABASE_URL_LIVE)"
	@echo "Live DB ready for backfill (dira_live). Seeded demo DB unchanged."

live-sync: live-bootstrap
	DATA_MODE=live DATABASE_URL=$(DATABASE_URL_LIVE) $(UV) run python -m scripts.live_sync --database-url "$(DATABASE_URL_LIVE)"

backfill-climate: live-bootstrap
	DATA_MODE=live EE_PROJECT=$${EE_PROJECT} $(UV) run python -m scripts.backfill_climate --database-url "$(DATABASE_URL_LIVE)" --gee-rain

lint:
	$(UV) run ruff check packages apps/api apps/worker scripts tests infra/alembic
	$(UV) run mypy
	$(UV) run lint-imports --config importlinter.ini

test:
	$(UV) run pytest -q

seed: migrate
	DATABASE_URL=$(DATABASE_URL_SEEDED) $(UV) run python -m scripts.bootstrap --database-url "$(DATABASE_URL_SEEDED)"
	@echo "Seed complete (seeded DB only)."

embed:
	$(UV) run python -m scripts.embed_corpus

demo: seed embed
	$(UV) run python -m scripts.demo
	@echo "Demo ready (seeded). Start API + web + dispatch for the live script."

# Long-running seeded feeder that makes the UI visibly evolve during a demo.
# Requires the API to be up; refuses to run outside DATA_MODE=seeded.
pulse:
	$(UV) run python -m scripts.demo_pulse
