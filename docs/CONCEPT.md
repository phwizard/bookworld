# Concept (founder's note, 17 Oct 2026, verbatim)

Please read below the concept I'd like to experiment with. The idea is to use Ethora infrastructure, API / MCP, SDK where possible to leverage the maximum of it and demonstrate its capabilities, and if this gets popular to attract more users and builders to our product. That said, this could be under a different brand / website name and in a different open-source repo, as it's quite different from the core use case of Ethora engine. The work name is 'bookworld' but we might change this if we decide to put it live.

CORE CONCEPTS
(text / chat version, built on top of standard Ethora Chat Component)
1. Any user can only be present in one room at a time (so it's less like a messenger and more like a multi-player online world)
2. User can travel between adjacent rooms.
3. "Adjacent" currently means that each room faces four directions (N, E, S, W) with its edges / walls, and so all existing rooms can be sort of laid out on a map and connected to each other.
4. In basic version, user is given simple navigation buttons that allow the user to move into another ajacent room.
5. When user has left or joined a room, a system message will be sent into room notifying others, e.g. "John Doe has joined (E)", "John Doe has left (W)"

This leaves users to chat as they would normally do, but it adds a fuller "presence" experience in that user is able to travel and can only be present in one room. It also adds that geographic / map dimension in that users will be aware of different locations and that they might meet other users or NPC / bots in there. This allows for more sophisticated interactions and settings.

Map building
* We could allow users to create their own rooms / locations.
* The mechanism to do this collaboratively on a multi-tenant server could be that users can either for free or for certain virtual currency payment claim a room / location adjacent to another room, as long as that direction is free.
* In a crowd-sourced world / server we would probably have to introduce certain mechanisms to make it balanced and interesting for everyone, e.g. introduce core / basic map first before users start claiming, introduce certain roads / corridors / transport links close to initial start location, allowing to connect and claim multiple locations to reduce the scarcity around the centre; mechanisms limiting the amount of rooms a user can claim; possibly mechanism allowing user to claim a limited number of adjacent rooms to their own one, 'pushing back' the ones connected by third parties, to implement their plans.
* That said, in the first experimental version we don't have to allow claiming or building, we could simply seed a 'world' or two based on a certain specific fable (see below) and test multi-player experience that way before we decide on this iteration.

Book world
* The idea here is to use this engine + leverage the underlying Ethora infrastructure (chat server, API, MCP etc) to allow people to bring to life a certain book, story or fable they are fond of. Our system will (1) read their book / story (or simply take it from LLM memory if it is well known), (2) create rooms corresponding to important locations in the book / story; (3) create characters as AI agents. Users will then be able to join the world (server / application) on the given URL, 'travel' the locations, interact with AI agents and other players.
* To start with, we could first implement the core engine with locations and in-room presence, + simple frontend for navigation e.g. to the side of the main chat component view there could be movement controls, a simple map, their own profile etc.

3D version
* I'm contemplating whether to go with 2D version first or whether to build a 3D version straight away. 3D version could be more immersive for human users if done right, but I'm not sure which is best at the moment. We could build both and try I guess. A 3D version would be pretty much same concept, but rendered in WebGL or some other stack that allows the user to walk inside the room, chat and travel this world in first person mode.
* For this mode, we would need to introduce certain 'space' which would be walkable by human users and AI agents within each room and I guess in this case chat won't be a flat room surface, but it will be chat bubbles displayed on top / next to 3D avatars of the users. If we allow voice, then volume will have to fade away depending on the distance.
* I assume we'd need usual 3D controls: WASD movement + mouse to turn around + shift to run
* In this mode users would need to walk towards the border of the room to switch to another room

Other
* For both 2D and 3D it would be beneficial if we could set wallpaper background and possibly music / soundtrack background to the rooms to improve the immersive experience relevant to the story / world we are creating.

## Decisions taken 17 Oct 2026

- Go ahead as an experiment. 3D first (experimental), world file kept renderer-neutral so a 2D client can follow.
- Private repo on `phwizard`, MIT from the first commit, public when playable. Name question parked.
- Separate project and Claude context from the Ethora product repos and from the business-ops workspace. Ethora is used only through its public surface; gaps are recorded in `docs/ETHORA-GAPS.md` and fixed by the owner in the Ethora repos.
- Content policy: hosted/featured worlds use public-domain, original or CC text; private worlds may use uploaded text on the uploader's attestation; a generator "transform" mode (keep structure, rename names) is a planned feature.
- First worlds: Alice in Wonderland; then an enacted Shakespeare play (The Tempest or A Midsummer Night's Dream) with scheduled performances agents perform from script and humans can interrupt.
- Seeded worlds only; no claiming/building until there is a population to balance for (fields reserved in the world file).

## Where the longer analysis lives

The concept review that produced these decisions (Ethora primitive mapping, 2D vs 3D trade-offs, copyright analysis, public-domain world list, enacted-play mechanics, hosting) is in the owner's business workspace at `ethora-bdsm/data/reports/261017_bookworld-concept-review.md`. Ask the owner for it if needed; this project does not read that workspace.
