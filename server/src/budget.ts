// Daily cap on paid AI use. Every message that names a character triggers an agent reply on Ethora
// (billed to the owner), so the world service counts those per world and per visitor per day. At the
// world limit the characters "go to sleep": clients stop addressing them (names are neutralised in
// outgoing messages), rooms get a narration line, and when an Ethora user API key is configured the
// agents themselves are switched to never answer until the daily reset. Counts survive restarts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Cron } from 'croner';
import type { AiState } from '@bookworld/shared';
import type { LoadedWorld } from './world/load.ts';
import { tryEthora, type EthoraWorldService } from './ethora.ts';
import { ethoraMcpAvailable, withEthoraMcp } from './ethora-mcp.ts';

export interface BudgetConfig {
  /** character replies per world per day; 0 = no limit */
  limit: number;
  /** character replies per visitor per day; 0 = no limit */
  perPlayer: number;
  /** 5-field cron for the daily reset, UTC */
  reset: string;
  file: string | null;
}

interface Persisted { day: string; used: number; perVisitor: Record<string, number>; asleep: boolean }

export function budgetConfigFromEnv(): BudgetConfig {
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
  return {
    limit: Math.max(0, Number(process.env.AI_DAILY_LIMIT ?? 500) || 0),
    perPlayer: Math.max(0, Number(process.env.AI_DAILY_LIMIT_PER_PLAYER ?? 60) || 0),
    reset: process.env.AI_DAILY_RESET ?? '0 0 * * *',
    file: process.env.AI_BUDGET_FILE === 'off' ? null : process.env.AI_BUDGET_FILE ?? join(dataDir, 'ai-budget.json'),
  };
}

type Listener = (state: AiState) => void;

