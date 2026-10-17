# bookworld journal

A running record of what was built, what broke, and what it looked like. Screenshots live in `docs/journal/`. Written for a future blog post or book about building the engine, so decisions and dead ends are kept, not just results.

## 17 Oct 2026, day one

**Morning: the brief.** Concept, plan, world file schema, 3D stack decision and the Ethora facts and gaps were written up before any code (commit `73ee5ef`). Decisions: 3D first, Three.js through React Three Fiber, Colyseus as the world service, Ethora untouched and used only through its public surface, the world file as the product.

**Afternoon: scaffold and the movement loop (commit `dcac1b4`).** pnpm workspaces (client, server, shared, worlds), gitleaks hook. The Alice world written by hand: Rabbit Hole, Hall of Doors, Garden, Tea Party in a line, the Hatter at the Tea Party. The Ethora App, four rooms and the Hatter agent were provisioned over the hosted MCP in a few minutes; chapter 7 of the book went in as the Hatter's knowledge and the first test reply quoted the Queen's concert.

Surprises while installing: pnpm 12 blocks git-hosted subdependencies (the `colyseus` meta package pulls uWebSockets.js from git, so `@colyseus/core` + `@colyseus/ws-transport` are used instead) and needs an `allowBuilds` list; Colyseus 0.18's browser package is `@colyseus/sdk`, not `colyseus.js`; ecctrl 2.0 reads input only through `setMovement` and has no first-person camera, so the camera is driven by drei's pointer-lock control and glued to the capsule each frame.

The box-room template got procedural wallpaper from a canvas (base colour, faint diamonds in the trim colour, grain) because no wallpaper images existed yet. Door detection is by position: standing inside a doorway on a wall with an exit sends `move`. The server validates, grants the next Ethora room, narrates "has left (E)", and the client leaves the Colyseus room and joins the next one at the opposite door.

![join screen](journal/261017-01-join-screen.jpg)
![the Rabbit Hole, version 0](journal/261017-02-rabbit-hole-v0.jpg)

Verified with two browser tabs: both walked Rabbit Hole to Hall of Doors through the door, each saw the other as a capsule with a name label, "2 here" in the HUD, and the server log showed "Alice has left (E)" then "Alice has joined (W)".

**Evening: chat (commit `dd7ad58`).** With the App Secret in `.env`, guests get an Ethora identity through `@ethora/sdk-backend` and a client JWT for the chat component. Three things cost an hour: the SDK wants the API host root rather than `/v1`; the broadcast endpoint rejects a per-message sender name, so narration arrives under the app's name; and the chat panel sat on "Connecting..." until the XMPP endpoint was passed in `xmppSettings` and `initBeforeLoad` was turned off. Also learned that MCP-created rooms are public app chats, so every user is in all of them and the access grant endpoint cannot see them: "one room at a time" is enforced by the client pinning the panel, which is enough for a demo.

The first conversation from inside the 3D client: walk three rooms, press T, "@Hatter good evening", and the Hatter answered in about five seconds.

![the Tea Party with capsule avatars](journal/261017-03-tea-party-v0-capsules.jpg)

**Night: pointer lock, props, people (this entry).** Two bugs the owner noticed on first play had one cause: every door walk rebuilt the whole WebGL canvas. Now one canvas lives for the whole visit and only the room contents swap (commit `8a80911`). A second effect, the scene scrolled 393 px sideways, came from the hidden chat panel being slid outside its container: the browser scrolled to it when the chat input took focus.

Then props and characters. CC0 kits only: Kenney's furniture and food kits (glTF, tiny files, vertex colours) and the KayKit Adventurers pack (five rigged low-poly characters with Idle, Walking and Running clips baked in). No Mixamo, which needs an Adobe login, and no VRM for now; the loader can take VRM later. A props catalog maps ids like `teacup` or `bookcase` to kit files and scales; the world file places them by id. The Hall of Doors got its row of locked doors and the glass table with a bottle on it, the Tea Party its long table, chairs, cups, cake and a honey jar; the Hatter wears the Mage's purple hat.

