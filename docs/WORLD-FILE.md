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
      "wallpaper": "assets/rabbit-hole.jpg",                                       // 2D background / 3D wall texture
      "music": "assets/rabbit-hole.mp3",                                            // optional, loops, user-gesture gated
      "scene": {                                                                    // optional 3D block
        "template": "box",                                                          // box | panorama | custom-gltf
        "size": [12, 4, 12],                                                        // metres, box template
        "palette": { "wall": "#6b5a3e", "floor": "#3a2f22", "ceiling": "#2a2218", "trim": "#c9a961" }, // used when no wallpaper image exists yet
        "panorama": "assets/rabbit-hole-360.jpg",                                   // optional skybox
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
      "persona": "You are the White Rabbit ... (soulMd)",
      "responseMode": "mentioned", "cooldownSec": 30,
      "knowledgeTags": ["ch1", "ch2", "ch8"],                                       // RAG tags over the source text
      "avatar": "assets/avatars/white-rabbit.vrm",
      "pos": [-3, 0, -4], "rotY": 3.14,                                             // optional standing spot in the home room (room-local metres)
      "schedule": [ { "at": "*/15 * * * *", "do": "move", "to": "hall-of-doors" } ] // executed by the world service
    }
  ],
  "scripts": [                                                                      // optional: enacted plays / set pieces
    { "id": "tea-party", "room": "tea-party", "trigger": { "cron": "0 20 * * *" },
      "lines": [ { "who": "hatter", "text": "Why is a raven like a writing-desk?", "waitMs": 6000 } ],
      "onInterrupt": "improvise-then-resume" }
  ]
}
```

3D convention: a room is centred on the origin, floor at y = 0, north wall at z = -depth/2, east wall at x = +width/2. A doorway sits in the middle of each wall that has an exit; you arrive 1.8 m inside the door you came through, facing into the room. Helpers in `shared/src/world.ts` (`doorPose`, `entryPose`, `layoutGrid`, `validateWorld`).

Rules: exits are symmetric (if A.e = B then B.w = A); the generator must enforce it and the server validates on load. Room ids are slugs. All asset paths are relative to the world folder. Rooms form a grid by construction, which gives the mini-map for free.
