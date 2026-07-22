.PHONY: lint test seed demo migrate up-db down-db sync ensure-db

UV ?= uv
COMPOSE ?= docker compose -f infra/docker-compose.yml
export DATABASE_URL ?= postgresql://dira:dira@localhost:5432/dira
export DATA_MODE ?= seeded

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
	$(UV) run alembic -c infra/alembic.ini upgrade head

lint:
	$(UV) run ruff check packages apps/api apps/worker scripts tests infra/alembic
	$(UV) run mypy
	$(UV) run lint-imports --config importlinter.ini

test:
	$(UV) run pytest -q

seed: migrate
	$(UV) run python -m scripts.bootstrap
	@echo "Seed complete."

demo: seed
	$(UV) run python -m scripts.demo
	@echo "Demo ready (seeded). Start API + web + dispatch for the live script."
