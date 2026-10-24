import { randomBytes } from 'node:crypto';
// Everything the world service asks Ethora for. Ethora is used only through its public backend SDK
// (B2B server token signed with the App Secret). If the credentials are missing the service runs in
// "no chat" mode so movement can be developed and tested without them.
import { EthoraSDKService, createServerToken } from '@ethora/sdk-backend';
import { narrationBody, NARRATOR_NAME } from '@bookworld/shared';
import { listWorlds, type WorldEthoraIds } from './world/load.ts';
import { ethoraMcpAvailable, withEthoraMcp } from './ethora-mcp.ts';
import { debug } from './debuglog.ts';

const apiBaseUrl = process.env.ETHORA_API_BASE_URL ?? 'https://api.chat.ethora.com/v1';
const xmppDomain = process.env.ETHORA_XMPP_DOMAIN ?? 'xmpp.chat.ethora.com';
// The chat component talks to `/v1`; the backend SDK builds `/v2/...` paths itself from the host root.
const sdkApiUrl = apiBaseUrl.replace(/\/v1\/?$/, '');

export class EthoraWorldService {
  readonly enabled: boolean;
  readonly appId: string | null;
  readonly apiBaseUrl = apiBaseUrl;
  readonly xmppDomain = xmppDomain;
  private sdk: EthoraSDKService | null = null;
  private slug: string | undefined;
  private granted = new Set<string>();
  /** Public app rooms (created over MCP) are open to every app user; users-access answers CHAT_NOT_FOUND for them. See ETHORA-GAPS #10. */
  private membershipSupported = true;

  constructor(private ids: WorldEthoraIds | null, slug?: string) {
    const appSecret = appSecretFor(slug);
    this.slug = slug;
    this.appId = ids?.appId ?? null;
    this.enabled = Boolean(ids && appSecret);
    if (this.enabled) {
      process.env.ETHORA_CHAT_API_URL = sdkApiUrl;
      process.env.ETHORA_CHAT_APP_ID = this.appId!;
      this.sdk = new EthoraSDKService({ chatAppId: this.appId!, chatAppSecret: appSecret! });
    } else {
      console.warn(`[ethora] disabled for app ${this.appId ?? '(none)'}: ${ids ? `no App Secret (${secretVar(slug)} or ETHORA_CHAT_APP_SECRET)` : 'no ethora.json for this world'}`);
    }
  }

