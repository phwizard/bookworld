// world.json -> Ethora: one App per world, one chat room per location, one agent per character with the
// chapters it should know, invited into its home room. Writes worlds/<slug>/ethora.json (gitignored) after
// every step, so a rerun continues where it stopped and never creates duplicates.
//
//   pnpm provision -- --world alice [--app <existing appId>] [--dry-run] [--skip-knowledge] [--smoke]
// Needs ETHORA_API_KEY (a user API key for the hosted Ethora MCP) in .env; see docs/GENERATOR.md.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { lessonPrompt, musicPrompt, type World, type WorldCharacter } from '@bookworld/shared';
import { bool, parseArgs, str } from './args.ts';
import { DEFAULT_MCP_URL, EthoraMcp, dig } from './mcp.ts';
import { repoRoot, worldDir } from './paths.ts';
import { fetchGutenberg, listKnowledge, splitChapters, stripGutenberg, writeKnowledge } from './source.ts';

export interface EthoraIds {
  appId: string | null;
  appName?: string;
  rooms: Record<string, { chatId: string; jid: string }>;
  agents: Record<string, {
    agentId: string;
    address?: string;
    botInstanceId?: string;
    home: string;
    visibility?: string;
    invited?: boolean;
    /** knowledge tags uploaded into this agent's knowledge base */
    knowledge?: string[];
  }>;
}

export interface ProvisionOptions {
  dir: string;
  mcpUrl: string;
  apiKey?: string;
  /** reuse an existing Ethora App instead of creating one */
  appId?: string;
  dryRun?: boolean;
  skipKnowledge?: boolean;
  /** `crawl` (default for Project Gutenberg sources): the agent's knowledge base crawls the book's URL, no files pass through here; `files`: upload the chapter files */
  knowledge?: 'crawl' | 'files';
  smoke?: boolean;
  log?: (s: string) => void;
}

