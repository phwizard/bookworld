import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSong, songLines, songChords, sameChords, progression, lyricSimilarity, LYRIC_PASS, songToChordPro, validateSong, validateWorld, firstWords, speechLang, chordKey, parseMelody, melodyBeats, noteMidi } from '@bookworld/shared';

const waterIsWide = readFileSync(new URL('../../worlds/songbook/songs/the-water-is-wide.cho', import.meta.url), 'utf8');

test('a ChordPro file parses into sections, lines, chords and words', () => {
  const song = parseSong(waterIsWide, 'the-water-is-wide');
  assert.equal(song.title, 'The Water Is Wide');
  assert.equal(song.key, 'G');
  assert.equal(song.license, 'public-domain');
  assert.equal(song.sections.length, 3);
  assert.equal(song.sections[0]!.name, 'Verse 1');
  const lines = songLines(song);
  assert.equal(lines.length, 12);
  assert.deepEqual(lines[0]!.chords, ['G', 'C', 'G', 'D']);
  assert.equal(lines[0]!.lyric, "The water is wide, I cannot get o'er");
  assert.equal(lines[4]!.first, true);
  assert.equal(lines[5]!.first, false);
  assert.deepEqual(songChords(song), ['G', 'C', 'D', 'Em']);
  assert.deepEqual(validateSong(song), []);
});

test('chords written over the words parse too', () => {
  const text = [
    'Title: Clementine',
    'Artist: Percy Montrose',
    '',
    '[Verse 1]',
    'C                  G7            C             G7',
    'In a cavern, in a canyon, excavating for a mine',
    'C                     F               G7            C',
    'Dwelt a miner, forty-niner, and his daughter Clementine',
    '',
    'Chorus:',
    'C      G7     C        G7',
    'Oh my darling, oh my darling, oh my darling Clementine',
    'C   G7  C',
    '',
  ].join('\n');
  const song = parseSong(text, 'clementine');
  assert.equal(song.title, 'Clementine');
  assert.equal(song.artist, 'Percy Montrose');
  assert.deepEqual(song.sections.map((s) => s.name), ['Verse 1', 'Chorus']);
  const lines = songLines(song);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0]!.chords, ['C', 'G7', 'C', 'G7']);
  assert.equal(lines[1]!.lyric, 'Dwelt a miner, forty-niner, and his daughter Clementine');
  assert.equal(lines[2]!.section, 'Chorus');
  assert.equal(lines[3]!.lyric, '');
  assert.deepEqual(lines[3]!.chords, ['C', 'G7', 'C']);
});

test('the ChordPro writer round-trips', () => {
  const song = parseSong(waterIsWide, 'the-water-is-wide');
  const again = parseSong(songToChordPro(song), 'the-water-is-wide');
  assert.deepEqual(songLines(again).map((l) => [l.chords, l.lyric]), songLines(song).map((l) => [l.chords, l.lyric]));
  assert.equal(again.title, song.title);
});

test('a played progression is compared with repeats collapsed and names normalised', () => {
  assert.deepEqual(progression(['G', 'G', 'C', 'C', 'G', 'D', 'D']), ['G', 'C', 'G', 'D']);
  assert.equal(sameChords(['G', 'C', 'G', 'D'], ['G', 'G', 'C', 'Gmaj', 'D']), true);
  assert.equal(sameChords(['G', 'C', 'G', 'D'], ['G', 'C', 'D']), false);
  assert.equal(sameChords(['C', 'G7'], ['C', 'G']), false);
  assert.equal(sameChords(['Em', 'C'], ['Emin', 'C']), true);
});

