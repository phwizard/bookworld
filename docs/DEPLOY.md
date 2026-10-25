# Deploying the team test server

Decided 19 Oct 2026 by the owner. The team test runs on an existing DigitalOcean droplet that already hosts several small Node sites behind Caddy, not on a new droplet, and not through a DigitalOcean API token (none is issued for this project). The host name is `bookworld.ethora.com`. A fresh droplet is a later decision, when the world is public or the shared box runs out of room.

Host and login details are local only, never in git: `DEPLOY_HOST` and `DEPLOY_USER` in `.env`. The Mac that holds this checkout already has the root SSH key for the box.

## The box (facts, 19 Oct 2026)

| Item | Value |
|---|---|
| OS, size | Ubuntu 24.04, 1 vCPU, 2 GB RAM, 2 GB swap (about 700 MB free, 750 MB of swap in use), 50 GB disk free |
| Node | 22.x at `/usr/local/bin/node` (official tarball under `/opt/node`, not apt). No pnpm installed: use `corepack enable` as root once, or `npm i -g pnpm` |
| Web server | Caddy 2.11, config `/etc/caddy/Caddyfile`, Let's Encrypt per host via HTTP-01 (works behind the Cloudflare proxy, every other host on the box does it this way) |
| Other tenants | Four production Node services on 127.0.0.1 ports 3100-3103 and six WordPress sites. Do not restart or edit anything that is not ours |
| apt | The Caddy apt repo is broken (402), so `apt update` fails. Do not try to fix it or upgrade packages; install nothing with apt |
| Firewall | ufw: 22, 80, 443 only. SSH is rate limited: batch remote commands into one session or connections get refused |
| DNS | `bookworld.ethora.com` A record exists, proxied through Cloudflare (orange cloud), pointing at the box. WebSockets pass through Cloudflare |

## Pattern to follow (same as the other apps on the box)

- System user `bookworld` (no login), checkout `/var/www/bookworld`, home `/var/www/bookworld-home`.
- The world service listens on `127.0.0.1:3104` (next free port). Set `PORT=3104` and bind to localhost; nothing else may be exposed.
- systemd unit `/etc/systemd/system/bookworld.service`, modelled on the existing ones:

