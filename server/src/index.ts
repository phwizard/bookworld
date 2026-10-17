import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import cors from 'cors';
import { COLYSEUS_ROOM_NAME, type EnterResponse, type EthoraPublicInfo } from '@bookworld/shared';
import { loadWorlds, listWorlds, getWorld } from './world/load.ts';
import { LocationRoom } from './rooms/LocationRoom.ts';
import { cleanName, newPlayerId, signSession } from './auth.ts';
import { ethoraFor } from './services.ts';
import { tryEthora } from './ethora.ts';

const PORT = Number(process.env.PORT ?? 2567);
const ORIGIN = process.env.CORS_ORIGIN ?? '*';

const worlds = loadWorlds();
console.log(`[worlds] loaded: ${[...worlds.keys()].join(', ')}`);

function ethoraInfo(slug: string, playerId: string | null): EthoraPublicInfo {
  const e = ethoraFor(slug);
  return {
    enabled: e.enabled,
    appId: e.appId,
    apiBaseUrl: e.apiBaseUrl,
    xmppDomain: e.xmppDomain,
    rooms: e.roomJids(),
    chatToken: playerId ? e.chatToken(playerId) : null,
  };
}

const server = new Server({
  transport: new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 }),
  express: (app) => {
    app.use(cors({ origin: ORIGIN === '*' ? true : ORIGIN.split(',') }));
    app.use(express.json({ limit: '16kb' }));

    app.get('/api/health', (_req, res) => res.json({ ok: true, worlds: [...worlds.keys()] }));

    app.get('/api/worlds', (_req, res) => {
      res.json(listWorlds().map(({ world }) => ({ slug: world.slug, title: world.title, rooms: world.rooms.length, license: world.source.license })));
    });

    app.get('/api/worlds/:slug', (req, res) => {
      const loaded = getWorld(req.params.slug);
      if (!loaded) return res.status(404).json({ error: 'unknown world' });
      res.json({ world: loaded.world, ethora: ethoraInfo(loaded.world.slug, null) });
    });

    // Enter a world as a guest with just a display name. Creates the Ethora identity, grants the start
    // room, and returns a world session token plus the chat token for the chat component.
    app.post('/api/worlds/:slug/enter', async (req, res) => {
      const loaded = getWorld(req.params.slug);
      if (!loaded) return res.status(404).json({ error: 'unknown world' });
      const name = cleanName(req.body?.name);
      if (!name) return res.status(400).json({ error: 'name required (1-24 characters)' });
      const playerId = newPlayerId();
      const ethora = ethoraFor(loaded.world.slug);
      if (ethora.enabled) {
        const ok = await tryEthora('create guest', () => ethora.createGuest(playerId, name));
        if (!ok) return res.status(502).json({ error: 'could not create chat identity' });
        await tryEthora('grant start room', () => ethora.grant(loaded.world.start, playerId));
      }
      const token = signSession({ pid: playerId, name, world: loaded.world.slug });
      const body: EnterResponse = { token, playerId, name, world: loaded.world, ethora: ethoraInfo(loaded.world.slug, playerId) };
      res.json(body);
    });
  },
});

server.define(COLYSEUS_ROOM_NAME, LocationRoom).filterBy(['world', 'location']);

await server.listen(PORT);
console.log(`[bookworld] world service on :${PORT}`);