export async function provisionWorld(opts: ProvisionOptions): Promise<EthoraIds> {
  const log = opts.log ?? ((s: string) => console.error(`[provision] ${s}`));
  const worldFile = join(opts.dir, 'world.json');
  if (!existsSync(worldFile)) throw new Error(`${worldFile} not found`);
  const world = JSON.parse(readFileSync(worldFile, 'utf8')) as World;
  const idsFile = join(opts.dir, 'ethora.json');
  const loaded = existsSync(idsFile) ? (JSON.parse(readFileSync(idsFile, 'utf8')) as Partial<EthoraIds>) : {};
  const ids: EthoraIds = { appId: loaded.appId ?? null, appName: loaded.appName, rooms: loaded.rooms ?? {}, agents: loaded.agents ?? {} };
  if (opts.appId) ids.appId = opts.appId;
  const save = () => { if (!opts.dryRun) writeFileSync(idsFile, JSON.stringify(ids, null, 2) + '\n'); };

  // Knowledge: a Project Gutenberg book is crawled straight from its URL (one call per agent, nothing uploaded);
  // other sources upload the chapter files, regenerated from the source when the generator's output is not here.
  const gutenberg = /^gutenberg:(\d+)$/.exec(world.source.text ?? '')?.[1];
  const crawlUrl = gutenberg && opts.knowledge !== 'files' ? `https://www.gutenberg.org/cache/epub/${gutenberg}/pg${gutenberg}.txt` : null;
  let knowledge = listKnowledge(opts.dir);
  const wanted = new Set(world.characters.flatMap((c) => c.knowledgeTags ?? []));
  if (!opts.skipKnowledge && !crawlUrl && [...wanted].some((t) => !knowledge.has(t))) {
    const m = /^gutenberg:(\d+)$/.exec(world.source.text ?? '');
    if (m) {
      log(`knowledge files missing; fetching Project Gutenberg #${m[1]} again`);
      const raw = await fetchGutenberg(Number(m[1]), join(opts.dir, 'source'));
      writeKnowledge(opts.dir, world.slug, world.source, splitChapters(stripGutenberg(raw)));
      knowledge = listKnowledge(opts.dir);
    }
  }

  // A trainer (world.lessons) gets the song files as knowledge, so it can quote a line's chords or words when asked.
  const songFiles = listSongs(opts.dir);
  const isTrainer = (c: WorldCharacter) => Boolean(world.lessons?.some((l) => l.trainer === c.id));

  const plan: string[] = [];
  const need = (s: string) => plan.push(s);
  if (!ids.appId) need(`create app "Bookworld ${world.title}"`);
  for (const r of world.rooms) if (!ids.rooms[r.id]) need(`create room "${r.name}"`);
  for (const c of world.characters) {
    const a = ids.agents[c.id];
    if (!a) need(`create agent "${c.name}" (${c.responseMode}, cooldown ${c.cooldownSec}s)`);
    if (crawlUrl) {
      if (!opts.skipKnowledge && (c.knowledgeTags ?? []).length && !a?.knowledge?.includes(`gutenberg:${gutenberg}`)) need(`crawl ${crawlUrl} into "${c.name}" (the whole book)`);
    } else {
      const missing = (c.knowledgeTags ?? []).filter((t) => !a?.knowledge?.includes(t));
      for (const t of missing.filter((t) => !knowledge.has(t))) log(`warning: knowledge file for ${t} not found, skipped`);
      const uploadable = missing.filter((t) => knowledge.has(t));
      if (!opts.skipKnowledge && uploadable.length) need(`upload ${uploadable.length} knowledge file(s) to "${c.name}": ${uploadable.join(', ')}`);
    }
    if (isTrainer(c)) {
      const missing = [...songFiles.keys()].filter((t) => !a?.knowledge?.includes(t));
      if (!opts.skipKnowledge && missing.length) need(`upload ${missing.length} song file(s) to "${c.name}": ${missing.join(', ')}`);
    }
    if (a?.visibility !== 'unlisted') need(`set "${c.name}" visibility to unlisted (so the world service can move it between rooms)`);
    if (!a?.invited) need(`invite "${c.name}" into "${c.home}"`);
  }
  if (!plan.length) log('nothing to do: everything in world.json is already provisioned');
  else log(`plan:\n  - ${plan.join('\n  - ')}`);
  if (opts.dryRun) return ids;
  if (!plan.length && !opts.smoke) return ids;

  if (!opts.apiKey && !opts.mcpUrl.includes('127.0.0.1') && !opts.mcpUrl.includes('localhost')) {
    throw new Error('ETHORA_API_KEY is not set (a user API key for the hosted Ethora MCP; see docs/GENERATOR.md)');
  }
  const mcp = await EthoraMcp.connect(opts.mcpUrl, opts.apiKey);
  try {
    if (!ids.appId) {
      const data = await mcp.call('ethora-app-create', { displayName: `Bookworld ${world.title}` });
      const appId = dig(data, ['appId', '_id', 'id']);
      if (!appId) throw new Error(`app created but no appId in the result: ${JSON.stringify(data).slice(0, 300)}`);
      ids.appId = appId;
      ids.appName = `Bookworld ${world.title}`;
      save();
      log(`app ${appId} created`);
    }
    await mcp.call('ethora-app-select', { appId: ids.appId });

    for (const r of world.rooms) {
      if (ids.rooms[r.id]) continue;
      const data = await mcp.call('ethora-chat-create', { appId: ids.appId, title: r.name });
      const jid = dig(data, ['jid']);
      const chatId = dig(data, ['chatId', 'id', '_id']) ?? jid?.split('_')[1];
      if (!jid || !chatId) throw new Error(`room "${r.name}" created but no jid in the result: ${JSON.stringify(data).slice(0, 300)}`);
      ids.rooms[r.id] = { chatId, jid: jid.replace(/@.*$/, '') };
      save();
      log(`room ${r.id} -> ${jid}`);
    }

    for (const c of world.characters) {
      let a = ids.agents[c.id];
      if (!a) {
        const room = world.rooms.find((r) => r.id === c.home)!;
        const data = await mcp.call('ethora-agent-create', {
          appId: ids.appId,
          name: c.name,
          botDisplayName: c.name,
          summary: summaryOf(c),
          prompt: agentPrompt(world, c, room.name, room.description),
          responseMode: c.responseMode === 'always' ? 'smart' : c.responseMode,
          cooldownSec: Math.max(20, c.cooldownSec),
          isRAG: Boolean(c.knowledgeTags?.length) || (isTrainer(c) && songFiles.size > 0),
          categories: ['persona', 'entertainment'],
          visibility: 'private',
        });
        const agentId = dig(data, ['agentId', 'id', '_id']);
        if (!agentId) throw new Error(`agent "${c.name}" created but no id in the result: ${JSON.stringify(data).slice(0, 300)}`);
        a = ids.agents[c.id] = { agentId, address: dig(data, ['address']), home: c.home, knowledge: [] };
        save();
        log(`agent ${c.id} -> ${agentId}`);
      }
      if (!opts.skipKnowledge && crawlUrl) {
        const mark = `gutenberg:${gutenberg}`;
        if ((c.knowledgeTags ?? []).length && !a.knowledge?.includes(mark)) {
          const data = await mcp.call('ethora-source-site-crawl', { appId: ids.appId, agentId: a.agentId, url: crawlUrl });
          // the crawl registers a weekly re-crawl; a book does not change
          const watchId = dig(data, ['watchId']);
          if (watchId) await mcp.call('ethora-source-site-watch-update', { appId: ids.appId, watchId, schedule: 'off' }).catch((e: Error) => log(`warning: could not switch the re-crawl off: ${e.message}`));
          a.knowledge = [...(a.knowledge ?? []), mark];
          save();
          log(`knowledge for ${c.id}: crawled ${crawlUrl}`);
        }
      } else if (!opts.skipKnowledge) {
        const missing = (c.knowledgeTags ?? []).filter((t) => !a!.knowledge?.includes(t));
        const files = missing.map((tag) => ({ tag, path: knowledge.get(tag) })).filter((f) => f.path);
        for (let i = 0; i < files.length; i += 5) {
          const batch = files.slice(i, i + 5);
          await mcp.call('ethora-source-doc-upload', {
            appId: ids.appId,
            agentId: a.agentId,
            files: batch.map((f) => ({ name: `${f.tag}.txt`, mimeType: 'text/plain', base64: readFileSync(f.path!).toString('base64') })),
          });
          a.knowledge = [...(a.knowledge ?? []), ...batch.map((f) => f.tag)];
          save();
          log(`knowledge for ${c.id}: ${batch.map((f) => f.tag).join(', ')}`);
        }
      }
      if (!opts.skipKnowledge && isTrainer(c)) {
        const files = [...songFiles.entries()].filter(([tag]) => !a!.knowledge?.includes(tag));
        for (let i = 0; i < files.length; i += 5) {
          const batch = files.slice(i, i + 5);
          await mcp.call('ethora-source-doc-upload', {
            appId: ids.appId,
            agentId: a.agentId,
            files: batch.map(([tag, path]) => ({ name: `${tag.replace(/^song:/, '')}.txt`, mimeType: 'text/plain', base64: readFileSync(path).toString('base64') })),
          });
          a.knowledge = [...(a.knowledge ?? []), ...batch.map(([tag]) => tag)];
          save();
          log(`songs for ${c.id}: ${batch.map(([tag]) => tag.replace(/^song:/, '')).join(', ')}`);
        }
      }
      if (a.visibility !== 'unlisted') {
        await mcp.call('ethora-agent-visibility-set', { agentId: a.agentId, visibility: 'unlisted' });
        a.visibility = 'unlisted';
        save();
      }
      if (!a.invited) {
        const jid = ids.rooms[c.home]?.jid;
        if (!jid) throw new Error(`home room ${c.home} of ${c.id} has no Ethora room`);
        const data = await mcp.call('ethora-agent-invite', { agentId: a.agentId, chatJid: jid });
        const bot = dig(data, ['botInstanceId']) ?? dig((data as Record<string, unknown>).botInstance ?? (data as Record<string, unknown>).instance, ['_id', 'id']);
        if (bot) a.botInstanceId = bot;
        a.invited = true;
        save();
        log(`agent ${c.id} invited into ${c.home}${bot ? ` (bot instance ${bot})` : ''}`);
      }
    }

    if (opts.smoke) {
      for (const c of world.characters) {
        const jid = ids.rooms[c.home]?.jid;
        if (!jid) continue;
        log(`smoke test: greeting ${c.name} in ${c.home}`);
        const data = await mcp.call<{ replies?: { text?: string; body?: string }[] | null }>('ethora-message-send', {
          roomJid: jid, text: `@${c.name} hello, who are you?`, waitForReplySec: 45,
        });
        const reply = data.replies?.[0];
        log(reply ? `${c.name}: ${(reply.text ?? reply.body ?? '').slice(0, 300)}` : `${c.name} did not answer within 45 s`);
      }
    }
  } finally {
    await mcp.close().catch(() => undefined);
  }
  log(`done: ${relative(repoRoot(), idsFile)} is up to date. Copy the App Secret from the Ethora dashboard (app ${ids.appId}, API tab) into .env as ETHORA_CHAT_APP_SECRET.`);
  return ids;
}

