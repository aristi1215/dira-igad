#!/bin/bash
set -euxo pipefail
exec > >(tee -a /var/log/dira-bootstrap.log) 2>&1
echo "[dira] recover start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
cd /opt/dira/infra/deploy

# Ensure env file exists
if [ ! -f .env ]; then
  TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
  PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
  cat > .env <<EOF
POSTGRES_PASSWORD=dira_demo_2026
DATA_MODE=seeded
DISPATCH_MODE=mock
PUBLIC_BASE_URL=http://${PUBLIC_IP}
SEEDED_DATA_DIR=/app/data/seeded
EOF
else
  grep -q SEEDED_DATA_DIR .env || echo 'SEEDED_DATA_DIR=/app/data/seeded' >> .env
fi

docker compose -f docker-compose.prod.yml --env-file .env up -d db
docker compose -f docker-compose.prod.yml --env-file .env --profile ops run --rm \
  -e SEEDED_DATA_DIR=/app/data/seeded \
  -e DATA_MODE=seeded \
  ops bash -lc 'python -m scripts.demo'

docker compose -f docker-compose.prod.yml --env-file .env up -d
sleep 5
docker compose -f docker-compose.prod.yml ps
curl -sf http://127.0.0.1/health || curl -sf http://127.0.0.1:80/health || true
echo "[dira] recover done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
