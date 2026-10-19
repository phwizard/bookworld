#!/usr/bin/env bash
# Runs ON THE BOX as root after deploy/push.sh has copied the checkout to /var/www/bookworld.
# Idempotent: creates the system user, installs the server's runtime dependencies at low priority,
# installs or refreshes the systemd unit, restarts the service, checks its health, and adds the Caddy
# block if it is not there yet. Touches nothing that is not ours; never runs apt (docs/DEPLOY.md).
set -euo pipefail
APP=/var/www/bookworld
HOME_DIR=/var/www/bookworld-home
PORT=3104

if ! id bookworld >/dev/null 2>&1; then
  useradd --system --home-dir "$HOME_DIR" --shell /usr/sbin/nologin bookworld
fi
mkdir -p "$HOME_DIR" "$APP/server/data"
chown -R bookworld:bookworld "$APP" "$HOME_DIR"
chmod 600 "$APP/.env"

# pnpm: via corepack from the Node tarball; nothing from apt
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
  corepack prepare "$(sed -n 's/.*"packageManager": *"\(pnpm@[^"]*\)".*/\1/p' "$APP/package.json")" --activate
fi

# runtime dependencies of the server and the workspace packages it imports (shared, generator); nothing of the client
sudo -u bookworld -H env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 nice -n 19 pnpm --dir "$APP" install --prod --frozen-lockfile --filter "@bookworld/server..." 2>&1 | tail -5

install -m 644 "$APP/deploy/bookworld.service" /etc/systemd/system/bookworld.service
systemctl daemon-reload
systemctl enable --quiet bookworld
systemctl restart bookworld
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/health" || { echo "service did not come up; last log lines:"; journalctl -u bookworld -n 40 --no-pager; exit 1; }
echo

if ! grep -q "bookworld.ethora.com" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%s)"
  { echo; cat "$APP/deploy/Caddyfile.bookworld"; } >> /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile >/dev/null
  systemctl reload caddy
  echo "caddy: bookworld.ethora.com block added and reloaded"
else
  echo "caddy: block already present"
fi
systemctl is-active bookworld