/** "song:<id>" -> path for every song file of the world (songs/ and songs/private/). */
function listSongs(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const folder of [join(dir, 'songs'), join(dir, 'songs', 'private')]) {
    if (!existsSync(folder)) continue;
    for (const f of readdirSync(folder).sort()) {
      if (!/\.(cho|chordpro|crd|txt)$/i.test(f)) continue;
      out.set(`song:${f.replace(/\.[^.]+$/, '')}`, join(folder, f));
    }
  }
  return out;
}

function summaryOf(c: WorldCharacter): string {
  const first = c.persona.split(/(?<=[.!?])\s+/)[0] ?? c.name;
  return first.length > 200 ? first.slice(0, 197) + '...' : first;
}

/** The persona from the world file plus the setting and the house rules every character shares. */
export function agentPrompt(world: World, c: WorldCharacter, roomName: string, roomDescription: string): string {
  return [
    c.persona.trim(),
    '',
    `Setting: you are in "${roomName}", a place in "${world.title}" by ${world.source.author}. ${roomDescription}`,
    'Visitors walk in and out of this place and talk to you and to each other; messages in italics are the narrator describing who comes and goes.',
    musicPrompt(c.name),
    ...(world.lessons?.some((l) => l.trainer === c.id) ? [lessonPrompt(c.name)] : []),
    'Rules: stay in character at all times. Never say you are an AI, a bot or a program. Reply in at most 80 words. Address visitors by the name they use. Use plain hyphens, never long dashes. If asked about things outside the book, answer as the character would.',
  ].join('\n');
}

const isMain = process.argv[1] && /provision\.ts$/.test(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const world = str(args, 'world') ?? args.rest[0];
  if (!world) {
    console.error('usage: pnpm provision -- --world <slug|dir> [--app <appId>] [--dry-run] [--skip-knowledge] [--knowledge crawl|files] [--smoke] [--mcp-url url]');
    process.exit(2);
  }
  provisionWorld({
    dir: worldDir(world),
    mcpUrl: str(args, 'mcp-url') ?? process.env.ETHORA_MCP_URL ?? DEFAULT_MCP_URL,
    apiKey: process.env.ETHORA_API_KEY,
    appId: str(args, 'app'),
    dryRun: bool(args, 'dry-run'),
    skipKnowledge: bool(args, 'skip-knowledge'),
    knowledge: str(args, 'knowledge') === 'files' ? 'files' : 'crawl',
    smoke: bool(args, 'smoke'),
  }).catch((e) => {
    console.error(`[provision] ${(e as Error).message}`);
    process.exit(1);
  });
}
