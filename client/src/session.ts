// The visit survives a reload: the session token, the room and the last position live in sessionStorage
// (per tab). A new tab is a new visit, but with the same visitor id it gets the same chat identity.
export interface SavedSession {
  world: string;
  token: string;
  location: string;
  at?: { x: number; z: number; ry: number };
}

const KEY = 'bookworld.session';

export function loadSession(world: string): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    return s && s.world === world && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: SavedSession): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function updateSession(patch: Partial<SavedSession>): void {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.setItem(KEY, JSON.stringify({ ...(JSON.parse(raw) as SavedSession), ...patch }));
  } catch { /* ignore */ }
}

export function clearSession(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
