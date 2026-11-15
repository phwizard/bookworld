// Replaces the chat component's message list so the 3D scene can mirror new messages as speech bubbles
// and narration lines ("Alice has joined (E)") render as quiet system lines instead of chat bubbles.
import { useEffect, useRef } from 'react';
import type { CustomScrollableAreaProps, IMessage } from '@ethora/chat-component';
import { isNarration, narrationText, parseCharacterLine, parseMusicLine } from '@bookworld/shared';
import { poses, useStore } from '../store.ts';
import { playSound } from '../audio/engine.ts';
import { speak } from '../audio/voice.ts';
import { performLine } from '../roomLines.ts';
import { playTokens } from '../audio/instruments.ts';
import { reportChatSeen } from '../net/colyseus.ts';

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

/** True when a character of that name is in the room (characters speak; humans do not get a synthetic voice). */
function isCharacter(name: string): boolean {
  return Object.values(useStore.getState().characters).some((c) => c.name === name);
}

export function ChatMessages(props: CustomScrollableAreaProps) {
  const { decoratedMessages, renderMessage, roomJID, loadMoreMessages, isLoading } = props;
  const box = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const wireCount = useStore((st) => st.wireLines.length);

  // New messages become bubbles over the speaker's avatar. The component mutates its message arrays in place,
  // so this runs after every render and relies on the `seen` set to stay cheap.
  useEffect(() => {
    const now = Date.now();
    const me = useStore.getState().session?.name;
    for (const { message: m } of decoratedMessages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      // (the app's broadcasts are flagged as system messages; narration and character lines are exactly those)
      if (!m.body) continue;
      // the operator's debug log, when on, gets every message of the room from the clients (the server cannot read the history)
      if (useStore.getState().session?.debug && now - messageTime(m) <= 120000) reportChatSeen({ id: m.id, from: speakerName(m) || 'app', text: m.body, at: messageTime(m) || undefined });
      if (parseCharacterLine(narrationText(m.body))) {
        // spoken once, whether it came here first or over the world's connection
        if (now - messageTime(m) <= BUBBLE_MAX_AGE_MS) performLine(m.body);
        continue;
      }
      // A player's phrase comes back from the server as narration (everyone heard it live); a character's or a
      // visitor's own music line in a normal message is played here, from where they stand.
      if (isNarration(m.body)) continue;
      if (now - messageTime(m) > BUBBLE_MAX_AGE_MS) { if (import.meta.env.DEV) console.log('[bubbles] too old', now - messageTime(m), m.body.slice(0, 30)); continue; }
      const who = speakerName(m);
      if (import.meta.env.DEV) console.log('[bubbles] candidate', { who, me, age: now - messageTime(m), body: m.body.slice(0, 40) });
      if (who) useStore.getState().setLastLine(who, isCharacter(who));
      if (!who || who === me) continue;
      const music = parseMusicLine(m.body);
      if (music) {
        const player = music.who ?? who;
        const character = Object.values(useStore.getState().characters).find((c) => c.name === player || c.name === who);
        const pose = character ? poses.get(`c:${character.id}`) : null;
        playTokens(music.instrument, music.tokens, { at: pose ? [pose.x, pose.y + 1.2, pose.z] : undefined });
        useStore.getState().setBubble(who, `♪ ${music.tokens.join(' ')}`);
        const words = m.body.split(/\r?\n/).filter((l) => !l.includes('♪')).join(' ').trim();
        if (words && isCharacter(who)) speak(who, words);
        continue;
      }
      useStore.getState().setBubble(who, m.body);
      playSound('message', { volume: 0.3 });
      if (isCharacter(who)) speak(who, m.body);
    }
  });

  useEffect(() => {
    const el = box.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [decoratedMessages.length, wireCount]);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 30 && !isLoading) void loadMoreMessages(roomJID, 30);
  }

  // The world's lines that came over its own connection and are not in the chat (the broadcast was not delivered)
  // take their place in the list by time.
  const wire = useStore((st) => st.wireLines);
  const inChat = new Map<string, number[]>();
  for (const d of decoratedMessages) if (d.message.body) inChat.set(d.message.body, [...(inChat.get(d.message.body) ?? []), messageTime(d.message)]);
  const missing = wire.filter((l) => !(inChat.get(l.body) ?? []).some((t) => Math.abs(t - l.at) < 5 * 60_000));
  const rows: { key: string; body: string; at: number; chat?: (typeof decoratedMessages)[number] }[] = [
    ...decoratedMessages.map((d) => ({ key: d.message.id, body: d.message.body ?? '', at: messageTime(d.message), chat: d })),
    ...missing.map((l) => ({ key: `wire-${l.id}`, body: l.body, at: l.at })),
  ];
  if (missing.length) rows.sort((x, y) => x.at - y.at);

  return (
    <div className="bw-messages" ref={box} onScroll={onScroll}>
      {rows.map((r) => {
        const line = parseCharacterLine(narrationText(r.body));
        return line ? (
          <div key={r.key} className="bw-line"><b>{line.name}</b> {line.text}</div>
        ) : isNarration(r.body) ? (
          <div key={r.key} className="bw-narration">{narrationText(r.body)}</div>
        ) : r.chat ? (
          <div key={r.key}>{renderMessage(r.chat)}</div>
        ) : (
          <div key={r.key} className="bw-narration">{r.body}</div>
        );
      })}
    </div>
  );
}
