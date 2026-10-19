# Plan

## Phase 0: 3D spike (target 3-4 weeks)

Scope: one world (`worlds/alice`, 4 rooms: Rabbit Hole, Hall of Doors, Garden, Tea Party), box-room template with generated wallpapers, two players walking and seeing each other, speech bubbles mirroring Ethora chat, walking through a door = Colyseus room switch + Ethora room switch + "has joined (E)" / "has left (W)" system messages, one character (the Mad Hatter) standing in the Tea Party answering when addressed. Mini-map from the grid. No music, no voice, no generator yet (world.json written by hand).

Exit test: a second person on another machine enters from a link, walks to the Tea Party, talks to the Hatter and to the first person, and leaves; both see the correct join/leave lines in both clients.

Steps (status as of 17 Oct 2026, evening):
1. DONE. Repo scaffold (pnpm workspaces: client, server, shared, worlds). Gitleaks pre-commit hook (`pnpm hooks:install`).
2. DONE. Ethora App "Bookworld Alice" created via MCP; 4 rooms; agent Hatter (`responseMode: mentioned`, `cooldownSec: 30`, chapter 7 uploaded as knowledge, invited to the Tea Party room, answered in character in a test). Ids in `worlds/alice/ethora.json` (gitignored; `ethora.example.json` shows the shape).
3. DONE (movement). Colyseus `LocationRoom` per world room, filtered by `{world, location}`; player state (pos, rotY, anim, name); `move` validates the exit, grants the next Ethora room, narrates "has left (E)" / "has joined (W)", hands the client over, revokes the old room 3 s later. Chat side runs through `@ethora/sdk-backend` (B2B token from the App Secret) and is a no-op until `ETHORA_CHAT_APP_SECRET` is set.
4. DONE. R3F box-room template with procedural wallpaper, doorways with the destination name over each door, ecctrl 2.0 capsule + pointer-lock first person, WASD/Shift, door detection by position, remote players interpolated with idle/walk/run clips, characters standing in their home room, mini-map from the grid. Avatars are the CC0 KayKit Adventurers (rigged, clips embedded) instead of VRM + Mixamo: no Adobe login needed and the style matches the Kenney props. VRM stays possible later. Props: catalog of CC0 Kenney furniture and food, placed per room in the world file.
5. DONE. Chat panel mounts `@ethora/chat-component` pinned to the current room (`roomJID` prop, `disableRooms`), guest login = client JWT from the server (`jwtLogin`), `xmppSettings` passed explicitly, `initBeforeLoad: false`. Verified: panel follows the room, shows archive and live messages, sends. Bubbles: built on the component's `CustomScrollableArea`; verified with a second player.
6. DONE. Narration is posted through the broadcast endpoint from the app's system account as italic markdown ("Alice has joined (S)"); it shows in the panel with the app name as sender (ETHORA-GAPS #11). Rendered as quiet italic system lines in the custom message list.
7. DONE. From inside the 3D client: walked Rabbit Hole > Hall > Garden > Tea Party, opened the panel, mentioned @Hatter, got an in-character reply in about 5 s. Stays quiet when not mentioned.
8. DONE 19 Oct 2026 (team test). World service and static client on the shared droplet behind Caddy at bookworld.ethora.com (docs/DEPLOY.md, deploy/), noindex while testing. Exit test with the team pending.

Verified locally 17 Oct: two browser tabs, both walked Rabbit Hole -> Hall of Doors, each saw the other and "2 here", server narration lines correct.

Next up (owner's call, 17 Oct): deployment deferred; chat membership limits deferred; Phase 1 items to be picked. Journal in docs/JOURNAL.md.

## Phase 1: Playable (after Phase 0 passes)

Status 17 Oct 2026 (late): items 3 to 6 shipped. Panorama rooms (Garden, Poly Haven HDRI), image wallpapers and floors (Poly Haven, CC0), music per room (Kevin MacLeod, CC BY, N to mute), character life (wander, face the speaker, cron schedule for moves and lines, on-enter greeting scripts). Deployment (5) and chat membership limits deferred by the owner.

Status 18 Oct 2026: items 1, 2 and 9 shipped (docs/GENERATOR.md). Generator: `pnpm generate -- --gutenberg 11` fetches the text, splits chapters, asks the model (Anthropic API or the local Claude Code CLI) for a grid-and-links draft against the asset manifest and props catalog, converts and validates it, repairs once, writes world.json plus knowledge chunks. Provisioner: `pnpm provision -- --world alice` drives the hosted Ethora MCP with a user API key (app, rooms, agents with persona and house rules, knowledge upload, unlisted visibility, invite), resumable through the gitignored ethora.json, tested against a mock MCP server. Measurement: event log in the world service, `pnpm metrics` and `GET /api/metrics` with sessions and visitors per day, rooms per session, messages to characters vs humans, sessions with 2+ humans in a room, day-7 return. Open: submissions (8), README + video (10), deployment. Second world (7) done 18 Oct: The Tempest, generated with `--notes` asking for an enacted play (seven island rooms, Prospero, Ariel, Caliban, Miranda; schedules bring pairs together before seven cron scenes on the hour's minutes 5, 13, 21, 29, 37, 45, 53), provisioned by hand over the MCP following the provisioner's plan, the play crawled from its Gutenberg URL into each agent. Needs `ETHORA_CHAT_APP_SECRET_TEMPEST` from the dashboard for chat.

Also 18 Oct: the entry screen is a world picker fed by `GET /api/worlds` (summary, rooms with who is where, characters, people online now, messages all time and today, visits, last activity, chat on or off, resting). Two coast panoramas (Poly Haven, CC0) for the island rooms. Done the same evening: the "Your own book" form on the join screen (`POST /api/make`, a job queue of one at a time, the generator's daily budget in front, provisioning when `ETHORA_API_KEY` is set, the new world loaded into the running service; chat still needs the App Secret by hand, gap 8). Public API for a home page: `GET /api/stats`, `GET /api/worlds`, `GET /api/badge.svg` (`docs/API.md`).

Added 18 Oct 2026 (owner's request): sound. Footsteps for players and characters from the room's floor (CC0 Kenney samples, positional for others), a door on each room change, chat open and close and incoming-message clicks, procedural room ambience from the world file (drips, clock, birds, wind), and character voices through the browser's speech synthesis (V, off by default). Next in this line: cloud text to speech if the report shows voices being kept on; proximity voice between players after deployment.

Also 18 Oct: daily AI budget (character replies per world and per visitor, generator runs and spend; docs in README "Costs and caps"); presence: 60 s reconnection window with the same seat, resume after a reload (session token in the tab, `POST /api/worlds/:slug/resume`), away after 5 idle minutes and "has wandered off" after 20 with a key press to return, one Ethora user per visitor and name; the chat panel is translucent and walking works while it is open (Esc leaves the composer first).


Generator (text -> world.json -> provisioning), panorama rooms, music, two worlds (Alice; The Tempest as an enacted play with scheduled performances), character schedules, world submissions by PR, README + 2-minute video, repo public. Measure: players/world/day, rooms per session, messages to characters vs humans, sessions with 2+ humans in a room, day-7 return.

## Later

2D/mobile client on the same world file; claiming and building (fields reserved); voice; self-hosted Ethora Core guide.
