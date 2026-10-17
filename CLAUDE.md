# CLAUDE.md - bookworld (working name)

## What this is

An experimental multiplayer "book world": locations are chat rooms, a player is in exactly one room at a time, moves between adjacent rooms (N/E/S/W), meets other players and AI characters there. A generator turns a book into a world (rooms, exits, characters). First target: a 3D first-person client. Read `docs/CONCEPT.md` (the founder's concept, verbatim) and `docs/PLAN.md` before doing anything.

Owner: Taras Filatov (CEO of Dappros/Ethora). Hobby/demo project, kept deliberately separate from the Ethora product repos and from the business-ops workspace. Private repo on the `phwizard` GitHub account now, MIT, to be made public when playable.

## Ground rules

1. **Use Ethora only as an external builder can.** Ethora Cloud API, the public npm packages, the hosted MCP server (`https://mcp.chat.ethora.com/mcp`), the public docs. Never edit Ethora engine code from this project. If something in Ethora is missing or broken, record it in `docs/ETHORA-GAPS.md` (what, why we need it, the workaround) and move on with the workaround. The owner carries those items to the Ethora R&D context himself.
2. **No secrets in git.** App tokens, JWTs, passwords and API keys live in `.env` (gitignored). `.env.example` holds placeholders only. Never put a real `appId`/`appToken` pair in fixtures, tests, docs or screenshots. Run `gitleaks detect` before the first push and keep a pre-commit hook.
3. **Ethora stays unchanged; world logic lives here.** Position, adjacency, one-room-at-a-time, movement, scripts (plays) are this project's world service. Ethora provides identity, rooms, messages, agents, knowledge and the chat UI.
4. **The world file is the product.** `worlds/<slug>/world.json` (schema in `docs/WORLD-FILE.md`) is what people share, fork and generate. The 3D client, a future 2D client and the generator all read the same file. Design changes start there.
5. **Content licence.** Hosted/featured worlds: public domain, original or CC text only. Private worlds: the uploader attests rights; personal use. Each world file carries a `license` field. Prefer old (pre-1930) translations from Project Gutenberg; translations have their own copyright.
6. **Customer-facing text has no em-dashes or en-dashes** (plain hyphens). Applies to README, UI strings, generated room descriptions.
7. **Cost discipline for agents.** Default `responseMode: "mentioned"` or `"smart"` with a `cooldownSec` of 20-60 for every character. Never `"always"` in a public room.

## Verified facts about Ethora (as of 17 Oct 2026)

See `docs/ETHORA-FACTS.md` for the full list with file references. Highlights:

- `@ethora/chat-component` latest 26.10.4 (React). Config keys that matter here: `customRooms.{rooms, singleRoom}`, `disableRooms`, `forceSetRoom`, `backgroundChat.image`, `customSystemMessage`, `whitelistSystemMessage`, `eventHandlers.onMessageSent`, `messageTextFilter`, `customLogin.loginFunction`, `disableHeader`, `chatHeaderSettings.hide`. No incoming-message event handler was found in the config surface (only sent/edited/failed/history): spike question #1.
- Backend chat API: `POST /v2/apps/:appId/chats` (create room), `POST`/`DELETE /v2/apps/:appId/chats/users-access` and `PATCH /v2/apps/:appId/chats/users` (add/remove members: this is how "move" works), `GET /v2/apps/:appId/chats/:chatId/messages`, `POST /v2/apps/:appId/chats/broadcast`.
- Agents: `responseMode` in `always | mentioned | smart | probability`, `responseProbability`, `cooldownSec`, `greetingMessage`, `prompt`, `soulMd` (persona), RAG with `ragTags`, `flowsYaml` (scripted conversations), `heartbeat {enabled, schedule, prompt}` stored but no worker yet. Endpoints `POST /v2/apps/:appId/agents/:idOrAddress/invite-to-chat`, `POST /v2/agents/:id/bot-instances/:botInstanceId/leave-chat`.
- MCP tools (hosted): `ethora-app-create/select/export/import`, `ethora-chat-create`, `ethora-agent-create/update/soul-set/invite/activate/try`, `ethora-source-doc-upload`, `ethora-message-send`, `ethora-user-batch-create`, `ethora-chat-history`, `search`/`fetch` for docs. Use `search` before guessing an API shape.
- Room JID = `${appId}_${chatId}`. One Ethora App per world is the tenancy model.
- Ethora has a legacy, unused `Room` model with N/E/S/W nav links bound to a smart contract. Do not use it.

## Stack (decided, see docs/3D-STACK.md for the reasoning)

- Client: Vite + React + TypeScript, Three.js via React Three Fiber, `@react-three/drei`, `@react-three/rapier` (collision), `ecctrl` (WASD + mouse-look + shift to run character controller), `@pixiv/three-vrm` for avatars, Mixamo animations retargeted to VRM.
- World service: Node + Colyseus. One Colyseus room per world location; the Colyseus server also holds the world file, player positions, and calls the Ethora API on room transitions (remove from old Ethora room, add to new, post system messages). Runs on a droplet (needs persistent WebSockets); the client can go to Vercel.
- Chat: `@ethora/chat-component` mounted as a toggleable panel inside the 3D UI (T or Enter to open), single-room mode, switched on room change. Speech bubbles over avatars mirror the last message per speaker.
- Rooms: template "box room" (floor + 4 walls + a door per open exit) with a generated wallpaper texture per room, optional 360 panorama behind windows, props from CC0 glTF kits (Kenney, Quaternius, Kay Kit) chosen by the generator from a catalog. No AI-generated meshes in v1.
- Generator: a script that takes a text (or a well-known title) and emits `world.json`, then provisions the Ethora App/rooms/agents through the Ethora API or MCP. Also usable as a Claude Code prompt against the hosted MCP.

## Working method

- Package manager pnpm. Monorepo folders: `client/`, `server/`, `generator/`, `worlds/`, `docs/`.
- Use Context7 for library docs (R3F, drei, rapier, ecctrl, Colyseus, three-vrm) before writing code against them.
- Keep `docs/PLAN.md` current (phase, exit test, what shipped). Keep `docs/ETHORA-GAPS.md` current.
- Commit small, descriptive. No "Co-authored-by" lines.
- Deploy nothing public until the owner says so.
