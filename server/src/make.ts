// "Make your own world": a public job that runs the generator and, when an Ethora API key is configured,
// the provisioner, then loads the new world into the running service. One job at a time, a short queue,
// the generator's daily budget in front. Jobs live in memory; their logs are what the picker shows.
import { randomBytes } from 'node:crypto';
import type { License } from '@bookworld/shared';
import { assertBudget, DEFAULT_MCP_URL, generateWorld, LICENSES, limitsFromEnv, pickBackend, provisionWorld, readLedger, slugify } from '@bookworld/generator';
import { getWorld, loadWorlds, worldsDir } from './world/load.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface MakeRequest {
  title: string;
  author?: string;
  gutenberg?: number;
  rooms?: number;
  characters?: number;
  notes?: string;
  /** who asked (shown in the log only) */
  name?: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  status: JobStatus;
  request: MakeRequest;
  slug: string | null;
  log: string[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** when done: whether chat works (the App Secret is still a manual step, ETHORA-GAPS #8) */
  chat: boolean | null;
  provisioned: boolean | null;
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running: Job | null = null;

const MAX_QUEUE = 3;
const MAX_JOBS_KEPT = 50;

export function makeEnabled(): { enabled: boolean; reason?: string } {
  if ((process.env.MAKE_WORLD ?? 'on') === 'off') return { enabled: false, reason: 'turned off on this server (MAKE_WORLD=off)' };
  const backend = pickBackend();
  if (backend === 'claude-cli' && !process.env.ANTHROPIC_API_KEY && process.env.MAKE_WORLD_ALLOW_CLI !== 'on') {
    // the CLI backend uses the signed-in account on this machine; fine for the owner, not for a public server
    return { enabled: false, reason: 'no ANTHROPIC_API_KEY on this server' };
  }
  return { enabled: true };
}

/** Status for the picker: whether making is possible, the day's budget, the queue. */
export function makeStatus() {
  const e = makeEnabled();
  const limits = limitsFromEnv();
  const ledger = readLedger();
  return {
    enabled: e.enabled,
    reason: e.reason ?? null,
    today: { runs: ledger.runs, usd: Math.round(ledger.usd * 100) / 100 },
    limits: { runs: limits.runs, usd: limits.usd },
    budgetLeft: (!limits.runs || ledger.runs < limits.runs) && (!limits.usd || ledger.usd < limits.usd),
    queued: queue.length + (running ? 1 : 0),
    provisioning: Boolean(process.env.ETHORA_API_KEY),
  };
}

export function validateRequest(body: unknown): MakeRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '';
  if (!title) throw new Error('a book title is needed');
  const author = typeof b.author === 'string' ? b.author.trim().slice(0, 80) : undefined;
  const gutenberg = b.gutenberg === undefined || b.gutenberg === '' || b.gutenberg === null ? undefined : Number(b.gutenberg);
  if (gutenberg !== undefined && (!Number.isInteger(gutenberg) || gutenberg < 1 || gutenberg > 99_999_999)) throw new Error('the Project Gutenberg number must be a whole number');
  const rooms = clampInt(b.rooms, 4, 9, 6);
  const characters = clampInt(b.characters, 1, 4, 3);
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 600) : undefined;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 24) : undefined;
  return { title, author: author || undefined, gutenberg, rooms, characters, notes: notes || undefined, name };
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function submit(request: MakeRequest): Job {
  const e = makeEnabled();
  if (!e.enabled) throw new Error(`making worlds is ${e.reason}`);
  if (queue.length >= MAX_QUEUE) throw new Error('the queue is full; try again in a few minutes');
  assertBudget(); // throws with the limit in the message
  const job: Job = {
    id: randomBytes(6).toString('hex'),
    status: 'queued', request, slug: null, log: [], error: null,
    createdAt: new Date().toISOString(), finishedAt: null, chat: null, provisioned: null,
  };
  jobs.set(job.id, job);
  if (jobs.size > MAX_JOBS_KEPT) {
    const oldest = [...jobs.values()].filter((j) => j.status === 'done' || j.status === 'failed').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (oldest) jobs.delete(oldest.id);
  }
  queue.push(job);
  void pump();
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

async function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = job;
  job.status = 'running';
  const log = (s: string) => { job.log.push(s); if (job.log.length > 200) job.log.shift(); console.log(`[make ${job.id}] ${s}`); };
  try {
    const r = job.request;
    const slug = freeSlug(slugify(r.title));
    job.slug = slug;
    log(`${r.name ? r.name + ' asked for' : 'Making'} "${r.title}"${r.author ? ` by ${r.author}` : ''}${r.gutenberg ? ` from Project Gutenberg #${r.gutenberg}` : ' from the model\'s knowledge'}; world "${slug}"`);
    const license: License = 'public-domain';
    if (!LICENSES.includes(license)) throw new Error('bad license');
    const gen = await generateWorld({
      gutenberg: r.gutenberg, title: r.title, author: r.author, license, slug,
      rooms: r.rooms, characters: r.characters, notes: r.notes, log,
    });
    log(`world written: ${gen.world.rooms.length} rooms, ${gen.world.characters.length} characters, $${gen.usd.toFixed(2)}`);

    if (process.env.ETHORA_API_KEY) {
      log('provisioning on Ethora (app, rooms, agents, knowledge)');
      await provisionWorld({ dir: gen.dir, mcpUrl: process.env.ETHORA_MCP_URL ?? DEFAULT_MCP_URL, apiKey: process.env.ETHORA_API_KEY, log });
      job.provisioned = true;
    } else {
      job.provisioned = false;
      log('no ETHORA_API_KEY on this server: the world has no chat rooms or characters on Ethora yet (pnpm provision -- --world ' + slug + ')');
    }

    // bring it into the running service
    loadWorlds();
    const loaded = getWorld(slug);
    if (!loaded) throw new Error('the new world did not load');
    job.chat = Boolean(loaded.ethora) && Boolean(process.env[`ETHORA_CHAT_APP_SECRET_${slug.toUpperCase().replace(/-/g, '_')}`]);
    if (job.provisioned && !job.chat) log(`chat stays off until the owner copies the app's App Secret into .env as ETHORA_CHAT_APP_SECRET_${slug.toUpperCase().replace(/-/g, '_')} (ETHORA-GAPS #8)`);
    log(`ready: open ?world=${slug}`);
    job.status = 'done';
  } catch (e) {
    job.status = 'failed';
    job.error = (e as Error).message;
    log(`failed: ${job.error}`);
  } finally {
    job.finishedAt = new Date().toISOString();
    running = null;
    void pump();
  }
}

function freeSlug(base: string): string {
  let slug = base;
  for (let n = 2; existsSync(join(worldsDir(), slug)); n++) slug = `${base}-${n}`;
  return slug;
}
