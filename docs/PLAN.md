# Plan

## Phase 0: 3D spike (target 3-4 weeks)

Scope: one world (`worlds/alice`, 4 rooms: Rabbit Hole, Hall of Doors, Garden, Tea Party), box-room template with generated wallpapers, two players walking and seeing each other, speech bubbles mirroring Ethora chat, walking through a door = Colyseus room switch + Ethora room switch + "has joined (E)" / "has left (W)" system messages, one character (the Mad Hatter) standing in the Tea Party answering when addressed. Mini-map from the grid. No music, no voice, no generator yet (world.json written by hand).

Exit test: a second person on another machine enters from a link, walks to the Tea Party, talks to the Hatter and to the first person, and leaves; both see the correct join/leave lines in both clients.

Steps:
1. Repo scaffold (pnpm workspaces: client, server, worlds). Gitleaks hook.
2. Ethora App for the Alice world created via MCP or admin; 4 rooms; 1 agent (Hatter: persona, `responseMode: mentioned`, `cooldownSec: 30`, Alice text chapters 7 as knowledge). Ids into `worlds/alice/ethora.json` (gitignored).
3. Server: Colyseus with a `LocationRoom` per world room; player state (pos, rotY, name); `move(direction)` handler that validates the exit, calls Ethora remove/add, posts system messages, hands the client to the next Colyseus room.
4. Client: R3F scene from the box template; ecctrl controller; VRM avatar with Mixamo idle/walk/run; remote players interpolated; doors as trigger volumes.
5. Chat panel: chat component in single-room mode; guest login through the server (`customLogin`); bubbles (resolve ETHORA-GAPS #1).
6. Narrator user + `customSystemMessage` for movement lines.
7. Hatter: agent invited to the Tea Party room; verify it answers when mentioned and stays quiet otherwise.
8. Deploy server to the droplet, client to Vercel, run the exit test with a second person.

## Phase 1: Playable (after Phase 0 passes)

Generator (text -> world.json -> provisioning), panorama rooms, music, two worlds (Alice; The Tempest as an enacted play with scheduled performances), character schedules, world submissions by PR, README + 2-minute video, repo public. Measure: players/world/day, rooms per session, messages to characters vs humans, sessions with 2+ humans in a room, day-7 return.

## Later

2D/mobile client on the same world file; claiming and building (fields reserved); voice; self-hosted Ethora Core guide.
