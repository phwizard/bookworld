// The band of one room: the bass and the drums lying there follow the chords the players strike, bar by bar, on
// a clock this object keeps. Each bar goes out a little before it starts with the server time of its first beat;
// the clients schedule the hits against that (they sync their clocks with MSG.clock). No model, no chat lines
// per bar: the chat gets one narration when the band starts and one when it stops.
import { BEATS_PER_BAR, BPM_DEFAULT, bassBar, clampBpm, drumBar, type BandPart, type BandState, type BarMessage } from '@bookworld/shared';

/** a bar is sent this long before its first beat */
const LEAD_MS = 900;

export interface BandIO {
  /** the unheld bass and drums in the room right now: item id and instrument */
  instruments(): { id: string; instrument: 'bass' | 'drums' }[];
  bar(msg: BarMessage): void;
  state(s: BandState): void;
  narrate(text: string): void;
  /** test seams */
  now?(): number;
  schedule?(fn: () => void, ms: number): unknown;
  cancel?(h: unknown): void;
}

export class Band {
  private on = false;
  private bpm = BPM_DEFAULT;
  private chord: string | null = null;
  private by: string | null = null;
  private n = 0;
  private nextAt = 0;
  private timer: unknown = null;

  constructor(private io: BandIO) {}

  get playing() { return this.on; }

  /** Starts (or restarts) at `bpm`; false when nothing is lying in the room to play. */
  start(by: string, bpm?: number): boolean {
    const parts = this.io.instruments();
    if (!parts.length) return false;
    if (bpm) this.bpm = clampBpm(bpm);
    this.by = by;
    if (!this.on) {
      this.on = true;
      this.n = 0;
      this.nextAt = this.now() + LEAD_MS + 200;
      this.io.narrate(`The band joins in: ${this.partNames().join(' and ')} at ${this.bpm} bpm, following ${by}`);
      this.tick();
    }
    this.push();
    return true;
  }

  stop(reason = 'The band stops') {
    if (!this.on) return;
    this.on = false;
    this.clear();
    this.io.narrate(reason);
    this.push();
  }

  /** A new tempo takes effect from the next bar. */
  setTempo(bpm: number) {
    this.bpm = clampBpm(bpm);
    if (this.on) this.push();
  }

  /** The chord the players are on (the last chord struck by anyone in the room). */
  setChord(token: string) {
    this.chord = token;
    if (this.on) this.push();
  }

  state(): BandState {
    return { on: this.on, bpm: this.bpm, chord: this.chord, parts: this.on ? this.partNames() : [], by: this.by };
  }

  private partNames(): string[] {
    return this.io.instruments().map((p) => p.instrument === 'bass' ? 'bass' : 'drums');
  }

  /** Sends the next bar and arms the timer for the one after; stops when the instruments are gone. */
  private tick() {
    if (!this.on) return;
    const instruments = this.io.instruments();
    if (!instruments.length) return this.stop('The band stops: nothing left to play');
    const beatMs = 60000 / this.bpm;
    const parts: BandPart[] = instruments.map((p) => ({ item: p.id, instrument: p.instrument, hits: p.instrument === 'bass' ? bassBar(this.chord) : drumBar(this.n) }));
    this.io.bar({ n: this.n, at: this.nextAt, bpm: this.bpm, beats: BEATS_PER_BAR, parts });
    this.n++;
    const barMs = beatMs * BEATS_PER_BAR;
    this.nextAt += barMs;
    this.timer = (this.io.schedule ?? ((f, ms) => setTimeout(f, ms)))(() => this.tick(), Math.max(10, this.nextAt - LEAD_MS - this.now()));
  }

  private clear() {
    if (this.timer == null) return;
    (this.io.cancel ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.timer);
    this.timer = null;
  }

  private now() { return (this.io.now ?? Date.now)(); }
  private push() { this.io.state(this.state()); }
}
