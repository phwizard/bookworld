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

Open http://localhost:5173, pick a name, click to look around, WASD to walk, Shift to run, T to talk, N to mute the music, Esc to release the mouse. Walk through a doorway to change rooms. `pnpm validate:worlds` checks every `worlds/*/world.json`.

## Make a world from a book

```
pnpm generate  -- --gutenberg 11 --slug alice --rooms 6 --characters 3   # text -> worlds/alice/world.json (+ knowledge chunks)
pnpm provision -- --world alice                                           # -> Ethora app, rooms, agents, knowledge (needs ETHORA_API_KEY)
pnpm metrics                                                              # usage report from the local event log
```

Details, keys and what each step does: `docs/GENERATOR.md`. `pnpm test` runs the unit tests (report, draft conversion, provisioner against a mock Ethora MCP).

License: MIT.
