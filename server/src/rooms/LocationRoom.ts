// One Colyseus room per world location. Holds who is here and where they stand; validates moves
// through doors and performs the Ethora room switch (revoke old, grant new, narration lines).
import { Room, type Client } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import {
  MSG, OPPOSITE, DIRECTIONS, DIRECTION_LABEL, entryPose, roomById, roomSize, roomSpawn, clamp, musicLine, validToken,
  type SaidMessage, type AiMessage, type AwayMessage, type Direction, type JoinOptions, type MoveMessage, type MovedMessage, type PosMessage, type World, type WorldRoom,
  type TakeMessage, type PlayMessage, type PlayedMessage, type LessonCommand, type LessonStateMessage, type LessonActive, type WorldLesson, type Song, type LessonMode,
  type ChatSeenMessage, type BandCommand, type ClockMessage, characterLine, characterSeat, LESSON_MODES,
} from '@bookworld/shared';
import { verifySession, type Session } from '../auth.ts';
import { getWorld } from '../world/load.ts';
import { tryEthora, type EthoraWorldService } from '../ethora.ts';
import { budgetFor, ethoraFor, simFor } from '../services.ts';
import type { AiBudget } from '../budget.ts';
import { record } from '../metrics.ts';
import { debug, debugOn, firstSighting } from '../debuglog.ts';
import * as presence from '../presence.ts';
import type { CharState, ItemState, WorldSim } from '../world/sim.ts';
import { Lesson, daysAgo, songCard } from '../world/lesson.ts';
import { Band } from '../world/band.ts';
import { canSing, prerenderSung, sungUrl, voicedCharacters } from '../voice.ts';
import { loadPlan, progressOn, savePlan, saveProgress, songById, songsFor } from '../world/songs.ts';

export const Player = schema({
  id: t.string(),
  name: t.string(),
  x: t.number(),
  y: t.number(),
  z: t.number(),
  ry: t.number(),
  anim: t.string(),
  away: t.boolean(),
}, 'Player');
export type Player = SchemaType<typeof Player>;

export const Character = schema({
  id: t.string(),
  name: t.string(),
  x: t.number(),
  y: t.number(),
  z: t.number(),
  ry: t.number(),
  anim: t.string(),
}, 'Character');
export type Character = SchemaType<typeof Character>;

export const Item = schema({
  id: t.string(),
  instrument: t.string(),
  name: t.string(),
  x: t.number(),
  y: t.number(),
  z: t.number(),
  /** session id of the carrier in this room, '' on the floor */
  heldBy: t.string(),
}, 'Item');
export type Item = SchemaType<typeof Item>;

export const LocationState = schema({
  world: t.string(),
  location: t.string(),
  players: t.map(Player),
  characters: t.map(Character),
  items: t.map(Item),
}, 'LocationState');
export type LocationState = SchemaType<typeof LocationState>;

interface CreateOptions { world: string; location: string }
interface UserData {
  session: Session;
  moving: boolean;
  gone: boolean;
  /** the open reconnection window of a dropped seat, so a newer seat of the same player can close it */
  reconnection?: { reject: Function } | null;
  /** chords played since the last line went into the chat */
  phrase: string[];
  phraseTimer: NodeJS.Timeout | null;
  /** the drill under way with this room's trainer, if any */
  lesson: Lesson | null;
}

/** how far (metres) a player may stand from an item to pick it up */
const REACH = 2.2;
/** a phrase goes into the chat this long after the last chord, or when it reaches PHRASE_MAX tokens */
const PHRASE_GAP_MS = 4000;
const PHRASE_MAX = 24;

/** close code for a seat a newer seat of the same player took over (a reload, a second tab) */
const CLOSE_REPLACED = 4001;

/** seconds a dropped connection may come back before the player counts as gone */
const RECONNECT_SECONDS = 60;

const ANIMS = new Set(['idle', 'walk', 'run']);

