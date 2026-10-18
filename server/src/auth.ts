import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';

export interface Session {
  /** player id of this visit (metrics, Colyseus) */
  pid: string;
  /** Ethora user id: one per visitor and name, so a returning visitor keeps the chat identity */
  uid: string;
  name: string;
  world: string;
  /** anonymous browser id, when the client sent one */
  visitor?: string;
}

const secret =
  process.env.BOOKWORLD_SESSION_SECRET ||
  (() => {
    const s = randomBytes(32).toString('hex');
    console.warn('[auth] BOOKWORLD_SESSION_SECRET not set; using a random secret (sessions reset on restart)');
    return s;
  })();

export function signSession(s: Session): string {
  return jwt.sign(s, secret, { algorithm: 'HS256', expiresIn: '12h' });
}

export function verifySession(token: string): Session {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload & Session;
  if (!payload.pid || !payload.name || !payload.world) throw new Error('bad session');
  return { pid: payload.pid, uid: payload.uid ?? payload.pid, name: payload.name, world: payload.world, ...(payload.visitor ? { visitor: payload.visitor } : {}) };
}

export function newPlayerId(): string {
  return 'p' + randomBytes(8).toString('hex');
}

/** The Ethora identity: stable for a visitor id and a name, so coming back as "Alice" is the same chat user. */
export function ethoraUserId(visitor: string | undefined, name: string): string {
  if (!visitor) return newPlayerId();
  return 'u' + createHash('sha256').update(`${visitor}|${name.trim().toLowerCase()}`).digest('hex').slice(0, 16);
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[^\p{L}\p{N} '._-]/gu, '').trim().slice(0, 24);
  return name.length >= 1 ? name : null;
}
