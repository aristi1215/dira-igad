#!/bin/bash
set -euxo pipefail
exec > >(tee -a /var/log/dira-bootstrap.log) 2>&1
echo "[dira] recover2 start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
cd /opt/dira/infra/deploy
grep -q SEEDED_DATA_DIR .env || echo 'SEEDED_DATA_DIR=/app/data/seeded' >> .env

docker compose -f docker-compose.prod.yml --env-file .env up -d db

# Mount host seeded data onto the path site-packages resolves (ROOT/data/seeded).
docker compose -f docker-compose.prod.yml --env-file .env --profile ops run --rm \
  -e SEEDED_DATA_DIR=/app/data/seeded \
  -e DATA_MODE=seeded \
  -v /opt/dira/data:/usr/local/lib/data \
  -v /opt/dira/artifacts:/usr/local/lib/artifacts \
  ops bash -lc 'python -m scripts.demo'

docker compose -f docker-compose.prod.yml --env-file .env up -d
sleep 8
docker compose -f docker-compose.prod.yml ps
curl -sv http://127.0.0.1/health || true
curl -sf http://127.0.0.1/map/situations | head -c 200 || true
echo
echo "[dira] recover2 done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
