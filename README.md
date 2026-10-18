# bookworld (working name)

A multiplayer world where every location is a chat room, you can only be in one place at a time, you walk between adjacent locations, and the characters of a book live there as AI agents. Built on [Ethora](https://ethora.com) (chat server, API, AI agents, MCP). Experimental, 3D-first.

Status: pre-alpha, private. Docs in `docs/`. Start with `CLAUDE.md`.

## Run it locally

```
pnpm install
pnpm hooks:install          # gitleaks pre-commit hook (brew install gitleaks)
cp .env.example .env        # add ETHORA_CHAT_APP_SECRET for chat; movement works without it
pnpm dev                    # world service on :2567, client on :5173
```

Open http://localhost:5173, pick a name, click to look around, WASD to walk, Shift to run, Space to jump, T to talk (Esc leaves the message box so you can walk while the panel stays open; Esc again closes it), N to mute the music, F to mute the sound effects, V to let the characters speak their lines aloud, Esc to release the mouse. Walk through a doorway to change rooms. A reload brings you back to the same room and spot with the same name; a dropped connection has a minute to come back; after five idle minutes you show as away, after twenty you wander off and a key press brings you back. "Leave" in the bottom line ends the visit. `pnpm validate:worlds` checks every `worlds/*/world.json`.

**Playing together on one network.** Both servers listen on all interfaces, so a second person on the same Wi-Fi opens `http://<your LAN address>:5173` (on a Mac, `ipconfig getifaddr en0` prints it); the client talks to the world service on the same address, port 2567. Nothing to configure; the machine's firewall must allow incoming connections to node, and the two addresses must not be blocked by a guest network. For someone outside the network use a tunnel such as `cloudflared tunnel --url http://localhost:5173` for the client plus one for port 2567, and point `VITE_WORLD_SERVER_URL` at the second tunnel.

The first screen lists the worlds with who is in them now, their rooms and characters, messages and last activity; `?world=alice` or `?world=tempest` deep-links one.

## Make a world from a book

```
pnpm generate  -- --gutenberg 11 --slug alice --rooms 6 --characters 3   # text -> worlds/alice/world.json (+ knowledge chunks)
pnpm provision -- --world alice                                           # -> Ethora app, rooms, agents, knowledge (needs ETHORA_API_KEY)
pnpm metrics                                                              # usage report from the local event log
```

Details, keys and what each step does: `docs/GENERATOR.md`. The join screen has the same thing as a form ("Your own book"): it runs the generator on the server behind the daily budget and, with `ETHORA_API_KEY`, provisions the world on Ethora. Public numbers for a home page (visitors online, per world cards, an SVG badge): `docs/API.md`.

## Costs and caps

Two things cost money: every chat message that names a character makes its Ethora agent answer (Ethora's own plan limits apply first), and every generator run calls a model. The world service keeps a daily budget in `server/data/ai-budget.json`: `AI_DAILY_LIMIT` replies per world per day and `AI_DAILY_LIMIT_PER_PLAYER` per visitor; at the limit the characters "rest" until `AI_DAILY_RESET` (clients stop addressing them, rooms get a narration line, and with `ETHORA_API_KEY` the agents are switched off on Ethora too). The generator refuses to run past `GENERATOR_DAILY_RUNS` or `GENERATOR_DAILY_USD` unless `--ignore-budget` is passed. `GET /api/ai-budget` shows today's numbers. `pnpm test` runs the unit tests (report, draft conversion, provisioner against a mock Ethora MCP).

License: MIT.
