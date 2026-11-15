// A line of the world (narration, a character's scripted line) reaches the client twice: over the world's own
// connection at once, and through the chat when Ethora delivers the broadcast, which it does not always do
// (docs/ETHORA-GAPS.md, 25). Whichever comes first is spoken and shown as a bubble; the other is ignored.
import { parseCharacterLine, narrationText } from '@bookworld/shared';
import { useStore } from './store.ts';
import { speak } from './audio/voice.ts';

const WINDOW_MS = 30000;
const recent = new Map<string, number>();

/** True the first time this body is seen within half a minute. */
function firstTime(body: string): boolean {
  const now = Date.now();
  for (const [b, t] of recent) if (now - t > WINDOW_MS) recent.delete(b);
  if (recent.has(body)) return false;
  recent.set(body, now);
  return true;
}

function isCharacter(name: string): boolean {
  return Object.values(useStore.getState().characters).some((c) => c.name === name);
}

/** The bubble and the voice for a character's line; narration needs neither. Returns whether the body was a character line. */
export function performLine(body: string): boolean {
  const line = parseCharacterLine(narrationText(body));
  if (!line) return false;
  if (!firstTime(body)) return true;
  const s = useStore.getState();
  s.setBubble(line.name, line.text);
  s.setLastLine(line.name, isCharacter(line.name));
  if (isCharacter(line.name)) speak(line.name, line.text);
  return true;
}
