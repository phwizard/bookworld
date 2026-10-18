import type { EnterRequest, EnterResponse, ResumeRequest, WorldCard } from '@bookworld/shared';

export const SERVER_URL = (import.meta.env.VITE_WORLD_SERVER_URL as string | undefined) ?? 'http://localhost:2567';

export async function enterWorld(slug: string, name: string): Promise<EnterResponse> {
  const body: EnterRequest = { name, visitor: visitorId() };
  const res = await fetch(`${SERVER_URL}/api/worlds/${slug}/enter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `enter failed (${res.status})`);
  }
  return (await res.json()) as EnterResponse;
}

/** The worlds this service hosts, with who is in them right now. */
export async function listWorlds(): Promise<WorldCard[]> {
  const res = await fetch(`${SERVER_URL}/api/worlds`);
  if (!res.ok) throw new Error(`cannot list worlds (${res.status})`);
  return (await res.json()) as WorldCard[];
}

export interface MakeStatus {
  enabled: boolean;
  reason: string | null;
  today: { runs: number; usd: number };
  limits: { runs: number; usd: number };
  budgetLeft: boolean;
  queued: number;
  provisioning: boolean;
}

export interface MakeJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  slug: string | null;
  log: string[];
  error: string | null;
  chat: boolean | null;
  provisioned: boolean | null;
}

export async function makeStatus(): Promise<MakeStatus> {
  const res = await fetch(`${SERVER_URL}/api/make`);
  if (!res.ok) throw new Error(`make status failed (${res.status})`);
  return (await res.json()) as MakeStatus;
}

export async function makeWorld(body: { title: string; author?: string; gutenberg?: number; rooms?: number; characters?: number; notes?: string; name?: string }): Promise<{ jobId: string }> {
  const res = await fetch(`${SERVER_URL}/api/make`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
  if (!res.ok || !data.jobId) throw new Error(data.error ?? `make failed (${res.status})`);
  return { jobId: data.jobId };
}

export async function getMakeJob(id: string): Promise<MakeJob> {
  const res = await fetch(`${SERVER_URL}/api/make/${id}`);
  if (!res.ok) throw new Error(`job ${id} not found`);
  return (await res.json()) as MakeJob;
}

/** Picks a visit up again after a reload: same identity, fresh tokens. Throws when the session has expired. */
export async function resumeWorld(slug: string, token: string): Promise<EnterResponse> {
  const body: ResumeRequest = { token };
  const res = await fetch(`${SERVER_URL}/api/worlds/${slug}/resume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`resume failed (${res.status})`);
  return (await res.json()) as EnterResponse;
}

/** A random id kept in this browser so the usage report can count return visits. Not tied to a name or account. */
function visitorId(): string | undefined {
  try {
    const key = 'bookworld.visitor';
    let id = localStorage.getItem(key);
    if (!id || !/^v[0-9a-f]{24}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      id = 'v' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return undefined;
  }
}
