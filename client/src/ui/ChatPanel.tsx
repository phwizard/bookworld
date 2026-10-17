// The Ethora chat component as a side panel, pinned to the current room. Mounted once; hidden with CSS
// so the XMPP connection and message cache survive opening and closing.
import { useMemo } from 'react';
import { Chat, XmppProvider, type IConfig } from '@ethora/chat-component';
import { useStore } from '../store.ts';

export function ChatPanel() {
  const session = useStore((s) => s.session)!;
  const location = useStore((s) => s.location);
  const open = useStore((s) => s.chatOpen);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const { ethora } = session;
  const jid = ethora.rooms[location];
  const roomJID = jid ? `${jid}@conference.${ethora.xmppDomain}` : undefined;

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
  }), [ethora.apiBaseUrl, ethora.appId, ethora.chatToken, ethora.xmppDomain]);

  return (
    <aside className={`chat${open ? '' : ' hidden'}`} aria-hidden={!open}>
      <header>
        <span>{session.world.rooms.find((r) => r.id === location)?.name ?? location}</span>
        <button onClick={() => setChatOpen(false)}>Esc</button>
      </header>
      <div className="body">
        {ethora.enabled && roomJID ? (
          <XmppProvider config={config}>
            <Chat config={config} roomJID={roomJID} MainComponentStyles={{ height: '100%' }} />
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
