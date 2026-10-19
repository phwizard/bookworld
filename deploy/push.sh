#!/usr/bin/env bash
# Runs on the Mac: the deploy. Builds the client for https://bookworld.ethora.com, copies the checkout
# (without node_modules, the git history, the docs and the generator's working files) plus .env.production
# to the box over ONE SSH connection (ufw rate limits port 22), then runs deploy/install.sh there as root.
# Needs DEPLOY_HOST and DEPLOY_USER in .env and .env.production from deploy/make-env.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source <(grep -E '^DEPLOY_(HOST|USER)=' .env); set +a
: "${DEPLOY_HOST:?DEPLOY_HOST missing in .env}" "${DEPLOY_USER:?DEPLOY_USER missing in .env}"
[ -f .env.production ] || ./deploy/make-env.sh
PUBLIC_URL=${PUBLIC_URL:-https://bookworld.ethora.com}
APP=/var/www/bookworld

if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "building the client for $PUBLIC_URL"
  VITE_WORLD_SERVER_URL="$PUBLIC_URL" pnpm --filter @bookworld/client build 2>&1 | tail -2
fi

CTL=${TMPDIR:-/tmp}/bookworld-ssh-ctl
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$CTL" -o ControlPersist=10m -o ConnectTimeout=20)
ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p $APP"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules --exclude .git --exclude docs --exclude .githooks --exclude '.env' --exclude '.env.*' \
  --exclude 'client/public' --exclude 'client/src' --exclude 'generator/.cache' \
  --exclude 'worlds/*/source' --exclude 'worlds/*/knowledge' --exclude 'worlds/*/draft.json' --exclude 'worlds/alice-gen' \
  --exclude 'server/data' \
  ./ "$DEPLOY_USER@$DEPLOY_HOST:$APP/"
rsync -az -e "ssh ${SSH_OPTS[*]}" .env.production "$DEPLOY_USER@$DEPLOY_HOST:$APP/.env"
ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "bash $APP/deploy/install.sh"
ssh "${SSH_OPTS[@]}" -O exit "$DEPLOY_USER@$DEPLOY_HOST" 2>/dev/null || true
echo "deployed; check $PUBLIC_URL/api/health"