  /** world room id -> JID (public, safe for clients) */
  roomJids(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [roomId, r] of Object.entries(this.ids?.rooms ?? {})) out[roomId] = r.jid;
    return out;
  }

  private chatId(roomId: string): string | null {
    return this.ids?.rooms[roomId]?.chatId ?? null;
  }

  /** Creates the Ethora identity for a guest. Idempotent per playerId on the Ethora side. */
  async createGuest(playerId: string, name: string): Promise<void> {
    if (!this.sdk) return;
    // The API wants a last name of at least two characters; the chat UI shows "First Last".
    // A random password: the SDK would otherwise set "password_<id>", guessable from the id (ETHORA-GAPS #19). Guests
    // never use it; they sign in with the chat token.
    const password = randomBytes(18).toString('base64url');
    await this.sdk.createUser(playerId, { firstName: name, lastName: '(guest)', email: `${playerId}@guest.bookworld.invalid`, password });
  }

  /** Client JWT the chat component exchanges for a user session (config.jwtLogin.token). */
  chatToken(playerId: string): string | null {
    return this.sdk ? this.sdk.createChatUserJwtToken(playerId) : null;
  }

  async grant(roomId: string, playerId: string): Promise<void> {
    const chatId = this.chatId(roomId);
    if (!this.sdk || !chatId || !this.membershipSupported) return;
    const key = `${chatId}:${playerId}`;
    if (this.granted.has(key)) return;
    await this.membership(() => this.sdk!.grantUserAccessToChatRoom(chatId, playerId));
    this.granted.add(key);
  }

  async revoke(roomId: string, playerId: string): Promise<void> {
    const chatId = this.chatId(roomId);
    if (!this.sdk || !chatId || !this.membershipSupported) return;
    this.granted.delete(`${chatId}:${playerId}`);
    await this.membership(() => this.sdk!.removeUserAccessFromChatRoom(chatId, playerId));
  }

  private async membership(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { code?: string } } };
      if (err.response?.status === 404 && err.response.data?.code === 'CHAT_NOT_FOUND') {
        this.membershipSupported = false;
        console.warn('[ethora] rooms are public app chats; membership is not managed (users-access: CHAT_NOT_FOUND). Continuing without it.');
        return;
      }
      throw e;
    }
  }

  /** Moves a character's agent from one room's chat to another (invite-to-chat / leave-chat). */
  async moveAgent(characterId: string, fromRoomId: string, toRoomId: string): Promise<void> {
    const agent = this.ids?.agents?.[characterId];
    const from = this.ids?.rooms[fromRoomId];
    const to = this.ids?.rooms[toRoomId];
    if (!this.sdk || !agent || !to || !this.appId) return;
    const token = createServerToken({ chatApiUrl: sdkApiUrl, chatAppId: this.appId, chatAppSecret: appSecretFor(this.slug)! });
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-custom-token': token };
    const post = async (url: string, body: unknown) => {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${url}`), { response: { status: res.status, data: await res.text() } });
    };
    await post(`${sdkApiUrl}/v2/apps/${this.appId}/agents/${agent.agentId}/invite-to-chat`, { chatJid: to.jid });
    if (agent.botInstanceId && from) {
      await post(`${sdkApiUrl}/v2/agents/${agent.agentId}/bot-instances/${agent.botInstanceId}/leave-chat`, { chatJid: from.jid });
    }
  }

  /**
   * Adds a note to a character's Memory (the agent's standing notes, `soulMd`). Needs the user API key for the hosted
   * MCP: the app's server token may not touch agents (ETHORA-GAPS #14, #17). Without it the note stays in the log.
   */
  async remember(characterId: string, note: string): Promise<boolean> {
    const agent = this.ids?.agents?.[characterId];
    if (!agent) return false;
    debug(this.slug ?? '-', 'memory', { character: characterId, text: note, written: ethoraMcpAvailable });
    if (!ethoraMcpAvailable) {
      console.log(`[memory:${characterId}] (no ETHORA_API_KEY, not written) ${note}`);
      return false;
    }
    await withEthoraMcp((call) => call('ethora-agent-soul-append', { agentId: agent.agentId, append: note }));
    return true;
  }

  /** Posts a narration line ("Alice has joined (E)", italic) into the room through the app's broadcast sender. */
  narrate(roomId: string, text: string): Promise<void> {
    return this.post(roomId, narrationBody(text), 'narration');
  }

  /** Posts a raw body (a character's scripted line, already formatted) into the room. */
  async post(roomId: string, body: string, kind: 'narration' | 'line' = 'line'): Promise<void> {
    const r = this.ids?.rooms[roomId];
    debug(this.slug ?? '-', 'post', { room: roomId, kind, text: body, sent: Boolean(this.sdk && r) });
    if (!this.sdk || !r || !this.appId) {
      console.log(`[${kind}:${roomId}] ${body}`);
      return;
    }
    // The sender shown is the app's broadcast sender; the broadcast endpoint rejects a per-message senderName.
    await this.sdk.broadcastToAppChats(this.appId, {
      text: body,
      chatNames: [r.jid],
      metadata: { bookworld: { kind, narrator: NARRATOR_NAME } },
    });
  }
}

/** `ETHORA_CHAT_APP_SECRET_ALICE` for the world "alice"; worlds without their own variable share ETHORA_CHAT_APP_SECRET. */
function secretVar(slug?: string): string {
  return `ETHORA_CHAT_APP_SECRET_${(slug ?? '').toUpperCase().replace(/-/g, '_')}`;
}
function appSecretFor(slug?: string): string | undefined {
  if (slug && process.env[secretVar(slug)]) return process.env[secretVar(slug)];
  // The shared variable is only safe when one world has Ethora ids; with several, each needs its own.
  const withIds = listWorlds().filter((w) => w.ethora).length;
  if (withIds <= 1) return process.env.ETHORA_CHAT_APP_SECRET || undefined;
  if (process.env.ETHORA_CHAT_APP_SECRET && slug) console.warn(`[ethora] ${withIds} worlds have Ethora ids; set ${secretVar(slug)} (the shared ETHORA_CHAT_APP_SECRET is ignored)`);
  return undefined;
}

/** Wraps an Ethora call so a chat outage never breaks movement. */
export async function tryEthora(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    console.error(`[ethora] ${label} failed:`, err.response?.status ?? '', err.response?.data ?? err.message);
    debug('-', 'ethora.error', { label, status: err.response?.status ?? null, detail: typeof err.response?.data === 'string' ? err.response.data : err.message ?? null });
    return false;
  }
}
