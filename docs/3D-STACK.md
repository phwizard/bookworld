# 3D stack: options and the recommendation

Decision 261017: 3D first, experimentally. Engine and netcode choices below; the reasoning for each alternative is kept so the decision can be revisited.

## Rendering engine

| Option | For | Against | Verdict |
|---|---|---|---|
| **Three.js via React Three Fiber** (+ drei, rapier, ecctrl) | Same React/TS stack as the chat component; huge ecosystem; ecctrl gives WASD + mouse-look + run out of the box; drei `<Html>` for name labels and bubbles; rapier for collision | You assemble the engine yourself (no editor, no scene tooling) | **Pick** |
| Babylon.js | Batteries included (physics via Havok, GUI, loaders, inspector), excellent docs, Microsoft-backed | Less idiomatic in React; smaller React community | Fallback if R3F assembly becomes the bottleneck |
| PlayCanvas | Visual editor, open-source engine, good web performance | Editor is a hosted service; React integration awkward | No |
| Godot 4 web export | Real game engine, scene editor, GDScript | Web export needs SharedArrayBuffer headers, large downloads, mobile Safari issues; JS interop friction with the chat component | No for a web-first project |
| Unity WebGL | Mature | Huge builds, slow loads, licensing, poor fit with a React chat UI | No |

## Multiplayer positions (separate from chat)

Chat, identity, agents and messages stay on Ethora (XMPP, message-grained). Avatar positions need 10-20 updates/s with interpolation; never send them through Ethora.

| Option | For | Against | Verdict |
|---|---|---|---|
| **Colyseus** (Node, MIT) | Room-based authoritative server with schema state sync; one Colyseus room per world location mirrors one Ethora room per location; join/leave events line up with "X has joined (E)"; TypeScript; well documented | Needs a persistent-WebSocket host (droplet, not Vercel functions) | **Pick**. The Colyseus server is the world service. |
| Trystero / PlayroomKit (P2P WebRTC) | No server, free | Trust (clients authoritative), NAT edge cases, breaks beyond ~8 peers | Prototype-only |
| Nakama / Hathora | Full game backend | Heavier than needed; another system to run | No |

## Rooms (geometry)

1. **Box room template (default).** Floor, four walls, ceiling optional, a doorway in each wall that has an exit. Wallpaper = a generated image tiled or stretched per wall, so the concept's "wallpaper" is literal. Props from CC0 glTF kits placed by the generator from a small catalog (`props.json`). Cheap, consistent, every room looks like it belongs to the same world, and a text pipeline can produce it.
2. **Panorama room.** A 360 image (Skybox AI / Blockade Labs, or a diffusion panorama model) as skybox plus a flat floor disc and four exit portals. Strong mood for outdoor scenes (a forest, the sea) where a box is wrong. Can also sit behind the box's windows.
3. **Custom glTF** for hand-built showcase rooms later.
4. Not in v1: AI mesh generation (Meshy, Tripo, Hunyuan3D), Gaussian splats.

## Avatars and characters

- **VRM** (open humanoid format) via `@pixiv/three-vrm`; VRoid Studio to make avatars for free; many CC0/CC-BY VRMs exist. Animations from **Mixamo** (idle, walk, run, talk) retargeted to VRM.
- Players: first person by default (ecctrl), third person toggle. Name label and the last message as a bubble (drei `<Html>`), fading after ~8 s.
- Characters: same avatars, driven by the server: idle wander inside the room, turn to face and approach the player who addressed them, walk through a door when their schedule moves them.

## Chat inside 3D

- `@ethora/chat-component` mounted as a slide-in panel (T or Enter toggles, Esc closes and returns pointer lock). `customRooms.singleRoom` + `disableRooms` + `forceSetRoom`, re-pointed on every room change. Header hidden.
- Bubbles need incoming messages (ETHORA-GAPS #1). First spike task: find a hook in the component's store; otherwise poll the messages endpoint for the current room.
- Movement and system messages (`X has joined (E)`) are posted by the world service as a narrator user and rendered with `customSystemMessage`.

## Controls

WASD move, mouse look (pointer lock), Shift run, Space none (no jumping in v1), E interact (face the nearest character and open chat with them mentioned), T/Enter chat, M map, Esc release. Mobile: out of scope for the 3D client; the 2D client (later) covers it.

## Voice

Not in v1. If added: WebRTC mesh with per-peer gain by distance (Web Audio PannerNode) up to ~6 peers; LiveKit SFU beyond that.

## Known costs of going 3D first (accepted 261017)

Two realtime systems; per-room content; avatar rigging and NPC steering; desktop-only; bundle size; a 3-4 week Phase 0 instead of one week; results confound "do people like book worlds" with "is the 3D good enough". Mitigations: box-room template, kit assets, VRM, one world of 4 rooms for Phase 0, and the world file kept renderer-neutral so a 2D client can be added for mobile and for a cleaner read of the hypothesis.
