# Dira developer commands.
#
# These targets work against either a docker-compose Postgres or a local Postgres reachable
# via $DATABASE_URL (see DEVIATIONS.md §2 — the CI/dev box here has no Docker). The demo
# always runs in DATA_MODE=seeded and needs no external API keys.

SHELL := /bin/bash
export DATA_MODE ?= seeded

.PHONY: help install db db-up migrate seed test lint typecheck importlint demo pipeline api web clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Sync the uv workspace (all packages)
	uv sync --all-packages

db-up: ## Start the docker-compose Postgres (if Docker is available)
	docker compose -f infra/docker-compose.yml up -d db

migrate: ## Apply the schema (alembic upgrade head)
	uv run alembic upgrade head

seed: ## Bootstrap zones + load deterministic Mandera fixtures (idempotent)
	uv run python -m dira_worker.seed

test: ## Run the full test suite against a real Postgres
	uv run pytest -q

lint: ## Ruff lint
	uv run ruff check .

typecheck: ## mypy strict on dira_core and dira_features
	uv run mypy

importlint: ## Enforce the dependency rule
	uv run lint-imports

demo: ## Seeded end-to-end demo: seed + 3 historical cycles + mock ack
	uv run python -m dira_worker.demo

pipeline: ## Run one pipeline cycle: make pipeline CYCLE=2026-01-11
	uv run python -m dira_worker.pipeline --cycle $(CYCLE)

api: ## Run the API
	uv run uvicorn dira_api.main:app --host 0.0.0.0 --port 8000

web: ## Run the web dev server
	npm --prefix apps/web run dev -- --host 0.0.0.0

clean: ## Drop derived artifacts (tiles, generated audio)
	rm -rf apps/api/static/tiles/* data/generated/* 2>/dev/null || true
