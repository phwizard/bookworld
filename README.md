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

Open http://localhost:5173, pick a name, click to look around, WASD to walk, Shift to run, T to talk, Esc to release the mouse. Walk through a doorway to change rooms. `pnpm validate:worlds` checks every `worlds/*/world.json`.

License: MIT.
