#!/bin/bash
set -euxo pipefail
export AWS_REGION=af-south-1
export ARTIFACT_BUCKET=dira-igad-deploy-af-330420073176
export ARTIFACT_KEY=dira-igad-deploy.zip
export POSTGRES_PASSWORD=dira_demo_2026
export DATA_MODE=seeded
export DISPATCH_MODE=mock
exec > >(tee /var/log/dira-bootstrap.log) 2>&1
echo "[dira] force bootstrap start $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ensure docker/compose
if ! command -v docker >/dev/null; then
  dnf install -y docker
  systemctl enable --now docker
fi
mkdir -p /usr/local/lib/docker/cli-plugins
if [ ! -x /usr/local/lib/docker/cli-plugins/docker-compose ]; then
  curl -fsSL https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

aws s3 cp "s3://${ARTIFACT_BUCKET}/${ARTIFACT_KEY}" /tmp/dira.zip --region "$AWS_REGION"
rm -rf /opt/dira /tmp/dira-unpack
mkdir -p /tmp/dira-unpack /opt/dira
python3 -c "import zipfile; zipfile.ZipFile('/tmp/dira.zip').extractall('/tmp/dira-unpack'); print('extracted')"
cp -a /tmp/dira-unpack/. /opt/dira/

TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
PUBLIC_BASE_URL="http://${PUBLIC_IP}"

cat > /opt/dira/infra/deploy/.env <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATA_MODE=${DATA_MODE}
DISPATCH_MODE=${DISPATCH_MODE}
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
EOF

cd /opt/dira/infra/deploy
docker compose -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.prod.yml --env-file .env up -d db
for i in $(seq 1 60); do
  if docker compose -f docker-compose.prod.yml exec -T db pg_isready -U dira -d dira; then break; fi
  sleep 3
done

docker compose -f docker-compose.prod.yml --env-file .env --profile ops build ops
docker compose -f docker-compose.prod.yml --env-file .env --profile ops run --rm ops
docker compose -f docker-compose.prod.yml --env-file .env up -d

echo "[dira] force bootstrap done $(date -u +%Y-%m-%dT%H:%M:%SZ) url=${PUBLIC_BASE_URL}"
curl -sf "http://127.0.0.1/health" || true
docker compose -f docker-compose.prod.yml ps