export class LocationRoom extends Room<{ state: LocationState }> {
  maxClients = 32;
  autoDispose = true;
  private world!: World;
  private room!: WorldRoom;
  private ethora!: EthoraWorldService;
  private sim!: WorldSim;
  private budget!: AiBudget;
  /** the practice room definition when this room has a trainer */
  private lessonDef: WorldLesson | null = null;
  /** the room's bass and drums playing along, when switched on */
  private band!: Band;
  /** reconnection windows of dropped seats, by session id */
  private ghosts = new Map<string, { reject: Function }>();
  private unsubscribe: (() => void) | null = null;
  private unsubscribeItems: (() => void) | null = null;
  private unsubscribeBudget: (() => void) | null = null;

  onCreate(options: CreateOptions) {
    const loaded = getWorld(options.world);
    if (!loaded) throw new Error(`unknown world ${options.world}`);
    const room = roomById(loaded.world, options.location);
    if (!room) throw new Error(`unknown location ${options.location} in ${options.world}`);
    this.world = loaded.world;
    this.room = room;
    this.ethora = ethoraFor(options.world);
    this.setPatchRate(50);

    const state = new LocationState();
    state.world = options.world;
    state.location = options.location;
    this.setState(state);

    this.sim = simFor(options.world);
    this.band = new Band({
      instruments: () => this.sim.itemsIn(room.id).filter((it) => !it.heldBy && (it.instrument === 'bass' || it.instrument === 'drums')).map((it) => ({ id: it.id, instrument: it.instrument as 'bass' | 'drums' })),
      bar: (msg) => this.broadcast(MSG.bar, msg),
      state: (s) => this.broadcast(MSG.bandState, s),
      narrate: (text) => void tryEthora('band', () => this.ethora.narrate(room.id, text)),
    });
    this.unsubscribe = this.sim.subscribe(room.id, (chars) => this.syncCharacters(chars));
    this.unsubscribeItems = this.sim.subscribeItems(room.id, (items) => this.syncItems(items));
    this.lessonDef = loaded.world.lessons?.find((l) => l.room === room.id) ?? null;
    this.budget = budgetFor(options.world);
    this.unsubscribeBudget = this.budget.subscribe(() => {
      for (const c of this.clients) c.send(MSG.ai, this.budget.snapshot((c.userData as UserData | undefined)?.session.visitor) satisfies AiMessage);
    });

    const [w, , d] = roomSize(room);
    this.onMessage(MSG.pos, (client, msg: PosMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !msg || typeof msg.x !== 'number') return;
      p.x = clamp(msg.x, -w / 2, w / 2);
      p.y = clamp(msg.y, 0, 10);
      p.z = clamp(msg.z, -d / 2, d / 2);
      p.ry = msg.ry;
      if (ANIMS.has(msg.anim)) p.anim = msg.anim;
    });

    this.onMessage(MSG.move, (client, msg: MoveMessage) => void this.handleMove(client, msg));
    this.onMessage(MSG.away, (client, msg: AwayMessage) => {
      const p = this.state.players.get(client.sessionId);
      const data = client.userData as UserData | undefined;
      if (!p || !data) return;
      p.away = Boolean(msg?.away);
      presence.setAway(this.world.slug, client.sessionId, p.away);
      if (msg?.gone) data.gone = true;
      this.log('away', data, { away: p.away, gone: Boolean(msg?.gone) });
    });
    this.onMessage(MSG.said, (client, msg: SaidMessage) => {
      const p = this.state.players.get(client.sessionId);
      const data = client.userData as UserData | undefined;
      if (!p || !data || !Array.isArray(msg?.characters)) return;
      const named = msg.characters.filter((id) => typeof id === 'string' && this.state.characters.has(id)).slice(0, 8);
      this.log('said', data, { mentions: named, text: typeof msg.text === 'string' ? msg.text.slice(0, 4000) : undefined });
      // Paid replies: count them against the daily budget; a sleeping or rationed character does not turn round.
      const verdict = this.budget.spend(data.session.visitor, named.length);
      if (named.length && !verdict.allowed) client.send(MSG.ai, this.budget.snapshot(data.session.visitor) satisfies AiMessage);
      else if (verdict.allowed && verdict.limited) client.send(MSG.ai, this.budget.snapshot(data.session.visitor) satisfies AiMessage);
      if (verdict.allowed) for (const id of named) this.sim.address(id, p.x, p.z);
      presence.message(this.world.slug);
      // Only the fact of a message and whether it named a character is kept; never the text.
      record({ ev: 'message', world: this.world.slug, pid: data.session.pid, location: this.room.id, mentions: named.length });
    });

