#!/bin/bash
set -e
# Best-effort pgvector install inside stock PostGIS image.
# If the package is unavailable, Alembic will still fail clearly on CREATE EXTENSION vector.
apt-get update
apt-get install -y --no-install-recommends postgresql-16-pgvector || true
