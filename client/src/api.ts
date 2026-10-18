import type { EnterRequest, EnterResponse } from '@bookworld/shared';

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