![the Rabbit Hole with bookcases](journal/261017-04-rabbit-hole-props.jpg)
![the Hall of Doors](journal/261017-05-hall-of-doors-props.jpg)
![the Tea Party with a very small Hatter](journal/261017-06-tea-party-props-tiny-hatter.jpg)

The small Hatter: the glb's mesh bounds say 3.3 units tall, but the character is modelled at about 1.75 m, so the first scale guess made him knee-high. Fixed to scale 1.

![the Hatter at the table](journal/261017-08-hatter-at-table.jpg)

Speech bubbles: the chat component's `CustomScrollableArea` prop hands over the room's messages, so new lines from other people float above their avatar for eight seconds. Narration lines render as quiet italic system text in the panel. Verified with a second player (Bob, on a second origin so the browser sessions stay apart): his line appeared over his head in Alice's view.

Two things to remember: after a Vite hot reload the physics world and the animation mixer can be left stale (the Hatter stood in a T-pose once), so test after a full reload; and the Hatter's bot instance went silent after about twenty minutes while the agent itself still answers in a direct test (ETHORA-GAPS #13).

![T-pose after a hot reload](journal/261017-09-hatter-tpose-after-hot-reload.jpg)

## 17 Oct 2026, late evening: Phase 1 items 3 to 6

**Rooms that look like places.** The owner picked panorama rooms, wallpaper images, music and character life from the Phase 1 list. With no image generator in the loop, the sources are Poly Haven (CC0 HDRIs and PBR textures with a public API and direct file links) and Kevin MacLeod's CC BY music. The Garden is now a panorama room: a 2k HDRI of the Borghese gardens as sky and light, a grass floor three rooms wide so the horizon meets the picture, invisible walls, free-standing door frames. The closed rooms got real textures: planks and leaf litter in the well, patterned plaster and a checkered floor in the Hall, a leafy hedge and grass at the Tea Party. The Poly Haven tonemapped JPGs are 50 MB each, so the 2k `.hdr` (7 MB) goes straight into drei's `Environment`.

![the Rabbit Hole with textures](journal/261017-12-rabbit-hole-textures.jpg)
![the Hall of Doors with textures](journal/261017-13-hall-of-doors-textures.jpg)
![the Garden as a panorama room](journal/261017-14-garden-panorama.jpg)
![the Garden, looking at the house](journal/261017-15-garden-house-view.jpg)

**Music.** One looping track per room from the world file, with title and credit in the HUD, N to mute. Browsers refuse autoplay, so the track starts on the first click (the same click that captures the mouse) and crossfades on room change. The MP3s were 3 to 9 MB each; `afconvert` on the Mac re-encodes them to 1 to 2 MB AAC.

**Character life.** The world service now runs one simulation per world. The Hatter strolls within a metre of his spot, turns to face anyone who names him in chat (the client reports the mention, the server rotates him and holds him still for 30 s), walks to the Garden every 20 minutes and back five minutes later on a cron schedule, and greets whoever walks into the Tea Party ("No room! No room!" then "Oh, very well, Alice...") with a 3-minute cooldown. Scripted lines are posted as `**Hatter:** text` and the client shows them as the character speaking, with a bubble.

Three things bit on the way. Character lines first went out wrapped as narration, so the client filed them as system text. The bubble scanner then ignored them because the chat component flags every app broadcast as a system message. And the component mutates its message arrays in place, so an effect keyed on the array never re-ran; the scanner now runs after every render and keeps a set of seen ids. Worth saying again: after a hot reload the chat panel kept running the old message list code, so each of these took a full reload to confirm.

![the Hatter greets a newcomer](journal/261017-16-hatter-greets-bubble.jpg)
![the Hatter turns to face Alice and answers](journal/261017-17-hatter-turns-and-answers.jpg)

The last picture is the whole idea in one frame: the player wrote "Hatter, your watch is two days wrong", the character turned round, and the agent answered from chapter 7.

On the chat side the move between rooms is half done: with the agent set to "unlisted" the server token can invite it into the next room, but `leave-chat` answers 403, so the agent stays a member of every room it has visited (ETHORA-GAPS #14). Since it only answers when named, that is tolerable for now.
