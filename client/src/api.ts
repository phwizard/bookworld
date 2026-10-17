import type { EnterResponse } from '@bookworld/shared';

export const SERVER_URL = (import.meta.env.VITE_WORLD_SERVER_URL as string | undefined) ?? 'http://localhost:2567';

export async function enterWorld(slug: string, name: string): Promise<EnterResponse> {
  const res = await fetch(`${SERVER_URL}/api/worlds/${slug}/enter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `enter failed (${res.status})`);
  }
  return (await res.json()) as EnterResponse;
}
