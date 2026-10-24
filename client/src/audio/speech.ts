// Singing into the microphone: the browser's own speech recognition (Chrome, Edge and Safari have it; Firefox does
// not) listens in the song's language and reports what it heard, guesses while the line is sung and a settled text
// after it. The server judges; nothing of the audio leaves the browser except through the browser's own recogniser
// (Chrome and Edge send it to Google or Microsoft, Safari to Apple), which is the browser's standing arrangement.
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && ctor() !== null;
}

let rec: Recognition | null = null;
let wanted = false;
let lang = 'en-US';

export function hearing(): boolean {
  return wanted && rec !== null;
}

/**
 * Starts listening for singing in `language` (a BCP 47 tag) and reports each result: `final` false while the
 * recogniser is still guessing, true when it settled. Restarts itself after the pauses the browser imposes.
 * Resolves false when the browser has no recogniser; a refused microphone comes back through `onError`.
 */
export function startHearing(language: string, onHeard: (text: string, final: boolean) => void, onError: (reason: string) => void): boolean {
  const Ctor = ctor();
  if (!Ctor) return false;
  stopHearing();
  wanted = true;
  lang = language;
  const begin = () => {
    if (!wanted) return;
    const r = new Ctor();
    rec = r;
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) onHeard(text, true); else interim += (interim ? ' ' : '') + text;
      }
      if (interim) onHeard(interim, false);
    };
    r.onerror = (e) => {
      // 'no-speech' and 'aborted' are routine; the rest ends the session with a word for the player
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      wanted = false;
      onError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'The microphone is not available for speech' : e.error === 'network' ? 'Speech recognition needs the network' : `Speech recognition stopped (${e.error})`);
    };
    r.onend = () => { if (wanted && rec === r) setTimeout(begin, 150); };
    try { r.start(); } catch { setTimeout(begin, 500); }
  };
  begin();
  return true;
}

/** Changes the language mid-session (the next song is in another one). */
export function setHearingLang(language: string) {
  if (language === lang) return;
  lang = language;
  if (wanted && rec) { const r = rec; rec = null; try { r.abort(); } catch { /* ignore */ } setTimeout(() => { if (wanted) startHearing(lang, noop, noop); }, 100); }
}
const noop = () => undefined;

export function stopHearing() {
  wanted = false;
  const r = rec;
  rec = null;
  if (r) { r.onend = null; r.onresult = null; try { r.abort(); } catch { /* ignore */ } }
}
