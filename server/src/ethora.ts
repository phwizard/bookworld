// Everything the world service asks Ethora for. Ethora is used only through its public backend SDK
// (B2B server token signed with the App Secret). If the credentials are missing the service runs in
// "no chat" mode so movement can be developed and tested without them.
import { EthoraSDKService } from '@ethora/sdk-backend';
import { NARRATION_PREFIX, NARRATOR_NAME } from '@bookworld/shared';
import type { WorldEthoraIds } from './world/load.ts';

const apiBaseUrl = process.env.ETHORA_API_BASE_URL ?? 'https://api.chat.ethora.com/v1';
const xmppDomain = process.env.ETHORA_XMPP_DOMAIN ?? 'xmpp.chat.ethora.com';

export class EthoraWorldService {
  readonly enabled: boolean;
  readonly appId: string | null;
  readonly apiBaseUrl = apiBaseUrl;
  readonly xmppDomain = xmppDomain;
  private sdk: EthoraSDKService | null = null;
  private granted = new Set<string>();

  constructor(private ids: WorldEthoraIds | null) {
    const appSecret = process.env.ETHORA_CHAT_APP_SECRET;
    this.appId = ids?.appId ?? null;
    this.enabled = Boolean(ids && appSecret);
    if (this.enabled) {
      process.env.ETHORA_CHAT_API_URL ??= apiBaseUrl;
      process.env.ETHORA_CHAT_APP_ID = this.appId!;
      this.sdk = new EthoraSDKService({ chatAppId: this.appId!, chatAppSecret: appSecret! });
    } else {
      console.warn(`[ethora] disabled for app ${this.appId ?? '(none)'}: ${ids ? 'ETHORA_CHAT_APP_SECRET not set' : 'no ethora.json for this world'}`);
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
    await this.sdk.createUser(playerId, { firstName: name, lastName: '(guest)', email: `${playerId}@guest.bookworld.invalid` });
  }

  /** Client JWT the chat component exchanges for a user session (config.jwtLogin.token). */
  chatToken(playerId: string): string | null {
    return this.sdk ? this.sdk.createChatUserJwtToken(playerId) : null;
  }

  async grant(roomId: string, playerId: string): Promise<void> {
    const chatId = this.chatId(roomId);
    if (!this.sdk || !chatId) return;
    const key = `${chatId}:${playerId}`;
    if (this.granted.has(key)) return;
    await this.sdk.grantUserAccessToChatRoom(chatId, playerId);
    this.granted.add(key);
  }

  async revoke(roomId: string, playerId: string): Promise<void> {
    const chatId = this.chatId(roomId);
    if (!this.sdk || !chatId) return;
    this.granted.delete(`${chatId}:${playerId}`);
    await this.sdk.removeUserAccessFromChatRoom(chatId, playerId);
  }

  /** Posts a narration line ("* Alice has joined (E)") into the room as the Narrator. */
  async narrate(roomId: string, text: string): Promise<void> {
    const r = this.ids?.rooms[roomId];
    if (!this.sdk || !r || !this.appId) {
      console.log(`[narrate:${roomId}] ${text}`);
      return;
    }
    await this.sdk.broadcastToAppChats(this.appId, {
      text: NARRATION_PREFIX + text,
      chatNames: [r.jid],
      senderName: NARRATOR_NAME,
      metadata: { bookworld: { kind: 'narration' } },
    });
  }
}

/** Wraps an Ethora call so a chat outage never breaks movement. */
export async function tryEthora(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    console.error(`[ethora] ${label} failed:`, err.response?.status ?? '', err.response?.data ?? err.message);
    return false;
  }
}
