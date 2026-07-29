#!/bin/bash
set -euxo pipefail
exec > >(tee /var/log/dira-userdata.log) 2>&1
export AWS_REGION=af-south-1
export ARTIFACT_BUCKET=dira-igad-deploy-af-330420073176
export ARTIFACT_KEY=dira-igad-deploy.zip
export POSTGRES_PASSWORD=dira_demo_2026
export DATA_MODE=seeded
export DISPATCH_MODE=mock
echo "[dira] userdata start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
dnf install -y docker unzip
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
mkdir -p /opt/dira
aws s3 cp "s3://${ARTIFACT_BUCKET}/${ARTIFACT_KEY}" /tmp/dira.zip --region "$AWS_REGION"
rm -rf /tmp/dira-unpack && mkdir -p /tmp/dira-unpack
python3 -c "import zipfile; zipfile.ZipFile('/tmp/dira.zip').extractall('/tmp/dira-unpack'); print('extracted ok')"
rm -rf /opt/dira/*
cp -a /tmp/dira-unpack/. /opt/dira/
ls -la /opt/dira/infra/deploy/
chmod +x /opt/dira/infra/deploy/bootstrap.sh
bash /opt/dira/infra/deploy/bootstrap.sh
echo "[dira] userdata done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