    // Instruments: pick up within reach, put down where you stand, play what you carry.
    this.onMessage(MSG.take, (client, msg: TakeMessage) => {
      const p = this.state.players.get(client.sessionId);
      const data = client.userData as UserData | undefined;
      const it = typeof msg?.id === 'string' ? this.sim.items.get(msg.id) : undefined;
      if (!p || !data || !it) return;
      if (it.location !== this.room.id || it.heldBy) return client.send(MSG.denied, { reason: 'that is not here any more' });
      if (this.sim.carriedBy(data.session.pid)) return client.send(MSG.denied, { reason: 'your hands are full' });
      if (Math.hypot(it.x - p.x, it.z - p.z) > REACH) return client.send(MSG.denied, { reason: 'too far away' });
      if (this.sim.take(it.id, data.session.pid, this.room.id)) {
        void tryEthora('narrate take', () => this.ethora.narrate(this.room.id, `${data.session.name} picks up ${it.name}`));
        record({ ev: 'item', world: this.world.slug, pid: data.session.pid, location: this.room.id, item: it.id, take: true });
        this.log('take', data, { item: it.id });
      }
    });
    this.onMessage(MSG.drop, (client) => {
      const p = this.state.players.get(client.sessionId);
      const data = client.userData as UserData | undefined;
      if (!p || !data) return;
      this.flushPhrase(client);
      const it = this.sim.drop(data.session.pid, this.room.id, p.x, p.z);
      if (it) {
        void tryEthora('narrate drop', () => this.ethora.narrate(this.room.id, `${data.session.name} puts down ${it.name}`));
        record({ ev: 'item', world: this.world.slug, pid: data.session.pid, location: this.room.id, item: it.id, take: false });
        this.log('drop', data, { item: it.id });
      }
    });
    this.onMessage(MSG.play, (client, msg: PlayMessage) => {
      const p = this.state.players.get(client.sessionId);
      const data = client.userData as UserData | undefined;
      if (!p || !data || !Array.isArray(msg?.tokens)) return;
      const it = this.sim.carriedBy(data.session.pid);
      if (!it || it.location !== this.room.id) return;
      const tokens = msg.tokens.filter((tk) => typeof tk === 'string' && tk.length <= 8 && validToken(it.instrument, tk)).slice(0, 8);
      if (!tokens.length) return;
      this.broadcast(MSG.played, { sessionId: client.sessionId, name: data.session.name, instrument: it.instrument, tokens } satisfies PlayedMessage, { except: client });
      this.log('play', data, { instrument: it.instrument, tokens });
      if (it.instrument !== 'drums') { data.lesson?.onChords(tokens); this.band.setChord(tokens[tokens.length - 1]!); }
      data.phrase.push(...tokens);
      if (data.phraseTimer) clearTimeout(data.phraseTimer);
      if (data.phrase.length >= PHRASE_MAX) this.flushPhrase(client);
      else data.phraseTimer = setTimeout(() => this.flushPhrase(client), PHRASE_GAP_MS);
    });
    // The practice room: start a song, answer with words, ask for a hint, skip, stop. Chords arrive through MSG.play.
    this.onMessage(MSG.lesson, (client, msg: LessonCommand) => {
      const data = client.userData as UserData | undefined;
      if (!data || !this.lessonDef || !msg || typeof msg.do !== 'string') return;
      this.log('lesson.cmd', data, { cmd: msg });
      switch (msg.do) {
        case 'start': {
          const song = typeof msg.song === 'string' ? songById(this.world.slug, msg.song) : undefined;
          if (!song || !LESSON_MODES.includes(msg.mode)) return client.send(MSG.denied, { reason: 'no such song here' });
          if (!this.lessonDef.songs?.length || this.lessonDef.songs.includes(song.id)) this.startLesson(client, data, song, msg.mode);
          break;
        }
        case 'answer': if (typeof msg.text === 'string') data.lesson?.onAnswer(msg.text.slice(0, 300)); break;
        case 'heard': if (typeof msg.text === 'string') data.lesson?.onHeard(msg.text.slice(0, 600), Boolean(msg.final)); break;
        case 'hint': data.lesson?.askHint(); break;
        case 'skip': data.lesson?.skip(); break;
        case 'stop': data.lesson?.stop(); data.lesson = null; this.sendLesson(client, data, null); break;
        case 'plan': {
          const patch: { list?: string[]; goal?: string } = {};
          if (Array.isArray(msg.list)) patch.list = msg.list.filter((x): x is string => typeof x === 'string' && Boolean(songById(this.world.slug, x)));
          if (typeof msg.goal === 'string') patch.goal = msg.goal;
          savePlan(this.world.slug, data.session.uid, patch);
          this.sendLesson(client, data, data.lesson && !data.lesson.finished ? data.lesson.active() : null);
          break;
        }
      }
    });
    // The band: the room's unheld bass and drums play along with whoever is playing (B), on the room's clock.
    this.onMessage(MSG.band, (client, msg: BandCommand) => {
      const data = client.userData as UserData | undefined;
      if (!data || !msg) return;
      this.log('band', data, { cmd: msg });
      if (typeof msg.bpm === 'number' && Number.isFinite(msg.bpm)) this.band.setTempo(msg.bpm);
      if (msg.on === true && !this.band.start(data.session.name, typeof msg.bpm === 'number' ? msg.bpm : undefined)) client.send(MSG.denied, { reason: 'no bass or drums lying here for the band' });
      if (msg.on === false) this.band.stop();
    });
    this.onMessage(MSG.clock, (client, msg: ClockMessage) => {
      if (!msg || typeof msg.t0 !== 'number') return;
      client.send(MSG.clock, { t0: msg.t0, now: Date.now() } satisfies ClockMessage);
    });
    // While the operator's debug log is on, the clients mirror the room's chat (humans and characters) into it:
    // the service cannot read a room's history itself (ETHORA-GAPS #23). Each message is written once per room.
    this.onMessage(MSG.chat, (client, msg: ChatSeenMessage) => {
      const data = client.userData as UserData | undefined;
      if (!debugOn || !data || !msg || typeof msg.id !== 'string' || typeof msg.text !== 'string') return;
      if (!firstSighting(`${this.world.slug}/${this.room.id}`, msg.id.slice(0, 80))) return;
      debug(this.world.slug, 'chat', { room: this.room.id, id: msg.id.slice(0, 80), from: String(msg.from ?? '').slice(0, 80), text: msg.text.slice(0, 4000), at: typeof msg.at === 'number' ? new Date(msg.at).toISOString() : undefined, seenBy: data.session.name });
    });
    console.log(`[room] created ${options.world}/${options.location}`);
  }

  /** One line of the operator's debug log for something this player did (no-op unless DEBUG_LOG is on). */
  private log(kind: string, data: UserData, fields: Record<string, unknown> = {}) {
    if (!debugOn) return;
    debug(this.world.slug, kind, { room: this.room.id, name: data.session.name, pid: data.session.pid, ...fields });
  }

  private trainer(): { id: string; name: string } | null {
    if (!this.lessonDef) return null;
    const c = this.world.characters.find((ch) => ch.id === this.lessonDef!.trainer);
    return c ? { id: c.id, name: c.name } : null;
  }

  /** The shelf of songs with this player's progress, the lesson under way, and the plan the trainer keeps for them. */
  private sendLesson(client: Client, data: UserData, active: LessonActive | null) {
    const trainer = this.trainer();
    if (!trainer) return;
    const plan = loadPlan(this.world.slug, data.session.uid);
    const songs = songsFor(this.world.slug, this.lessonDef?.songs).map((s) => songCard(s, progressOn(this.world.slug, data.session.uid, s), plan.list.includes(s.id)));
    client.send(MSG.lessonState, { trainer: trainer.name, songs, active, plan } satisfies LessonStateMessage);
  }

  /**
   * A returning player: the trainer picks up where they stopped (the last song and mode, the list, the goal) in a
   * line of its own instead of the room's generic greeting. False when there is nothing to pick up.
   */
  private welcomeBack(data: UserData): boolean {
    const trainer = this.trainer();
    if (!trainer) return false;
    const { slug } = this.world;
    const uid = data.session.uid;
    const plan = loadPlan(slug, uid);
    const songs = songsFor(slug, this.lessonDef?.songs);
    const last = plan.song ? songs.find((s) => s.id === plan.song) : undefined;
    const listed = plan.list.map((id) => songs.find((s) => s.id === id)).filter((s): s is Song => Boolean(s) && s!.id !== last?.id);
    if (!last && !listed.length && !plan.goal) return false;
    const parts = [`Welcome back, ${data.session.name}.`];
    if (last) {
      const card = songCard(last, progressOn(slug, uid, last));
      const whole = card.learned >= card.lines;
      parts.push(`Last time${plan.last ? `, ${daysAgo(plan.last)},` : ''} we worked on "${last.title}" (${plan.mode ?? 'both'}); ${whole ? 'you have the whole song' : `${card.learned} of ${card.lines} lines are yours`}.`);
      if (whole) parts.push('It is ready for the stage.');
    }
    if (listed.length) parts.push(`Still on your list: ${listed.map((s) => `"${s.title}"`).join(', ')}.`);
    if (plan.goal) parts.push(`Your goal: ${plan.goal}.`);
    parts.push(last && !lineCountDone(last, slug, uid) ? 'Pick up the guitar and press L; Continue takes us on from where we stopped.' : 'Pick up the guitar and press L to choose a song.');
    this.log('welcome-back', data, { song: last?.id ?? null, listed: listed.map((s) => s.id), goal: plan.goal ?? null });
    void tryEthora('welcome back', () => this.ethora.post(this.room.id, characterLine(trainer.name, parts.join(' '))));
    return true;

    function lineCountDone(song: Song, w: string, u: string): boolean { const c = songCard(song, progressOn(w, u, song)); return c.learned >= c.lines; }
  }

  private startLesson(client: Client, data: UserData, song: Song, mode: LessonMode) {
    const trainer = this.trainer();
    if (!trainer) return;
    data.lesson?.stop();
    const instrument = this.lessonDef?.instrument ?? 'guitar';
    const { slug } = this.world;
    const uid = data.session.uid;
    const plan = savePlan(slug, uid, { song: song.id, mode });
    const sings = canSing && voicedCharacters(this.world).includes(trainer.id);
    if (sings) prerenderSung(slug, trainer.id, song);
    const lesson = new Lesson(song, mode, data.session.name, progressOn(slug, uid, song), {
      state: (active) => {
        if (data.lesson !== lesson) return;
        // the cue line sung in the trainer's voice, when the song has a melody for it and the server can sing
        const r = active.round;
        if (r && r.line > 0 && sings && lesson.lines[r.line - 1]?.melody) r.cueAudio = sungUrl(slug, trainer.id, song.id, r.line - 1);
        this.sendLesson(client, data, active);
        this.log('lesson.state', data, { song: song.id, round: active.round?.n ?? null, task: active.round?.task ?? null, played: active.round?.played, heard: active.round?.heard, feedback: active.feedback, score: active.score, finished: active.finished });
      },
      sing: (text) => void tryEthora('trainer line', () => this.ethora.post(this.room.id, characterLine(trainer.name, text))),
      play: (chords) => this.broadcast(MSG.played, { sessionId: characterSeat(trainer.id), name: trainer.name, instrument, tokens: chords } satisfies PlayedMessage),
      narrate: (text) => void tryEthora('lesson score', () => this.ethora.narrate(this.room.id, text)),
      save: (p) => saveProgress(slug, uid, song.id, p),
      finished: (note, p) => {
        record({ ev: 'lesson', world: slug, pid: data.session.pid, location: this.room.id, song: song.id, mode, hits: lesson.active().score.hits, tries: lesson.active().score.tries });
        savePlan(slug, uid, { song: song.id, mode, last: p.last, sessions: plan.sessions + 1 });
        void tryEthora('trainer memory', () => this.ethora.remember(trainer.id, note));
      },
    }, plan.goal);
    data.lesson = lesson;
    if (song.tempo) this.band.setTempo(song.tempo);
    presence.message(slug);
    void tryEthora('narrate lesson', () => this.ethora.narrate(this.room.id, `${data.session.name} asks ${trainer.name} for a lesson on "${song.title}" (${mode})`));
    lesson.start();
  }

  /** The chords played so far go into the room's chat as one line, for the people reading and the characters. */
  private flushPhrase(client: Client) {
    const data = client.userData as UserData | undefined;
    if (!data) return;
    if (data.phraseTimer) clearTimeout(data.phraseTimer);
    data.phraseTimer = null;
    if (!data.phrase.length) return;
    const it = this.sim.carriedBy(data.session.pid);
    const tokens = data.phrase.splice(0);
    if (!it) return;
    presence.message(this.world.slug);
    record({ ev: 'music', world: this.world.slug, pid: data.session.pid, location: this.room.id, instrument: it.instrument, tokens: tokens.length });
    void tryEthora('post music', () => this.ethora.narrate(this.room.id, musicLine(data.session.name, it.instrument, tokens)));
  }

  onAuth(_client: Client, options: JoinOptions) {
    const session = verifySession(options?.token ?? '');
    if (session.world !== this.state.world) throw new Error('session is for another world');
    return session;
  }

  onJoin(client: Client, options: JoinOptions, auth: Session) {
    const session = auth ?? (client.auth as Session);
    client.userData = { session, moving: false, gone: false, phrase: [], phraseTimer: null, lesson: null } satisfies UserData;
    const enterFrom = options.enterFrom && DIRECTIONS.includes(options.enterFrom) ? options.enterFrom : undefined;
    const [w, , d] = roomSize(this.room);
    const at = options.at;
    const pose = enterFrom
      ? entryPose(this.room, enterFrom, 1.8, (Math.random() - 0.5) * 1.2)
      : at && Number.isFinite(at.x) && Number.isFinite(at.z)
        ? { x: clamp(at.x, -w / 2 + 0.5, w / 2 - 0.5), y: 0, z: clamp(at.z, -d / 2 + 0.5, d / 2 - 0.5), rotY: Number.isFinite(at.ry) ? at.ry : 0 }
        : { ...spawnPose(this.room) };

    // One seat per player: a reload or a second tab makes a new seat while the old one waits to reconnect (or is
    // still connected). The newer seat takes over; the old one goes without "has left" and without revoking the chat.
    for (const [sid, other] of this.state.players.entries()) {
      if (other.id !== session.pid || sid === client.sessionId) continue;
      const stale = this.clients.find((c) => c.sessionId === sid);
      if (stale) stale.leave(CLOSE_REPLACED);
      else this.ghosts.get(sid)?.reject(new Error('replaced by a newer seat'));
    }

    const others = [...this.state.players.values()].map((o) => o.id);
    const p = new Player();
    p.id = session.pid; p.name = session.name; p.x = pose.x; p.y = pose.y; p.z = pose.z; p.ry = pose.rotY; p.anim = 'idle'; p.away = false;
    this.state.players.set(client.sessionId, p);
    // whatever they carry arrives with them (and shows in their hands once the items sync runs)
    this.sim.carry(session.pid, this.room.id);
    this.syncItems(this.sim.itemsIn(this.room.id));

    record({ ev: 'join', world: this.world.slug, pid: session.pid, location: this.room.id, from: enterFrom ?? null, with: others });
    presence.joined(this.world.slug, client.sessionId, this.room.id);
    client.send(MSG.ai, this.budget.snapshot(session.visitor) satisfies AiMessage);
    client.send(MSG.bandState, this.band.state());
    if (this.lessonDef) this.sendLesson(client, client.userData as UserData, null);
    const line = enterFrom ? `${session.name} has joined (${DIRECTION_LABEL[enterFrom]})` : at ? `${session.name} is back` : `${session.name} has arrived`;
    void tryEthora('narrate join', () => this.ethora.narrate(this.room.id, line));
    // a returning player hears the trainer pick up their plan instead of the room's greeting (not after a reload)
    const data = client.userData as UserData;
    setTimeout(() => { if (at || !this.lessonDef || !this.welcomeBack(data)) this.sim.playerEntered(this.room.id, session.name); }, 2500);
    this.log('join', data, { from: enterFrom ?? null, reload: Boolean(at), with: others.length });
    console.log(`[room ${this.room.id}] + ${session.name} (${client.sessionId})${enterFrom ? ' from ' + enterFrom : ''}`);
  }

  async onLeave(client: Client, code?: number) {
    const data = client.userData as UserData | undefined;
    const consented = code === 4000 || code === CLOSE_REPLACED;
    const p = this.state.players.get(client.sessionId);
    // A dropped connection (not a door, not a deliberate leave) may come back for a while; the avatar waits, marked away.
    if (!consented && data && !data.moving && p) {
      p.away = true;
      presence.setAway(this.world.slug, client.sessionId, true);
      try {
        const window = this.allowReconnection(client, RECONNECT_SECONDS);
        this.ghosts.set(client.sessionId, window);
        const back = await window;
        this.ghosts.delete(client.sessionId);
        back.userData = data;
        const again = this.state.players.get(client.sessionId);
        if (again) again.away = false;
        presence.setAway(this.world.slug, client.sessionId, false);
        console.log(`[room ${this.room.id}] ${data.session.name} reconnected`);
        return;
      } catch {
        this.ghosts.delete(client.sessionId);
        // the window expired, or a newer seat of the same player closed it
      }
    }
    const last = p ? { x: p.x, z: p.z } : null;
    this.state.players.delete(client.sessionId);
    presence.left(this.world.slug, client.sessionId);
    if (!data) return;
    this.flushPhrase(client);
    data.lesson?.stop();
    data.lesson = null;
    record({ ev: 'leave', world: this.world.slug, pid: data.session.pid, location: this.room.id, moving: data.moving });
    this.log('leave', data, { moving: data.moving, gone: data.gone, code: code ?? null });
    // The same person on another seat in this room (a reload, a second tab) keeps the chat membership and the narration quiet;
    // revoking here used to cut the chat of the live seat a minute after every reload.
    const stillHere = this.clients.some((c) => c !== client && (c.userData as UserData | undefined)?.session.uid === data.session.uid);
    if (!data.moving && !stillHere) {
      const line = data.gone ? `${data.session.name} has wandered off` : `${data.session.name} has left`;
      void tryEthora('narrate leave', () => this.ethora.narrate(this.room.id, line));
      void tryEthora('revoke on leave', () => this.ethora.revoke(this.room.id, data.session.uid));
      // an instrument does not leave the world with its player: it stays where they stood (a door takes it along)
      const dropped = this.sim.drop(data.session.pid, this.room.id, last?.x ?? 0, last?.z ?? 0);
      if (dropped) void tryEthora('narrate drop', () => this.ethora.narrate(this.room.id, `${data.session.name} left ${dropped.name} behind`));
    } else {
      // the seat is gone but the player is not: the item sync must stop pointing at this session
      this.syncItems(this.sim.itemsIn(this.room.id));
    }
    console.log(`[room ${this.room.id}] - ${data.session.name}${data.gone ? ' (wandered off)' : code === CLOSE_REPLACED ? ' (replaced)' : stillHere ? ' (still here on another seat)' : consented ? '' : ' (connection lost)'}`);
  }

  onDispose() {
    this.band.stop();
    this.unsubscribe?.();
    this.unsubscribeItems?.();
    this.unsubscribeBudget?.();
  }

  /** Mirrors the sim's items of this location; carried ones are tagged with the carrier's seat in this room. */
  private syncItems(items: ItemState[]) {
    const seen = new Set<string>();
    for (const it of items) {
      seen.add(it.id);
      let s = this.state.items.get(it.id);
      if (!s) {
        s = new Item();
        s.id = it.id; s.instrument = it.instrument; s.name = it.name;
        this.state.items.set(it.id, s);
      }
      let heldBy = '';
      if (it.heldBy) for (const [sid, p] of this.state.players.entries()) if (p.id === it.heldBy) heldBy = sid;
      s.heldBy = heldBy;
      s.x = it.x; s.y = it.y; s.z = it.z;
    }
    for (const id of [...this.state.items.keys()]) if (!seen.has(id)) this.state.items.delete(id);
  }

  private syncCharacters(chars: CharState[]) {
    const seen = new Set<string>();
    for (const c of chars) {
      seen.add(c.id);
      let ch = this.state.characters.get(c.id);
      if (!ch) {
        ch = new Character();
        ch.id = c.id; ch.name = c.name;
        this.state.characters.set(c.id, ch);
      }
      ch.x = c.x; ch.y = c.y; ch.z = c.z; ch.ry = c.ry; ch.anim = c.anim;
    }
    for (const id of [...this.state.characters.keys()]) if (!seen.has(id)) this.state.characters.delete(id);
  }

  private async handleMove(client: Client, msg: MoveMessage) {
    const data = client.userData as UserData | undefined;
    const dir = msg?.dir as Direction;
    if (!data || data.moving) return;
    if (!DIRECTIONS.includes(dir)) return client.send(MSG.denied, { reason: 'bad direction' });
    const target = this.room.exits[dir];
    if (!target) return client.send(MSG.denied, { reason: 'there is a wall there' });
    data.moving = true;
    const { uid, name } = data.session;
    const enterFrom = OPPOSITE[dir];
    this.log('move', data, { dir, to: target });

    // Chat side: the player must be able to read the next room before the client switches to it.
    await tryEthora('grant next room', () => this.ethora.grant(target, uid));
    void tryEthora('narrate leave', () => this.ethora.narrate(this.room.id, `${name} has left (${DIRECTION_LABEL[dir]})`));
    client.send(MSG.moved, { to: target, enterFrom } satisfies MovedMessage);
    // The old room's access is revoked after the client has had time to disconnect from it.
    setTimeout(() => void tryEthora('revoke old room', () => this.ethora.revoke(this.room.id, uid)), 3000);
  }
}

function spawnPose(room: WorldRoom) {
  const [x, y, z] = roomSpawn(room);
  return { x, y, z, rotY: 0 };
}
