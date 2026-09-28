#!/bin/sh
# Sets up the hosted demo on a fresh Ubuntu server (docs/guide/oracle.md): Docker, the repository
# in /opt/ecomanage, infra/deploy/.env with new secrets, the stack, the demo data, and a nightly
# reset of the demo. Safe to run again: it keeps the .env and the data, and updates the rest.
#
#   curl -fsSL https://raw.githubusercontent.com/e-choness/eco-manage/main/infra/deploy/setup.sh \
#     | sudo PUBLIC_URL=https://demo.example.com TUNNEL_TOKEN=… sh
#
# Without TUNNEL_TOKEN it starts a quick tunnel and prints its trycloudflare.com address.
set -eu

REPO=${REPO:-https://github.com/e-choness/eco-manage.git}
BRANCH=${BRANCH:-main}
DIR=${DIR:-/opt/ecomanage}

[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }

# Oracle's images have no swap; on a small instance a 2 GB swap file covers model conversions
# and PDF rendering running at once.
if [ "$(awk '/MemTotal/ {print int($2 / 1048576)}' /proc/meminfo)" -lt 8 ] && ! swapon --show | grep -q .; then
  echo "== Swap (2 GB)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "== Docker"
  curl -fsSL https://get.docker.com | sh
fi

echo "== Repository ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/infra/deploy"

if [ ! -f .env ]; then
  echo "== infra/deploy/.env"
  secret() { openssl rand -hex 32; }
  sed -e "s|^PUBLIC_URL=.*|PUBLIC_URL=${PUBLIC_URL:-http://localhost:8080}|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=$(secret)|" \
      -e "s|^REFRESH_TOKEN_SECRET=.*|REFRESH_TOKEN_SECRET=$(secret)|" \
      -e "s|^SECRETS_KEY=.*|SECRETS_KEY=$(secret)|" \
      -e "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(secret)|" \
      -e "s|^TUNNEL_TOKEN=.*|TUNNEL_TOKEN=${TUNNEL_TOKEN:-}|" \
      .env.example > .env
  chmod 600 .env
fi

tunnel=quick-tunnel
grep -q '^TUNNEL_TOKEN=.' .env && tunnel=tunnel
compose() { docker compose -f compose.yml --profile "$tunnel" "$@"; }

echo "== Images"
# Prebuilt images if the registry has them for this machine; otherwise build here (slower).
if compose pull --quiet; then
  compose up -d --remove-orphans
else
  compose up -d --build --remove-orphans
fi

echo "== Demo data"
compose run --rm seed

echo "== Nightly reset (04:15 server time)"
cat > /etc/cron.d/ecomanage-demo <<EOF
15 4 * * * root cd $DIR/infra/deploy && docker compose -f compose.yml run --rm seed >> /var/log/ecomanage-seed.log 2>&1
EOF

if [ "$tunnel" = quick-tunnel ]; then
  echo "== Quick tunnel address"
  for _ in $(seq 1 30); do
    url=$(compose logs quick-tunnel 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
    [ -n "$url" ] && break
    sleep 2
  done
  echo "${url:-not up yet: docker compose -f $DIR/infra/deploy/compose.yml logs quick-tunnel}"
  echo "For links in emails, set PUBLIC_URL in $DIR/infra/deploy/.env to it, then:"
  echo "  cd $DIR/infra/deploy && docker compose -f compose.yml up -d api worker"
fi

echo "Done. Sign in as manager@ecomanage.io with Demo1234!"
