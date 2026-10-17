import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

export interface Session {
  pid: string;
  name: string;
  world: string;
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
  return { pid: payload.pid, name: payload.name, world: payload.world };
}

export function newPlayerId(): string {
  return 'p' + randomBytes(8).toString('hex');
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[^\p{L}\p{N} '._-]/gu, '').trim().slice(0, 24);
  return name.length >= 1 ? name : null;
}
