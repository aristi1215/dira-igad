#!/bin/bash
set -euo pipefail

REGION="${AWS_REGION:-eu-central-1}"
APP_DIR="/opt/dira"
ARTIFACT_BUCKET="${ARTIFACT_BUCKET}"
ARTIFACT_KEY="${ARTIFACT_KEY:-dira-igad-deploy.zip}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-dira_demo_2026}"
DATA_MODE="${DATA_MODE:-seeded}"
DISPATCH_MODE="${DISPATCH_MODE:-mock}"

exec > >(tee /var/log/dira-bootstrap.log) 2>&1
echo "[dira] bootstrap start $(date -u +%Y-%m-%dT%H:%M:%SZ)"

dnf update -y
dnf install -y docker git unzip
systemctl enable --now docker
usermod -aG docker ec2-user || true

# Compose plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose

mkdir -p "$APP_DIR"
cd /tmp
aws s3 cp "s3://${ARTIFACT_BUCKET}/${ARTIFACT_KEY}" ./dira.zip --region "$REGION"
rm -rf "$APP_DIR"/*
unzip -q dira.zip -d "$APP_DIR"
cd "$APP_DIR"

# Resolve public IP for PUBLIC_BASE_URL
TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" || true)
if [ -n "${TOKEN:-}" ]; then
  PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
else
  PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
fi
PUBLIC_BASE_URL="http://${PUBLIC_IP}"

cat > infra/deploy/.env <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATA_MODE=${DATA_MODE}
DISPATCH_MODE=${DISPATCH_MODE}
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
OPENAI_MODEL=${OPENAI_MODEL:-gpt-4o-mini}
ACLED_EMAIL=${ACLED_EMAIL:-}
ACLED_PASSWORD=${ACLED_PASSWORD:-}
HDX_APP_IDENTIFIER=${HDX_APP_IDENTIFIER:-}
HDX_APP_ENCODED=${HDX_APP_ENCODED:-}
TTS_PROVIDER=${TTS_PROVIDER:-elevenlabs}
TTS_API_KEY=${TTS_API_KEY:-}
TTS_VOICE_ID=${TTS_VOICE_ID:-}
TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID:-}
TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN:-}
TWILIO_API_KEY_SID=${TWILIO_API_KEY_SID:-}
TWILIO_API_KEY_SECRET=${TWILIO_API_KEY_SECRET:-}
TWILIO_FROM_NUMBER=${TWILIO_FROM_NUMBER:-}
EOF

cd infra/deploy
docker compose -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.prod.yml --env-file .env up -d db
echo "[dira] waiting for postgres..."
for i in $(seq 1 60); do
  if docker compose -f docker-compose.prod.yml exec -T db pg_isready -U dira -d dira; then
    break
  fi
  sleep 3
done

docker compose -f docker-compose.prod.yml --env-file .env --profile ops build ops
docker compose -f docker-compose.prod.yml --env-file .env --profile ops run --rm ops

docker compose -f docker-compose.prod.yml --env-file .env up -d
echo "[dira] bootstrap complete $(date -u +%Y-%m-%dT%H:%M:%SZ) url=${PUBLIC_BASE_URL}"
curl -sf "${PUBLIC_BASE_URL}/health" || curl -sf "http://127.0.0.1/health" || true