```ini
[Unit]
Description=bookworld.ethora.com (world service)
After=network.target

[Service]
Type=simple
User=bookworld
Group=bookworld
WorkingDirectory=/var/www/bookworld/server
EnvironmentFile=/var/www/bookworld/.env
Environment=NODE_ENV=production
Environment=HOME=/var/www/bookworld-home
ExecStart=/usr/local/bin/node dist/index.js
Restart=always
RestartSec=3
MemoryMax=650M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/bookworld/server/data /var/www/bookworld-home
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

  The real unit is `deploy/bookworld.service`. The server has no build output (its `build` script only typechecks; the workspace packages export TypeScript sources), so `ExecStart` is `/usr/local/bin/node --import tsx src/index.ts` with `tsx` as a runtime dependency. `MemoryMax` was 350M for the service alone and is 650M since 25 Oct 2026 (journal): the voice renders (Piper about 190 MB, the singing renderer about 100 MB) run as children of the service, one at a time, inside this cgroup. If Colyseus plus the generator need more, say so in the journal before raising it again. With Kokoro as the voice the renders take about 750 MB each: `SERVICE_MEMORY_MAX=1500M` in `.env` (install.sh writes it into the unit) on a 4 GB droplet (`docs/VOICES.md`, "On the droplet").

- Caddy block appended to `/etc/caddy/Caddyfile` (back the file up first: `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%s)`, then `caddy validate --config /etc/caddy/Caddyfile` and `systemctl reload caddy`). Static client from disk, everything else (Colyseus matchmaking, the WebSocket upgrade, `/api/*`) to Node:

```caddyfile
http://bookworld.ethora.com {
    redir https://bookworld.ethora.com{uri} permanent
}
https://bookworld.ethora.com {
    header X-Robots-Tag "noindex, nofollow"
    encode gzip
    @static file {
        root /var/www/bookworld/client/dist
        try_files {path} {path}/index.html
    }
    handle @static {
        root * /var/www/bookworld/client/dist
        rewrite * {file_match.relative}
        file_server
    }
    handle {
        reverse_proxy 127.0.0.1:3104
    }
}
```

  Keep `noindex` for the whole test period. The block is `deploy/Caddyfile.bookworld`.

## Build off the box

The box has one vCPU, a 768 MB heap cap convention and swap already in use. A Three.js production build does not belong there. Build on the Mac (`pnpm build`) and copy `client/dist` and `server/dist` up with rsync, or build in GitHub Actions once the repo is on GitHub and pull the artefact. Only `pnpm install --prod` for the server's runtime dependencies runs on the box, at low priority (`nice -n 19`).

Until the GitHub repo exists, rsync from the Mac is the deploy: `./deploy/push.sh` builds the client for the public URL, copies the checkout (no node_modules, git history, docs, client sources or generator working files) and `.env.production` over one multiplexed SSH connection, then runs `deploy/install.sh` on the box as root. That script is idempotent: system user, pnpm through corepack, `pnpm install --prod --frozen-lockfile --filter "@bookworld/server..."` at nice 19, the unit, a restart, a health check on `:3104`, and the Caddy block if it is missing (backup, validate, reload). `SKIP_BUILD=1 ./deploy/push.sh` skips the client build. After it exists, follow the box convention: a read-only deploy key in `/var/lib/deploy-keys/bookworld`, wired through the checkout's `core.sshCommand`, and a `deploy-app bookworld` case in `/usr/local/bin/deploy-app` (pull, install, restart, health check on `:3104`). Write the deploy script into this repo under `deploy/` so the box can be rebuilt from here.

## Production settings

- `.env` on the box (mode 600, owner `bookworld`) is the Mac's `.env.production`, written once by `deploy/make-env.sh` from the local `.env`: the Ethora App Secrets for each world, `BOOKWORLD_SESSION_SECRET` set (not random per boot, or every restart logs everyone out), `METRICS_TOKEN`, `PORT=3104`, `HOST=127.0.0.1`, `CORS_ORIGIN=https://bookworld.ethora.com`, `WORLDS_DIR` and `DATA_DIR` pointing inside `/var/www/bookworld`, the AI caps, `MAKE_WORLD=off`. Edit it by hand to change anything; the script never overwrites it.
- Client build: `VITE_WORLD_SERVER_URL=https://bookworld.ethora.com` so the browser talks to the same origin over `wss`.
- `MAKE_WORLD_ALLOW_CLI` stays off on a public host. `MAKE_WORLD` only with `ANTHROPIC_API_KEY` and the daily generator budget in place.
- Scheduled character lines and cron scenes only post to a room while a player is in it (the world service skips them otherwise, 19 Oct). Before that, the Tempest's seven scenes an hour ran around the clock for an empty island, and any line that named another character could draw a paid agent reply with nobody reading it.
- The AI budget caps stay on. The owner's test apps already produced multi-million token days on Ethora during local testing; a public URL multiplies that. Check `GET /api/ai-budget` after the first evening with the team.
- Logs: `journalctl -u bookworld -f`. Caddy access logs are off by default on this box; turn them on per host only if needed.

## Voices on the box

`deploy/install.sh` calls `deploy/install-voice.sh` when `.env` has `VOICE_BACKEND=command` or `VOICE_SING`. That script installs nothing with apt: `uv` goes into the service user's home, a Python 3.12 venv with Piper, pyworld and a bundled ffmpeg next to it, and the Piper voices named in the world files are downloaded once. The `.env.production` lines and the memory arithmetic are in `docs/VOICES.md`, "On the droplet". Without those lines the service runs as before and the clients use the browser's voices.

## Cloudflare

Zone settings are shared with ethora.com and are not ours to change. Two known effects: the proxy caches static assets by extension (ship hashed file names, which Vite does), and if the zone's "Block AI bots" switch is ever on, AI crawlers get a 403 at the edge, which does not matter for this project.

## Taking it down

Stop and disable the unit, remove the Caddy block (validate, reload), remove the user and `/var/www/bookworld*`, and ask the owner to delete the `bookworld.ethora.com` DNS record. Nothing else on the box references the project.
