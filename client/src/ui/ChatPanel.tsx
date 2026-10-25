// The Ethora chat component as a side panel, pinned to the current room. Mounted once; hidden with CSS
// so the XMPP connection and message cache survive opening and closing.
import { useEffect, useMemo, useRef } from 'react';
import { Chat, XmppProvider, type IConfig } from '@ethora/chat-component';
import { useStore } from '../store.ts';
import { ChatMessages } from './ChatMessages.tsx';
import { reportSaid } from '../net/colyseus.ts';
import type { LessonStateMessage } from '@bookworld/shared';

let panelEl: HTMLElement | null = null;
/** an unnamed line this soon after a character's line is a reply to that character */
const REPLY_WINDOW_MS = 90000;

/** Puts the cursor in the message box (T). Retries briefly because the panel may still be mounting. */
export function focusComposer(tries = 10) {
  const area = panelEl?.querySelector('textarea');
  // the panel may still be hidden (the open state has not rendered yet), in which case focus() does nothing
  if (area) area.focus();
  if (area && document.activeElement === area) return;
  if (tries > 0) setTimeout(() => focusComposer(tries - 1), 100);
}

/**
 * Sends a line into the room in the visitor's own name through the chat component's composer (the component owns
 * the connection; this fills its box and presses Enter for them). The panel opens so they see the answer.
 */
export function sayInChat(text: string): boolean {
  const area = panelEl?.querySelector('textarea');
  if (!area) return false;
  useStore.getState().setChatOpen(true);
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text);
  area.dispatchEvent(new Event('input', { bubbles: true }));
  // the component sends on keyCode 13, not on key
  area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true } as KeyboardEventInit));
  return true;
}

/** Leaves the message box so the keys walk again; the panel stays open for reading. */
export function blurComposer() {
  (document.activeElement as HTMLElement | null)?.blur?.();
  useStore.getState().setChatTyping(false);
}

/** "Hatter" becomes "H\u200batter": looks the same, is not a mention for the agent's name matcher. */
export function muteCharacterNames(text: string): string {
  let out = text;
  for (const c of Object.values(useStore.getState().characters)) {
    const re = new RegExp(`\\b(${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi');
    out = out.replace(re, (m) => m[0] + '\u200b' + m.slice(1));
  }
  return out;
}

/** The lesson under way as one line: what the trainer needs in order to answer "how am I doing". */
function scoreboard(l: LessonStateMessage): string {
  const a = l.active!;
  const learned = `${a.song.learned} of ${a.song.lines} lines learned`;
  const weak = a.weak?.length ? `, keeps missing ${a.weak.join(', ')}` : '';
  const goal = l.plan?.goal ? `; goal: ${l.plan.goal}` : '';
  return `Lesson: "${a.song.title}" (${a.mode}), round ${a.round?.n ?? a.score.tries}, ${a.score.hits} of ${a.score.tries} right, ${learned}${weak}${goal}`;
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
    panelEl = el;
    // typing in the composer takes the keys away from walking; leaving it gives them back
    const typingOn = (e: FocusEvent) => { if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') useStore.getState().setChatTyping(true); };
    const typingOff = (e: FocusEvent) => { if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') useStore.getState().setChatTyping(false); };
    el.addEventListener('focusin', typingOn);
    el.addEventListener('focusout', typingOff);
    const gate = (e: Event) => {
      if (e instanceof KeyboardEvent && (e.key !== 'Enter' || e.shiftKey)) return;
      const area = el.querySelector('textarea');
      if (!area || !area.value) return;
      if (e instanceof MouseEvent && (e.target as HTMLElement)?.closest('textarea')) return;
      const s = useStore.getState();
      let text = area.value;
      const ai = s.ai;
      if (ai && (ai.asleep || ai.limited)) {
        text = muteCharacterNames(text);
        if (text !== area.value) s.setToast(ai.asleep ? 'The characters are resting; only visitors will read this' : 'Your share of the characters is used up for today');
      }
      // The agents answer only when named. A line that names nobody is taken as addressed to the character it is
      // evidently for: the trainer in a practice room, the only character in the room, or the character who spoke
      // last here a moment ago (a reply to them). Their name goes in front, so the agent hears it and all can see.
      const lesson = s.lesson;
      const chars = Object.values(s.characters);
      if (!/^[♪_*(]/.test(text) && !chars.some((c) => text.toLowerCase().includes(c.name.toLowerCase()))) {
        const last = s.lastLine;
        const addressee = lesson ? lesson.trainer
          : chars.length === 1 ? chars[0]!.name
          : last?.character && Date.now() - last.at < REPLY_WINDOW_MS && chars.some((c) => c.name === last.from) ? last.from
          : null;
        if (addressee) text = `${addressee}, ${text}`;
      }
      // A question to the trainer during a lesson carries the scoreboard with it: the agent does not see the room's
      // own lines (ETHORA-GAPS #22), so the score travels inside the visitor's message, in brackets for all to read.
      if (lesson?.active && !lesson.active.finished && text.toLowerCase().includes(lesson.trainer.toLowerCase()) && !text.includes('(Lesson:')) {
        text += `\n(${scoreboard(lesson)})`;
      }
      if (text === area.value) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    };
    el.addEventListener('keydown', gate, true);
    el.addEventListener('click', gate, true);
    return () => {
      el.removeEventListener('keydown', gate, true); el.removeEventListener('click', gate, true);
      el.removeEventListener('focusin', typingOn); el.removeEventListener('focusout', typingOff);
      panelEl = null;
    };
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
        reportSaid(named.map((c) => c.id), message);
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
            <Chat config={config} roomJID={roomJID} MainComponentStyles={{ height: '100%', background: 'transparent' }} CustomScrollableArea={ChatMessages} />
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
