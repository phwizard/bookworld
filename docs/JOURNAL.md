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

## 18 Oct 2026: the generator, the provisioner and the first numbers

**Measurement first, because it is small.** The world service now appends one JSON line per event to a local file: enter (with an anonymous id the browser keeps), join (room, door, who was already there), leave, message (only whether it named a character; never the text). `pnpm metrics` turns that into the numbers the plan asks for: sessions and visitors per day, rooms per session, messages to characters against messages to humans, sessions that shared a room with another human, and day-7 return. The same report is served at `/api/metrics` behind a token for the deployed server. A walk through four rooms and two chat lines produced the first report: rooms per session 4, messages 2, one of them to the Hatter.

**The generator.** `pnpm generate -- --gutenberg 11` fetches the book from Project Gutenberg, strips the wrapper, splits chapters (the table of contents is recognised and dropped because its "chapters" are a few lines long), and hands the model the whole text with the lists of what it may use: textures, panoramas, music, avatars from a new asset manifest, props from the catalog. The model answers with a draft, not a world: rooms on an integer grid with links between adjacent cells, asset ids, chapter numbers, personas, greeting scripts. A converter turns that into world.json and fixes what models get wrong: diagonal links are dropped, unreachable rooms are linked to a reachable neighbour, props that are not in the catalog disappear, props standing in a doorway are removed, tabletop and flat items get their flags, cooldowns are clamped, every long dash becomes a hyphen. Then the normal validator runs and, if it complains, the model is asked once for a repair with the list of problems.

Two model backends: the Anthropic API when a key is present, otherwise the Claude Code CLI already on the machine (`claude -p` with tools off and a JSON schema), which is how the first run went. Alice in Wonderland, six rooms, three characters: one attempt, no warnings, $2.93, four minutes. The model chose the Rabbit-Hole, the Long Hall (three exits), the Mushroom Wood with the Caterpillar, the Mad Tea-Party as a panorama room, the Queen's Croquet-Ground and the Court of Justice, wrote personas that quote the book, gave the Queen a schedule that takes her to the court every two hours, and put "Off with their heads!" on the three-quarter hour.

![the generated Rabbit-Hole](journal/261018-01-generated-rabbit-hole.jpg)
![the generated Long Hall with three exits](journal/261018-02-generated-long-hall.jpg)