test('typed words pass on a close match and fail on a wrong line', () => {
  const line = "Neither have I wings to fly";
  assert.ok(lyricSimilarity(line, 'neither have i wings to fly') >= LYRIC_PASS);
  assert.ok(lyricSimilarity(line, 'Neither have I wings to fly!') >= LYRIC_PASS);
  assert.ok(lyricSimilarity(line, 'niether have i wings to fly') >= LYRIC_PASS);
  assert.ok(lyricSimilarity(line, 'Give me a boat that will carry two') < LYRIC_PASS);
  assert.ok(lyricSimilarity(line, '') < LYRIC_PASS);
  assert.equal(firstWords(line, 2), 'Neither have');
});

test('a world may name a practice room with a trainer', () => {
  const base = {
    schema: 'bookworld/0', slug: 'w', title: 'W', source: { title: 'W', author: 'A', license: 'original' }, start: 'a',
    rooms: [{ id: 'a', name: 'A', description: '', exits: { n: null, e: null, s: null, w: null } }],
    characters: [{ id: 'rosie', name: 'Rosie', home: 'a', persona: 'x', responseMode: 'mentioned', cooldownSec: 20 }],
  };
  assert.deepEqual(validateWorld({ ...base, lessons: [{ room: 'a', trainer: 'rosie' }] }), []);
  const errors = validateWorld({ ...base, lessons: [{ room: 'b', trainer: 'nobody', instrument: 'harp' }] });
  assert.equal(errors.length, 3);
});

test('a song in Ukrainian: Cyrillic words, H for B, the language tag, and lenient matching', () => {
  const text = [
    '{title: Ой у лузі червона калина}',
    '{language: uk}',
    '{license: public-domain}',
    '',
    '[Am]Ой у лузі червона ка[Dm]лина похили[E]лася,',
    '[Am]Чогось наша славна Укра[Dm]їна зажури[H7]лася.',
  ].join('\n');
  const song = parseSong(text, 'kalyna');
  assert.equal(song.lang, 'uk');
  assert.equal(speechLang(song.lang), 'uk-UA');
  assert.equal(speechLang('Russian'), 'ru-RU');
  assert.equal(speechLang(undefined), 'en-US');
  assert.equal(speechLang('pt-br'), 'pt-BR');
  const lines = songLines(song);
  assert.deepEqual(lines[1]!.chords, ['Am', 'Dm', 'H7']);
  assert.equal(chordKey('H7'), chordKey('B7'));
  assert.ok(lyricSimilarity(lines[0]!.lyric, 'ой у лузі червона калина похилилася') >= LYRIC_PASS);
  assert.ok(lyricSimilarity('Ёлка горит', 'елка горит') >= LYRIC_PASS);
  assert.deepEqual(validateSong(song), []);
  assert.match(songToChordPro(song), /\{language: uk\}/);
});

test('a melody line is read against its words and round-trips', () => {
  const text = readFileSync(new URL('../../worlds/songbook/songs/clementine.cho', import.meta.url), 'utf8');
  const song = parseSong(text, 'clementine');
  const lines = songLines(song);
  assert.ok(lines[0]!.melody, 'verse 1 line 1 has a melody');
  const words = parseMelody(lines[0]!.melody!, lines[0]!.lyric);
  assert.equal(words.length, 10);
  assert.deepEqual(words[2], { word: 'cavern', notes: [{ midi: 60, beats: 1 }, { midi: 55, beats: 1.5 }] });
  assert.equal(melodyBeats(words), 14);
  assert.deepEqual(validateSong(song), []);
  assert.match(songToChordPro(song), /\{melody: C4:1 C4:0\.5/);
  assert.equal(noteMidi('F#4'), 66);
  assert.equal(noteMidi('Bb3'), 58);
  assert.equal(noteMidi('H3'), 59);
  assert.throws(() => parseMelody('C4:1 C4:1', 'three little words'), /2 groups for 3 words/);
  assert.throws(() => parseMelody('C4:1 X4:1', 'two words'), /unknown note "X4"/);
  const bad = parseSong('{title: T}\n{melody: C4:1}\n[C]two words\n', 't');
  assert.match(validateSong(bad)[0]!, /line 1: melody has 1 groups for 2 words/);
});
