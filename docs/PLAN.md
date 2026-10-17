# Plan

## Phase 0: 3D spike (target 3-4 weeks)

Scope: one world (`worlds/alice`, 4 rooms: Rabbit Hole, Hall of Doors, Garden, Tea Party), box-room template with generated wallpapers, two players walking and seeing each other, speech bubbles mirroring Ethora chat, walking through a door = Colyseus room switch + Ethora room switch + "has joined (E)" / "has left (W)" system messages, one character (the Mad Hatter) standing in the Tea Party answering when addressed. Mini-map from the grid. No music, no voice, no generator yet (world.json written by hand).

Exit test: a second person on another machine enters from a link, walks to the Tea Party, talks to the Hatter and to the first person, and leaves; both see the correct join/leave lines in both clients.

Steps (status as of 17 Oct 2026, evening):
1. DONE. Repo scaffold (pnpm workspaces: client, server, shared, worlds). Gitleaks pre-commit hook (`pnpm hooks:install`).
2. DONE. Ethora App "Bookworld Alice" created via MCP; 4 rooms; agent Hatter (`responseMode: mentioned`, `cooldownSec: 30`, chapter 7 uploaded as knowledge, invited to the Tea Party room, answered in character in a test). Ids in `worlds/alice/ethora.json` (gitignored; `ethora.example.json` shows the shape).
3. DONE (movement). Colyseus `LocationRoom` per world room, filtered by `{world, location}`; player state (pos, rotY, anim, name); `move` validates the exit, grants the next Ethora room, narrates "has left (E)" / "has joined (W)", hands the client over, revokes the old room 3 s later. Chat side runs through `@ethora/sdk-backend` (B2B token from the App Secret) and is a no-op until `ETHORA_CHAT_APP_SECRET` is set.
4. DONE (placeholder avatars). R3F box-room template with procedural wallpaper, doorways with the destination name over each door, ecctrl 2.0 capsule + pointer-lock first person, WASD/Shift, door detection by position, remote players interpolated, characters standing in their home room, mini-map from the grid. VRM + Mixamo still to do.
5. DONE (panel), TODO (bubbles). Chat panel mounts `@ethora/chat-component` pinned to the current room (`roomJID` prop, `disableRooms`), guest login = client JWT from the server (`jwtLogin`), `xmppSettings` passed explicitly, `initBeforeLoad: false`. Verified: panel follows the room, shows archive and live messages, sends. Bubbles: use the component's `CustomScrollableArea` (it receives the room's messages); not built yet.
6. DONE (lines), TODO (styling). Narration is posted through the broadcast endpoint from the app's system account as italic markdown ("Alice has joined (S)"); it shows in the panel with the app name as sender (ETHORA-GAPS #11). Rendering as a quieter system line via `CustomMessageComponent` still to do.
7. DONE. From inside the 3D client: walked Rabbit Hole > Hall > Garden > Tea Party, opened the panel, mentioned @Hatter, got an in-character reply in about 5 s. Stays quiet when not mentioned.
8. TODO. Deploy server to the droplet, client to Vercel, run the exit test with a second person.

Verified locally 17 Oct: two browser tabs, both walked Rabbit Hole -> Hall of Doors, each saw the other and "2 here", server narration lines correct.

Next up: bubbles via `CustomScrollableArea`; narration styling; VRM avatars with Mixamo clips; props catalog; deploy to the droplet + Vercel and run the exit test with a second person.

## Phase 1: Playable (after Phase 0 passes)

Generator (text -> world.json -> provisioning), panorama rooms, music, two worlds (Alice; The Tempest as an enacted play with scheduled performances), character schedules, world submissions by PR, README + 2-minute video, repo public. Measure: players/world/day, rooms per session, messages to characters vs humans, sessions with 2+ humans in a room, day-7 return.

## Later

2D/mobile client on the same world file; claiming and building (fields reserved); voice; self-hosted Ethora Core guide.