**The provisioner.** `pnpm provision -- --world alice` does over the hosted Ethora MCP what was done by hand on day one: app, one chat room per location, one agent per character with the persona plus the room's setting and the house rules, the chapter files uploaded into the agent's own knowledge base, visibility set to unlisted (so the world service can move the agent later), invite into the home room. Every step lands in the gitignored `ethora.json` as soon as it succeeds, so a rerun continues where it stopped and a finished world reports "nothing to do". It authenticates with an Ethora user API key sent as a bearer header, which is how the hosted MCP serves headless clients. The claude.ai connector used in these sessions hides the tool that mints such keys (ETHORA-GAPS #15), so the real run against Ethora waits for a key from the owner; until then the provisioner is tested against a mock MCP server that answers with the shapes the real tools returned on day one, including a wrong-key run and the idempotent rerun.

Also learned: the Claude Code CLI refuses to start inside another Claude Code session unless the `CLAUDECODE` variable is removed from the child's environment; and pnpm's `pnpm --filter pkg script` shorthand does not resolve for a freshly added package, so the root scripts say `run` explicitly.

## 18 Oct 2026, afternoon: sound

The owner asked for steps, world sounds and voices. Three layers, all client side, nothing new on the server.

**Footsteps.** Every avatar already reports idle, walk or run, so a small stepper plays a sample at a walking or running cadence whenever the state says moving, with a little pitch jitter so five samples do not sound like a metronome. The room's floor picks the set: `surface` in the world file, or a guess from the floor texture name (planks are wood, tiles are stone, grass is grass). Samples are Kenney's CC0 Impact Sounds. Your own steps play in your head, quietly; other players' and characters' steps go through a panner at their position, with the audio listener glued to the camera each frame, so the Hatter walking round the table is heard on the right side.

**Doors, clicks, ambience.** A door creak on each room change, open and close clicks on the chat panel, a soft drop when someone else speaks. Ambience without files: four small Web Audio generators, drips with a cave echo for the well, a ticking clock for the hall and the tea party (it is always six o'clock), birds and wind for the garden. The world file lists presets per room, so a generated world gets them from the model like the music.

**Voices.** Characters read their lines through the browser's speech synthesis, off by default, V to switch on. Each character gets a fixed voice, pitch and pace from a hash of its name, so the Hatter stays the Hatter. Scripted lines and agent replies are spoken; human messages never are. The sequence that convinced me: walked into the tea party, the greeting came up as a bubble and was spoken; asked the Hatter about the date, the agent's reply was spoken too. Cloud voices can replace this later behind the same switch if the usage report shows people keep it on.

Verified in Chrome with the dev counters: wood steps in the well, stone in the hall, grass outside, the door on each change, chat open and close, two greeting lines and one reply spoken.

![the Tea Party with voices on](journal/261018-03-tea-party-voices-on.jpg)

## 18 Oct 2026, evening: a daily budget

"When we expose this to the public they will not bankrupt us." Two meters. The first counts paid character replies: every message that names a character present in the room makes its agent answer, so the world service counts those per world and per visitor per day and persists the count. At the world limit the characters rest until the daily reset: every client gets the state over the Colyseus room, the HUD says so, the rooms get a narration line, and the chat panel's outgoing text gets a zero-width space inside each character's name (it reads the same to people, but the agent's mention matcher no longer fires). The per-visitor share works the same way for one person. The app's server token is not allowed to change an agent (403), so the real off switch, setting the agents to answer with probability zero, runs over the hosted MCP with a user API key when one is configured; without it the client-side gate is the only guard, which is enough against ordinary use and not against someone scripting the XMPP connection. Ethora's own plan limits sit in front of all this.

The second meter is the generator: runs and dollars per day in the same budget file. The CLI backend reports real cost, the API backend estimates it from tokens. It only guards the owner's own runs today, but a public "turn my book into a world" button would hit the same ledger.

Checked live with the limit set to two: the third question to the Hatter went out with a zero-width space inside "Hatter" and he stayed quiet; the notice appeared at the top of the screen; `/api/ai-budget` showed used 2, asleep true.

![the characters resting after the daily limit](journal/261018-04-characters-resting.jpg)

## 18 Oct 2026, night: being away, coming back

The owner asked what happens to someone who is inactive or disconnected. The honest answer was: a drop meant "has left" after fifteen seconds with no way back except a reload as a stranger, and an idle tab stayed "here" forever. Three changes.

**A minute to come back.** When a connection drops without a goodbye, the server keeps the seat for sixty seconds (the avatar waits, marked away) and the client tries to reconnect every few seconds; the same seat, no narration. If the window passes, the client rejoins at the same spot as a fresh arrival. Tested by closing the socket from the console: "Reconnected" came back in under a second, same session id.

**A reload is not a new visit.** The session token, the room and the last position now live in the tab; on reload the client asks the server to resume, gets fresh chat credentials for the same identity, and joins the same room at the same spot ("Alice is back" rather than "Alice has arrived"). The usage report counts no new session. Along the way the chat identity moved from one Ethora user per entry to one per visitor and name, so coming back as Alice is the same chat user and the app's user list stops growing with every visit. A "Leave" link in the bottom line forgets the visit.

**Away, then gone.** Five idle minutes mark the player away (others see "(away)", the room count skips them, the bottom line says so); twenty minutes and the client leaves the room with "has wandered off", shows a dark screen, and any key brings the player back to the same spot. Tested with the timers set to eight and twenty seconds.

One side effect found on the way: React's StrictMode runs effects twice in development, which has joined every room twice since day one, and with the reconnection window the first seat now lingered as a ghost for a minute. StrictMode is gone.

Also from the owner, the same evening: the chat panel is translucent now and you can keep walking while it is open. T puts the cursor in the message box, Esc takes it out again (keys walk, the panel stays for reading), a second Esc closes the panel.

![wandered off, with the translucent panel](journal/261018-05-wandered-off-translucent-chat.jpg)
