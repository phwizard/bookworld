// Daily cap on what the generator may spend. Shares the world service's budget file (DATA_DIR/ai-budget.json)
// under the key `_generator`, so `GET /api/ai-budget` shows it next to the character-reply budget.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot } from './paths.ts';

export interface GeneratorLedger { day: string; runs: number; usd: number; last?: { at: string; slug: string; usd: number; backend: string } }

export interface LedgerLimits { runs: number; usd: number }

export function ledgerFile(): string {
  return process.env.AI_BUDGET_FILE ?? join(process.env.DATA_DIR ?? join(repoRoot(), 'server', 'data'), 'ai-budget.json');
}

export function limitsFromEnv(): LedgerLimits {
  return {
    runs: Math.max(0, Number(process.env.GENERATOR_DAILY_RUNS ?? 5) || 0),
    usd: Math.max(0, Number(process.env.GENERATOR_DAILY_USD ?? 10) || 0),
  };
}

/** Rough price for the API backend when the model does not report cost: "<usd per million input tokens>,<output>". */
export function pricePerMtok(): { input: number; output: number } {
  const [i, o] = (process.env.GENERATOR_USD_PER_MTOK ?? '15,75').split(',').map(Number);
  return { input: i || 15, output: o || 75 };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readAll(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return {}; }
}

export function readLedger(file = ledgerFile()): GeneratorLedger {
  const all = readAll(file);
  const l = all['_generator'] as GeneratorLedger | undefined;
  if (!l || l.day !== today()) return { day: today(), runs: 0, usd: 0 };
  return l;
}

/** Throws when today's runs or spend already reach the limits (0 = no limit). */
export function assertBudget(limits = limitsFromEnv(), file = ledgerFile()): GeneratorLedger {
  const l = readLedger(file);
  if (limits.runs && l.runs >= limits.runs) throw new Error(`generator daily limit reached: ${l.runs} runs today (GENERATOR_DAILY_RUNS=${limits.runs}); pass --ignore-budget to override`);
  if (limits.usd && l.usd >= limits.usd) throw new Error(`generator daily limit reached: $${l.usd.toFixed(2)} spent today (GENERATOR_DAILY_USD=${limits.usd}); pass --ignore-budget to override`);
  return l;
}

export function recordRun(entry: { slug: string; usd: number; backend: string }, file = ledgerFile()): GeneratorLedger {
  const all = readAll(file);
  const l = readLedger(file);
  l.runs += 1;
  l.usd = Math.round((l.usd + entry.usd) * 10000) / 10000;
  l.last = { at: new Date().toISOString(), ...entry };
  all['_generator'] = l;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
  return l;
}