export class AiBudget {
  private state: Persisted;
  private listeners = new Set<Listener>();
  private cron: Cron | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private loaded: LoadedWorld, private ethora: EthoraWorldService, readonly config: BudgetConfig, private now: () => Date = () => new Date()) {
    this.state = this.load();
    if (this.state.day !== this.today()) this.state = { day: this.today(), used: 0, perVisitor: {}, asleep: false };
    // asleep follows the current limit, so raising AI_DAILY_LIMIT and restarting wakes the characters at once
    this.state.asleep = this.config.limit > 0 && this.state.used >= this.config.limit;
  }

  start() {
    if (this.cron) return;
    this.cron = new Cron(this.config.reset, { timezone: 'UTC' }, () => void this.reset());
    const mode = this.config.limit ? `${this.config.limit} character replies per day` : 'no daily limit';
    console.log(`[budget ${this.loaded.world.slug}] ${mode}, ${this.config.perPlayer || 'no'} per visitor, reset "${this.config.reset}" UTC${ethoraMcpAvailable ? ', agents switched off at the limit' : ', client-side gate only (no ETHORA_API_KEY)'}`);
    if (this.state.asleep) console.log(`[budget ${this.loaded.world.slug}] still asleep from an earlier run (${this.state.used} used)`);
  }

  stop() {
    this.cron?.stop();
    this.cron = null;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  snapshot(visitor?: string): AiState {
    return {
      limit: this.config.limit,
      perPlayer: this.config.perPlayer,
      used: this.state.used,
      asleep: this.state.asleep,
      resetAt: this.resetAt(),
      limited: this.isLimited(visitor),
    };
  }

  isLimited(visitor?: string): boolean {
    if (!visitor || !this.config.perPlayer) return false;
    return (this.state.perVisitor[visitor] ?? 0) >= this.config.perPlayer;
  }

  /**
   * A message named `count` characters. Returns whether the reply should be expected; counts it when so.
   * Over the per-visitor limit nothing is counted (the client stops addressing characters for that visitor).
   */
  spend(visitor: string | undefined, count: number): { allowed: boolean; asleep: boolean; limited: boolean } {
    this.rollover();
    if (count <= 0) return { allowed: false, asleep: this.state.asleep, limited: this.isLimited(visitor) };
    if (this.state.asleep || this.isLimited(visitor)) return { allowed: false, asleep: this.state.asleep, limited: this.isLimited(visitor) };
    this.state.used += count;
    if (visitor && this.config.perPlayer) this.state.perVisitor[visitor] = (this.state.perVisitor[visitor] ?? 0) + count;
    const limited = this.isLimited(visitor);
    if (this.config.limit && this.state.used >= this.config.limit) void this.sleep();
    this.save();
    return { allowed: true, asleep: this.state.asleep, limited };
  }

  /** The next reset as an ISO time. */
  resetAt(): string {
    const next = this.cron?.nextRun() ?? nextMidnightUtc(this.now());
    return next.toISOString();
  }

  async reset(): Promise<void> {
    const wasAsleep = this.state.asleep;
    this.state = { day: this.today(), used: 0, perVisitor: {}, asleep: false };
    this.save();
    console.log(`[budget ${this.loaded.world.slug}] daily reset`);
    if (wasAsleep) await this.wake();
    else this.notify();
  }

  private rollover() {
    if (this.state.day !== this.today()) void this.reset();
  }

  private async sleep() {
    if (this.state.asleep) return;
    this.state.asleep = true;
    this.save();
    console.log(`[budget ${this.loaded.world.slug}] limit reached (${this.state.used}); characters go to sleep until ${this.resetAt()}`);
    this.notify();
    const when = this.resetAt().slice(11, 16);
    for (const r of this.loaded.world.rooms) {
      await tryEthora('narrate sleep', () => this.ethora.narrate(r.id, `The characters have talked enough for today and are resting until ${when} UTC. Visitors can still talk to each other.`));
    }
    await this.setAgents(true);
  }

  private async wake() {
    console.log(`[budget ${this.loaded.world.slug}] characters wake up`);
    this.notify();
    for (const r of this.loaded.world.rooms) await tryEthora('narrate wake', () => this.ethora.narrate(r.id, 'The characters are awake again.'));
    await this.setAgents(false);
  }

  /** Switches every agent of this world off (never answers) or back to its world-file mode. Needs ETHORA_API_KEY. */
  private async setAgents(asleep: boolean) {
    const agents = this.loaded.ethora?.agents ?? {};
    if (!ethoraMcpAvailable || !Object.keys(agents).length) return;
    await tryEthora(asleep ? 'agents to sleep' : 'agents awake', () => withEthoraMcp(async (call) => {
      for (const [characterId, a] of Object.entries(agents)) {
        const def = this.loaded.world.characters.find((c) => c.id === characterId);
        const mode = def?.responseMode === 'always' ? 'smart' : def?.responseMode ?? 'mentioned';
        await call('ethora-agent-update', asleep
          ? { agentId: a.agentId, responseMode: 'probability', responseProbability: 0 }
          : { agentId: a.agentId, responseMode: mode, responseProbability: 1 });
      }
    }));
  }

  private notify() {
    const s = this.snapshot();
    for (const cb of this.listeners) cb(s);
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private load(): Persisted {
    const all = this.readAll();
    const s = all[this.loaded.world.slug];
    return s ?? { day: this.today(), used: 0, perVisitor: {}, asleep: false };
  }

  private readAll(): Record<string, Persisted> {
    const f = this.config.file;
    if (!f || !existsSync(f)) return {};
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as Record<string, Persisted>;
    } catch {
      return {};
    }
  }

  private save() {
    const f = this.config.file;
    if (!f) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(dirname(f), { recursive: true });
        const all = this.readAll();
        all[this.loaded.world.slug] = this.state;
        writeFileSync(f, JSON.stringify(all, null, 2) + '\n');
      } catch (e) {
        console.error('[budget] cannot save:', (e as Error).message);
      }
    }, 200);
  }

  /** test hook */
  flush() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const f = this.config.file;
    if (!f) return;
    mkdirSync(dirname(f), { recursive: true });
    const all = this.readAll();
    all[this.loaded.world.slug] = this.state;
    writeFileSync(f, JSON.stringify(all, null, 2) + '\n');
  }
}

function nextMidnightUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}
