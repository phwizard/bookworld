// The Ethora backend SDK prints every request payload (guest passwords, server tokens) at debug level unless
// NODE_ENV is production. Nothing here depends on NODE_ENV otherwise. (ETHORA-GAPS #19)
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import cors from 'cors';
import { COLYSEUS_ROOM_NAME, type EnterResponse, type EthoraPublicInfo, type StatsResponse, type WorldCard } from '@bookworld/shared';
import { getJob, makeStatus, submit, validateRequest } from './make.ts';
import { stats as presenceStats, visited } from './presence.ts';
import { loadWorlds, listWorlds, getWorld } from './world/load.ts';
import { LocationRoom } from './rooms/LocationRoom.ts';
import { cleanName, ethoraUserId, newPlayerId, signSession, verifySession } from './auth.ts';
import { budgetFor, ethoraFor } from './services.ts';
import { tryEthora } from './ethora.ts';
import { cleanVisitor, record, readEvents } from './metrics.ts';
import { buildReport } from './metrics-report.ts';
import { budgetConfigFromEnv } from './budget.ts';
import { existsSync, readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 2567);
// Unset: every interface (LAN play in development). Production sets 127.0.0.1 and lets Caddy face the internet.
const HOST = process.env.HOST || undefined;
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

    // Daily AI budget per world (public: no secrets, lets a status page show when the characters are resting).
    app.get('/api/ai-budget', (_req, res) => {
      const out: Record<string, unknown> = {};
      for (const { world } of listWorlds()) out[world.slug] = budgetFor(world.slug).snapshot();
      // the generator writes its own day's runs and spend into the same file
      const file = budgetConfigFromEnv().file;
      let generator: unknown = null;
      if (file && existsSync(file)) {
        try { generator = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)['_generator'] ?? null; } catch { /* ignore */ }
      }
      res.json({ ...out, _generator: generator });
    });

    const cards = (): WorldCard[] =>
      listWorlds().map(({ world }) => {
        const p = presenceStats(world.slug);
        return {
          slug: world.slug,
          title: world.title,
          summary: world.summary ?? null,
          author: world.source.author,
          year: world.source.year ?? null,
          license: world.source.license,
          rooms: world.rooms.map((r) => ({ id: r.id, name: r.name, here: p.byRoom[r.id] ?? 0 })),
          characters: world.characters.map((c) => ({ id: c.id, name: c.name, home: c.home })),
          online: p.online,
          lastActivity: p.lastActivity,
          messages: p.messages,
          visits: p.visits,
          chat: ethoraFor(world.slug).enabled,
          resting: budgetFor(world.slug).snapshot().asleep,
        };
      });

    // The world picker: what each world is, who is in it now, when it was last alive. Public, CORS open,
    // cacheable for a few seconds so a home page can poll it.
    app.get('/api/worlds', (_req, res) => {
      res.setHeader('cache-control', 'public, max-age=5');
      res.json(cards());
    });

    // One call for a home page: online visitors, totals, and the cards.
    app.get('/api/stats', (_req, res) => {
      const w = cards();
      const body: StatsResponse = {
        generatedAt: new Date().toISOString(),
        online: w.reduce((n, c) => n + c.online, 0),
        worlds: w,
        totals: {
          worlds: w.length,
          rooms: w.reduce((n, c) => n + c.rooms.length, 0),
          characters: w.reduce((n, c) => n + c.characters.length, 0),
          messages: w.reduce((n, c) => n + c.messages.total, 0),
          visits: w.reduce((n, c) => n + c.visits, 0),
        },
      };
      res.setHeader('cache-control', 'public, max-age=5');
      res.json(body);
    });

    // An image any page can embed: <img src="https://<world service>/api/badge.svg">
    app.get('/api/badge.svg', (req, res) => {
      const w = cards();
      const online = w.reduce((n, c) => n + c.online, 0);
      const label = typeof req.query.label === 'string' ? req.query.label.slice(0, 40) : 'bookworld';
      const value = online === 1 ? '1 visitor now' : `${online} visitors now`;
      res.setHeader('content-type', 'image/svg+xml');
      res.setHeader('cache-control', 'public, max-age=10');
      res.send(badge(label, value, online > 0 ? '#c9a961' : '#6b5a3e'));
    });

    // Make your own world: the generator (and the provisioner when a key is configured) behind the daily budget.
    app.get('/api/make', (_req, res) => res.json(makeStatus()));
    app.post('/api/make', (req, res) => {
      try {
        const job = submit(validateRequest(req.body));
        res.status(202).json({ jobId: job.id, status: job.status });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });
    app.get('/api/make/:id', (req, res) => {
      const job = getJob(req.params.id);
      if (!job) return res.status(404).json({ error: 'unknown job' });
      res.json(job);
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
      const visitor = cleanVisitor(req.body?.visitor);
      const uid = ethoraUserId(visitor, name);
      const ethora = ethoraFor(loaded.world.slug);
      if (ethora.enabled) {
        const ok = await tryEthora('create guest', () => ethora.createGuest(uid, name));
        if (!ok) return res.status(502).json({ error: 'could not create chat identity' });
        await tryEthora('grant start room', () => ethora.grant(loaded.world.start, uid));
      }
      const token = signSession({ pid: playerId, uid, name, world: loaded.world.slug, ...(visitor ? { visitor } : {}) });
      record({ ev: 'enter', world: loaded.world.slug, pid: playerId, visitor });
      visited(loaded.world.slug);
      const body: EnterResponse = {
        token, playerId, name, world: loaded.world, ethora: ethoraInfo(loaded.world.slug, uid),
        ai: budgetFor(loaded.world.slug).snapshot(visitor),
      };
      res.json(body);
    });

    // Resume after a reload: same player and chat identity, fresh tokens. Not a new session for the report.
    app.post('/api/worlds/:slug/resume', async (req, res) => {
      const loaded = getWorld(req.params.slug);
      if (!loaded) return res.status(404).json({ error: 'unknown world' });
      let session;
      try {
        session = verifySession(String(req.body?.token ?? ''));
      } catch {
        return res.status(401).json({ error: 'session expired' });
      }
      if (session.world !== loaded.world.slug) return res.status(400).json({ error: 'session is for another world' });
      const ethora = ethoraFor(loaded.world.slug);
      if (ethora.enabled) await tryEthora('resume guest', () => ethora.createGuest(session.uid, session.name));
      const token = signSession(session);
      const body: EnterResponse = {
        token, playerId: session.pid, name: session.name, world: loaded.world, ethora: ethoraInfo(loaded.world.slug, session.uid),
        ai: budgetFor(loaded.world.slug).snapshot(session.visitor),
      };
      res.json(body);
    });
  },
});

function badge(label: string, value: string, color: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lw = 7 * label.length + 14;
  const vw = 7 * value.length + 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<rect rx="3" width="${lw + vw}" height="20" fill="#2a2118"/>
<rect rx="3" x="${lw}" width="${vw}" height="20" fill="${color}"/>
<g fill="#f3e6c4" font-family="Georgia,serif" font-size="12" text-anchor="middle">
<text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + vw / 2}" y="14" fill="#1a140f">${esc(value)}</text>
</g></svg>`;
}

server.define(COLYSEUS_ROOM_NAME, LocationRoom).filterBy(['world', 'location']);

await server.listen(PORT, HOST);
console.log(`[bookworld] world service on ${HOST ?? ''}:${PORT}`);
