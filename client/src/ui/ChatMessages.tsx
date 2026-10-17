// Replaces the chat component's message list so the 3D scene can mirror new messages as speech bubbles
// and narration lines ("Alice has joined (E)") render as quiet system lines instead of chat bubbles.
import { useEffect, useRef } from 'react';
import type { CustomScrollableAreaProps, IMessage } from '@ethora/chat-component';
import { isNarration, narrationText } from '@bookworld/shared';
import { useStore } from '../store.ts';

const BUBBLE_MAX_AGE_MS = 15000;
const seen = new Set<string>();

function messageTime(m: IMessage): number {
  const t = m.messageTimestampMs ?? m.timestamp;
  if (typeof t === 'number' && t > 0) return t;
  const d = m.date instanceof Date ? m.date.getTime() : Date.parse(String(m.date));
  return Number.isFinite(d) ? d : 0;
}

/** First name of the sender as shown over the avatar (guests are "Name (guest)" on the Ethora side). */
export function speakerName(m: IMessage): string {
  const u = m.user;
  const full = (u?.name ?? [u?.firstName, u?.lastName].filter(Boolean).join(' ')).trim();
  return full.replace(/\s*\(guest\)\s*$/i, '');
}

export function ChatMessages(props: CustomScrollableAreaProps) {
  const { decoratedMessages, messages, renderMessage, roomJID, loadMoreMessages, isLoading } = props;
  const box = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // New messages become bubbles over the speaker's avatar.
  useEffect(() => {
    const now = Date.now();
    const me = useStore.getState().session?.name;
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      if (isNarration(m.body) || m.isSystemMessage || !m.body) continue;
      if (now - messageTime(m) > BUBBLE_MAX_AGE_MS) { if (import.meta.env.DEV) console.log('[bubbles] too old', now - messageTime(m), m.body.slice(0, 30)); continue; }
      const who = speakerName(m);
      if (import.meta.env.DEV) console.log('[bubbles] candidate', { who, me, age: now - messageTime(m), body: m.body.slice(0, 40) });
      if (!who || who === me) continue;
      useStore.getState().setBubble(who, m.body);
    }
  }, [messages]);

  useEffect(() => {
    const el = box.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [decoratedMessages.length]);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 30 && !isLoading) void loadMoreMessages(roomJID, 30);
  }

  return (
    <div className="bw-messages" ref={box} onScroll={onScroll}>
      {decoratedMessages.map((d) =>
        isNarration(d.message.body) ? (
          <div key={d.message.id} className="bw-narration">{narrationText(d.message.body)}</div>
        ) : (
          <div key={d.message.id}>{renderMessage(d)}</div>
        ),
      )}
    </div>
  );
}
