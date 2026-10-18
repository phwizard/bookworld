# Generator and provisioner

Two commands turn a book into a playable world. Both live in `generator/` and run from the repo root.

```
pnpm generate  -- --gutenberg 11 --slug alice --rooms 6 --characters 3     # book -> worlds/alice/world.json
pnpm provision -- --world alice                                             # world.json -> Ethora app, rooms, agents, knowledge
```

Then copy the new app's App Secret from the Ethora dashboard (API tab) into `.env` as `ETHORA_CHAT_APP_SECRET`, restart `pnpm dev`, and open `http://localhost:5173/?world=alice`.

## generate: book to world.json

Input, one of:

- `--gutenberg <id>`: fetches the plain text from Project Gutenberg (cached in `worlds/<slug>/source/`), reads title and author from its header, licence defaults to `public-domain`.
- `--text <file> --title "..." --author "..." --license <l>`: a local text. `--license` is one of `public-domain`, `original`, `cc-by`, `cc-by-sa`, `private-attested` (rule 5 in `CLAUDE.md`).
- `--title "..." --author "..." --license <l>` with no text: the model works from what it knows of the book; characters get no knowledge documents.

Options: `--slug` (folder name, default from the title), `--out <dir>`, `--rooms 6`, `--characters 3`, `--notes "..."` (free guidance, e.g. "make the Queen's court the biggest room"), `--year`, `--model`, `--backend anthropic|claude-cli`, `--force` (overwrite an existing world.json), `--dry-run` (prints the prompt and stops), `--draft <file>` (skip the model, convert a saved draft).

What happens:

1. The text is stripped of the Gutenberg wrapper and split into chapters (headings like CHAPTER, BOOK, PART, ACT, or roman numerals; a table of contents is ignored; texts without headings are cut into 15k-character parts). Chapters become `worlds/<slug>/knowledge/<slug>-chN.txt`, the characters' knowledge documents.
2. The model gets `generator/prompts/world.md` as the system prompt and, as the user message, the book, the chapter list and the lists of what it may use: textures, panoramas, music, ambience presets and avatars from `client/public/assets/manifest.json`, props from `client/public/assets/props/catalog.json`. The footstep surface of a room follows its floor texture (the manifest tags each texture). It answers with a draft: rooms on an integer grid with links between adjacent cells, asset ids, chapter numbers, personas, scripts. The schema is enforced (tool use on the API, `--json-schema` on the CLI).
3. `generator/src/draft.ts` converts the draft to a world: grid plus links become symmetric exits (diagonal links dropped, unreachable rooms linked to a reachable neighbour when there is one), ids become slugs, asset ids become paths, chapter numbers become knowledge tags, props outside the catalog are dropped, props are clamped inside the room and removed from doorways, tabletop and flat items get their flags, `cooldownSec` is clamped to 20-60 and `responseMode` to mentioned or smart, every em or en dash becomes a hyphen. Then `validateWorld` runs. If it reports errors the model is asked once for a repair with the list of problems.
4. Output: `world.json`, `knowledge/`, `draft.json` (the raw model answer, for `--draft` reruns), `generation.json` (backend, model, options, chapter list, warnings). `source/`, `knowledge/` and `draft.json` are gitignored: all three can be rebuilt from `world.json`'s `source.text`.

Model backends: with `ANTHROPIC_API_KEY` in `.env` the Anthropic API is used (`GENERATOR_MODEL`, default `claude-opus-5-5`); without it the generator runs the Claude Code CLI on this machine (`claude -p`, tools off, structured output) against the signed-in account. `--backend` forces one.

The same prompt works interactively: open Claude Code in this repo, paste `generator/prompts/world.md`, give it the book and the asset lists (`pnpm generate -- ... --dry-run` prints exactly that), save the answer as `draft.json` and run `pnpm generate -- --draft worlds/x/draft.json --slug x --title ... --author ... --license ...`.

## provision: world.json to Ethora

Uses the hosted Ethora MCP server (`https://mcp.chat.ethora.com/mcp`) as any external builder would, with the same tools a person uses from Claude Desktop. It needs a user API key in `.env` as `ETHORA_API_KEY`, sent as `Authorization: Bearer`. Get one by calling `ethora-api-key-create` from an MCP client where you are logged in with your Ethora account (the key is shown once; the hosted server's `keys` tool group has it, `ethora-tools-enable { group: "keys" }` lists it when hidden). `ETHORA_MCP_URL` overrides the server for a self-hosted Ethora.

Steps, each recorded in `worlds/<slug>/ethora.json` (gitignored) as soon as it succeeds, so a rerun continues where it stopped and never creates duplicates:

1. `ethora-app-create` "Bookworld <title>" (or `--app <appId>` to reuse one), `ethora-app-select`.
2. `ethora-chat-create` per room, titled like the room. Rooms created this way are public app chats (every app user may read them; see ETHORA-GAPS #10).
3. `ethora-agent-create` per character: name, the persona from the world file plus the room's setting and the shared house rules (stay in character, under 80 words, plain hyphens), `responseMode` and `cooldownSec` from the file (`always` is downgraded to `smart`), RAG on when the character has knowledge tags, categories persona and entertainment.
4. Knowledge. A Project Gutenberg source is crawled straight from its URL into each agent's knowledge base (`ethora-source-site-crawl`, one call per agent, the weekly re-crawl switched off); nothing is uploaded. Other sources upload the chapter files with `ethora-source-doc-upload` (five per call); `--knowledge files` forces that path for Gutenberg too.
5. `ethora-agent-visibility-set` to `unlisted`, which is what lets the world service move the agent between rooms with its server token (ETHORA-GAPS #14).
6. `ethora-agent-invite` into the character's home room; the bot instance id is kept for `leave-chat`.

Flags: `--dry-run` prints the plan without connecting, `--skip-knowledge`, `--smoke` (after provisioning, posts "@Name hello, who are you?" in each home room and prints the reply), `--mcp-url`.

The App Secret is the one thing the script cannot fetch (ETHORA-GAPS #8): copy it from the dashboard into `.env`.

## Tests

`pnpm test` runs the server's report test and the generator's: draft conversion rules, chapter splitting, and the provisioner against a mock Ethora MCP server (`generator/test/mock-ethora-mcp.ts`) that answers with the real tools' result shapes, including a wrong-key run and an idempotent rerun.

## Usage report

The world service appends one JSON line per event to `server/data/events.jsonl` (`METRICS_FILE` to move it, `off` to disable): `enter` (with an anonymous visitor id the browser keeps in localStorage), `join` (room, door, who was already there), `leave`, `message` (how many characters it named; never the text). No names, no message bodies.

`pnpm metrics [--since YYYY-MM-DD] [--json]` prints, per world: sessions and distinct visitors per day, rooms per session (mean, median, max), messages to characters vs to humans, sessions that shared a room with another human, and day-7 return (visitors first seen at least seven days ago who came back on day 7, and on day 7 or later). The same report is served at `GET /api/metrics` when `METRICS_TOKEN` is set (`Authorization: Bearer <token>`), for the deployed server.

"Messages to characters" counts human messages that name a character; agent replies are not seen by the world service (ETHORA-GAPS #2).
