#!/usr/bin/env bash
# Runs on the Mac. Writes .env.production (gitignored) once, from the local .env: the Ethora settings and App
# Secrets, a fixed session secret, the production ports and paths, the AI caps. Edit .env.production by hand
# afterwards (for example to add ANTHROPIC_API_KEY); this script never overwrites it. Prints no values.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=.env.production
if [ -f "$OUT" ]; then echo "$OUT exists, keeping it"; exit 0; fi
[ -f .env ] || { echo "no .env to read the Ethora secrets from"; exit 1; }
rand() { openssl rand -base64 36 | tr -d '/+=' | head -c 40; }
{
  echo "# Production settings for bookworld.ethora.com (docs/DEPLOY.md). Written by deploy/make-env.sh; never commit."
  grep -E '^ETHORA_(API_BASE_URL|XMPP_DOMAIN|CHAT_APP_SECRET)' .env
  echo "BOOKWORLD_SESSION_SECRET=$(rand)"
  echo "METRICS_TOKEN=$(rand)"
  echo "PORT=3104"
  echo "HOST=127.0.0.1"
  echo "CORS_ORIGIN=https://bookworld.ethora.com"
  echo "WORLDS_DIR=/var/www/bookworld/worlds"
  echo "DATA_DIR=/var/www/bookworld/server/data"
  echo "# Daily caps on paid AI use (characters rest at the world limit; see .env.example)"
  echo "AI_DAILY_LIMIT=500"
  echo "AI_DAILY_LIMIT_PER_PLAYER=60"
  echo "AI_DAILY_RESET=0 0 * * *"
  echo "GENERATOR_DAILY_RUNS=5"
  echo "GENERATOR_DAILY_USD=10"
  echo "# The 'Your own book' form stays off until the owner adds ANTHROPIC_API_KEY and sets MAKE_WORLD=on"
  echo "MAKE_WORLD=off"
} > "$OUT"
chmod 600 "$OUT"
echo "wrote $OUT ($(grep -c '^ETHORA_CHAT_APP_SECRET' "$OUT") App Secrets)"
