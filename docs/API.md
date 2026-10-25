# Public API of the world service

Everything a home page or a status page needs, served by the world service (`PORT`, default 2567) with CORS open (`CORS_ORIGIN`). No secrets, no names of visitors. Responses are cacheable for a few seconds.

## GET /api/stats

One call for a home page.

```json
{
  "generatedAt": "2026-10-18T08:40:12.000Z",
  "online": 3,
  "totals": { "worlds": 2, "rooms": 11, "characters": 5, "messages": 128, "visits": 41 },
  "worlds": [ ...WorldCard ]
}
```

## GET /api/worlds

One `WorldCard` per world (the same list the join screen shows):

```json
{
  "slug": "tempest",
  "title": "The Tempest",
  "summary": "Prospero's enchanted island, from the wreck on the shore to ...",
  "author": "William Shakespeare",
  "year": 1611,
  "license": "public-domain",
  "rooms": [ { "id": "wreck", "name": "The Wreck on the Shore", "here": 1 }, ... ],
  "characters": [ { "id": "prospero", "name": "Prospero", "home": "cell" }, ... ],
  "online": 1,
  "lastActivity": "2026-10-18T08:39:50.000Z",
  "messages": { "total": 12, "today": 12 },
  "visits": 2,
  "chat": true,
  "resting": false
}
```

`online` counts humans connected and not away; `here` is the same per room. `messages` counts human chat lines (characters' replies are not seen by the world service). `chat` is false while the server lacks the world's App Secret; `resting` is true when the day's AI budget is spent.

## GET /api/badge.svg

An image for any page, no JavaScript: `<img src="https://<world service>/api/badge.svg" alt="bookworld visitors">`. Shows "N visitors now"; `?label=...` changes the left text.

## Snippet for a home page

```html
<div id="bookworld-live"></div>
<script>
  const base = 'https://play.example.com'; // the world service
  async function refresh() {
    const s = await (await fetch(base + '/api/stats')).json();
    const ago = (t) => t ? Math.round((Date.now() - Date.parse(t)) / 60000) + ' min ago' : 'never';
    document.getElementById('bookworld-live').innerHTML =
      `<p>${s.online} people in bookworld right now, ${s.totals.messages} messages so far.</p>` +
      s.worlds.map((w) => `<p><a href="${base}/?world=${w.slug}">${w.title}</a>: ${w.online} here, ` +
        `${w.characters.map((c) => c.name).join(', ')}, last activity ${ago(w.lastActivity)}</p>`).join('');
  }
  refresh(); setInterval(refresh, 15000);
</script>
```

## Other endpoints

- `GET /api/health`: `{ ok, worlds }`.
- `GET /api/worlds/:slug`: the full world file plus the public Ethora info (app id, room JIDs).
- `GET /api/worlds/:slug/where`: `{ humans: { roomId: count }, characters: [{ id, name, at }] }`, who is in which room right now (active humans from presence, each character's current room from the simulation). The client's mini-map polls it every four seconds; cacheable for two.
- `POST /api/worlds/:slug/enter` `{ name, visitor? }`, `POST /api/worlds/:slug/resume` `{ token }`: how the client gets in; see `shared/src/protocol.ts`.
- `GET /api/ai-budget`: today's AI budget per world and the generator's ledger.
- `GET /api/metrics` (needs `METRICS_TOKEN`): the usage report, see `docs/GENERATOR.md`.
- `GET /api/make`, `POST /api/make` `{ title, author?, gutenberg?, rooms?, characters?, notes?, name? }`, `GET /api/make/:id`: "make your own world". The POST answers `202 { jobId }`; poll the job for `status` (`queued`, `running`, `done`, `failed`), `log`, `slug`. Off when `MAKE_WORLD=off` or no model backend is configured; refused when the day's generator budget is spent or the queue (3) is full.
