# World file schema (draft v0)

`worlds/<slug>/world.json`. Everything a client, the generator and the world service need. Ethora ids are filled in by the provisioning step and kept in a separate gitignored `worlds/<slug>/ethora.json` (appId, chatIds, agentIds) so the world file itself is shareable.

```jsonc
{
  "schema": "bookworld/0",
  "slug": "alice",
  "title": "Alice's Adventures in Wonderland",
  "source": { "title": "Alice's Adventures in Wonderland", "author": "Lewis Carroll", "year": 1865,
              "text": "gutenberg:11", "license": "public-domain" },   // license: public-domain | original | cc-by | cc-by-sa | private-attested
  "start": "rabbit-hole",
  "rooms": [
    {
      "id": "rabbit-hole",
      "name": "The Rabbit Hole",
      "description": "A long dark well lined with cupboards and bookshelves...",   // shown on entry ("look")
      "exits": { "n": null, "e": "hall-of-doors", "s": null, "w": null },          // room ids; null = wall
      "wallpaper": "assets/textures/brown_planks_07.jpg",                          // 2D background / 3D wall texture; null = procedural pattern from the palette
      "floor": "assets/textures/brown_mud_leaves_01.jpg",                          // 3D floor texture; null = procedural
      "music": { "file": "assets/music/Frost_Waltz.m4a", "title": "Frost Waltz",   // optional, loops, starts after the first click, crossfades on room change
                 "credit": "Kevin MacLeod (incompetech.com), CC BY 4.0", "volume": 0.35 },
      "scene": {                                                                    // optional 3D block
        "template": "box",                                                          // box: walls + ceiling; panorama: no walls, the 360 image is the sky, invisible boundary + door frames
        "size": [12, 4, 12],                                                        // metres, box template
        "palette": { "wall": "#6b5a3e", "floor": "#3a2f22", "ceiling": "#2a2218", "trim": "#c9a961" }, // used when no wallpaper image exists yet
        "panorama": "assets/panoramas/borghese_gardens_2k.hdr",                    // equirectangular .hdr or .jpg; required for the panorama template
        "props": [ { "kit": "kenney-furniture", "id": "bookshelf", "pos": [-4, 0, -5], "rotY": 0 } ],
        "spawn": [0, 0, 4],                                                         // where you appear on entry
        "exitWidth": 1.6                                                            // door width per open exit
      },
      "owner": null, "claimable": false, "claimedAt": null                          // reserved for the claiming phase
    }
  ],
  "characters": [
    {
      "id": "white-rabbit",
      "name": "The White Rabbit",
      "home": "rabbit-hole",                                                        // room id
      "persona": "You are the White Rabbit ... (the agent's full system prompt; the provisioner appends the room setting and the house rules)",
      "responseMode": "mentioned", "cooldownSec": 30,
      "knowledgeTags": ["alice-ch1", "alice-ch2", "alice-ch8"],                     // chapter files in worlds/<slug>/knowledge/<tag>.txt, uploaded to the agent by the provisioner
      "avatar": "assets/avatars/white-rabbit.vrm",
      "pos": [-3, 0, -4], "rotY": 3.14,                                             // optional standing spot in the home room (room-local metres)
      "wander": 1.2,                                                                // metres it strolls around that spot while idle (0 = stands still)
      "schedule": [ { "at": "*/15 * * * *", "do": "move", "to": "hall-of-doors" },  // cron, executed by the world service: the character walks out ("has left (E)") and its agent follows
                    { "at": "7 * * * *", "do": "say", "text": "Tea!" } ]
    }
  ],
  "scripts": [                                                                      // optional: enacted plays / set pieces
    { "id": "tea-party", "room": "tea-party", "trigger": { "cron": "0 20 * * *" },  // or { "onEnter": true } when a player walks in
      "cooldownSec": 180,                                                           // minimum gap between runs
      "lines": [ { "who": "hatter", "text": "Why is a raven like a writing-desk, {player}?", "waitMs": 6000 } ], // {player} = the name of who walked in
      "onInterrupt": "improvise-then-resume" }
  ]
}
```

3D convention: a room is centred on the origin, floor at y = 0, north wall at z = -depth/2, east wall at x = +width/2. A doorway sits in the middle of each wall that has an exit; you arrive 1.8 m inside the door you came through, facing into the room. Helpers in `shared/src/world.ts` (`doorPose`, `entryPose`, `layoutGrid`, `validateWorld`).

Character lines from scripts and schedules are posted by the world service as `**Name:** text`; clients show them as the character speaking (a bubble over the avatar). Narration ("X has joined (E)") is posted as `_italic_`. A player who names a character in chat makes it turn to face them for 30 s.

Rules: exits are symmetric (if A.e = B then B.w = A); the generator must enforce it and the server validates on load. Room ids are slugs. All asset paths are relative to the world folder. Rooms form a grid by construction, which gives the mini-map for free.

Generated worlds: `pnpm generate` writes this file from a book (docs/GENERATOR.md). It also writes `knowledge/<slug>-chN.txt` (one file per chapter, gitignored, rebuilt from `source.text` when missing), `draft.json` (the model's raw answer) and `generation.json` (model, options, warnings). Asset ids the generator may use are listed in `client/public/assets/manifest.json` and `client/public/assets/props/catalog.json`.
