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
import { cleanVisitor, record, readEvents } from './metrics.ts';
import { buildReport } from './metrics-report.ts';

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

    // Usage report (players per day, rooms per session, messages to characters, meetings, day-7 return).
    // Only served when METRICS_TOKEN is set; pass it as `Authorization: Bearer <token>`.
    app.get('/api/metrics', (req, res) => {
      const token = process.env.METRICS_TOKEN;
      if (!token) return res.status(404).json({ error: 'metrics endpoint is off (METRICS_TOKEN not set)' });
      if (req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ error: 'bad token' });
      const since = typeof req.query.since === 'string' ? req.query.since : undefined;
      res.json(buildReport(readEvents(), { since }));
    });

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
      record({ ev: 'enter', world: loaded.world.slug, pid: playerId, visitor: cleanVisitor(req.body?.visitor) });
      const body: EnterResponse = { token, playerId, name, world: loaded.world, ethora: ethoraInfo(loaded.world.slug, playerId) };
      res.json(body);
    });
  },
});

server.define(COLYSEUS_ROOM_NAME, LocationRoom).filterBy(['world', 'location']);

await server.listen(PORT);
console.log(`[bookworld] world service on :${PORT}`);
