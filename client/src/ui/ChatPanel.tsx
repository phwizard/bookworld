// The Ethora chat component as a side panel, pinned to the current room. Mounted once; hidden with CSS
// so the XMPP connection and message cache survive opening and closing.
import { useEffect, useMemo, useRef } from 'react';
import { Chat, XmppProvider, type IConfig } from '@ethora/chat-component';
import { useStore } from '../store.ts';
import { ChatMessages } from './ChatMessages.tsx';
import { reportSaid } from '../net/colyseus.ts';

/** "Hatter" becomes "H\u200batter": looks the same, is not a mention for the agent's name matcher. */
export function muteCharacterNames(text: string): string {
  let out = text;
  for (const c of Object.values(useStore.getState().characters)) {
    const re = new RegExp(`\\b(${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi');
    out = out.replace(re, (m) => m[0] + '\u200b' + m.slice(1));
  }
  return out;
}

export function ChatPanel() {
  const session = useStore((s) => s.session)!;
  const location = useStore((s) => s.location);
  const open = useStore((s) => s.chatOpen);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const { ethora } = session;
  const jid = ethora.rooms[location];
  const roomJID = jid ? `${jid}@conference.${ethora.xmppDomain}` : undefined;
  const panel = useRef<HTMLElement>(null);

  // Budget gate: while the characters rest (world limit) or this visitor's share is spent, outgoing text gets a
  // zero-width space inside each character's name, so the message still reaches the room but no agent is mentioned.
  // Runs in the capture phase, before the chat component reads the textarea on Enter or on the send button.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const gate = (e: Event) => {
      const ai = useStore.getState().ai;
      if (!ai || (!ai.asleep && !ai.limited)) return;
      if (e instanceof KeyboardEvent && (e.key !== 'Enter' || e.shiftKey)) return;
      const area = el.querySelector('textarea');
      if (!area || !area.value) return;
      if (e instanceof MouseEvent && (e.target as HTMLElement)?.closest('textarea')) return;
      const muted = muteCharacterNames(area.value);
      if (muted === area.value) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, muted);
      area.dispatchEvent(new Event('input', { bubbles: true }));
      useStore.getState().setToast(ai.asleep ? 'The characters are resting; only visitors will read this' : 'Your share of the characters is used up for today');
    };
    el.addEventListener('keydown', gate, true);
    el.addEventListener('click', gate, true);
    return () => { el.removeEventListener('keydown', gate, true); el.removeEventListener('click', gate, true); };
  }, []);

  const config = useMemo<IConfig>(() => ({
    baseUrl: ethora.apiBaseUrl,
    appId: ethora.appId ?? undefined,
    jwtLogin: ethora.chatToken ? { enabled: true, token: ethora.chatToken } : undefined,
    // Without these the component has no WebSocket endpoint (it otherwise reads VITE_XMPP_HOST) and sits on "Connecting...".
    xmppSettings: {
      devServer: `wss://${ethora.xmppDomain}/ws`,
      host: ethora.xmppDomain,
      conference: `conference.${ethora.xmppDomain}`,
    },
    initBeforeLoad: false,
    useStoreConsoleEnabled: import.meta.env.DEV,
    disableRooms: true,
    disableHeader: true,
    chatHeaderSettings: { hide: true },
    disableRoomMenu: true,
    disableNewChatButton: true,
    disablePublicChatsDirectory: true,
    setRoomJidInPath: false,
    colors: { primary: '#3a2d1c', secondary: '#f3e6c4' },
    eventHandlers: {
      onMessageSent: ({ message }) => {
        // Characters named in the message turn to face the speaker; the server also counts the message.
        const text = message.toLowerCase();
        const named = Object.values(useStore.getState().characters).filter((c) => text.includes(c.name.toLowerCase()));
        reportSaid(named.map((c) => c.id));
      },
    },
  }), [ethora.apiBaseUrl, ethora.appId, ethora.chatToken, ethora.xmppDomain]);

  return (
    <aside ref={panel} className={`chat${open ? '' : ' hidden'}`} aria-hidden={!open}>
      <header>
        <span>{session.world.rooms.find((r) => r.id === location)?.name ?? location}</span>
        <button onClick={() => setChatOpen(false)}>Esc</button>
      </header>
      <div className="body">
        {ethora.enabled && roomJID ? (
          <XmppProvider config={config}>
            <Chat config={config} roomJID={roomJID} MainComponentStyles={{ height: '100%' }} CustomScrollableArea={ChatMessages} />
          </XmppProvider>
        ) : (
          <div className="disabled">
            Chat is off: the world service is running without Ethora credentials (set ETHORA_CHAT_APP_SECRET in .env). Movement and presence still work.
          </div>
        )}
      </div>
    </aside>
  );
}
