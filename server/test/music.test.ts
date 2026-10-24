import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, parseMusicLine, musicLine, validToken, noteHz, validateWorld } from '@bookworld/shared';

test('chord names parse to roots and intervals', () => {
  assert.deepEqual(parseChord('C'), { name: 'C', root: 0, intervals: [0, 4, 7] });
  assert.deepEqual(parseChord('Am'), { name: 'Am', root: 9, intervals: [0, 3, 7] });
  assert.deepEqual(parseChord('F#m7'), { name: 'F#m7', root: 6, intervals: [0, 3, 7, 10] });
  assert.deepEqual(parseChord('Bb'), { name: 'Bb', root: 10, intervals: [0, 4, 7] });
  assert.equal(parseChord('G7/B')?.root, 7);
  assert.equal(parseChord('hello'), null);
  assert.equal(parseChord('H'), null);
  assert.equal(parseChord('Cxyz'), null);
});

test('middle C is 261.6 Hz', () => {
  assert.ok(Math.abs(noteHz(48) - 261.63) < 0.1);
});

test('drum hits are tokens for the drums only', () => {
  assert.equal(validToken('drums', 'kick'), true);
  assert.equal(validToken('drums', 'C'), false);
  assert.equal(validToken('guitar', 'kick'), false);
  assert.equal(validToken('bass', 'Em'), true);
});

test('a music line round-trips', () => {
  const line = musicLine('Taras', 'guitar', ['C', 'G', 'Am', 'F']);
  assert.equal(line, '♪ Taras (guitar): C G Am F');
  assert.deepEqual(parseMusicLine(line), { who: 'Taras', instrument: 'guitar', tokens: ['C', 'G', 'Am', 'F'] });
  assert.deepEqual(parseMusicLine(musicLine('Mina', 'bass', ['E', 'A'])), { who: 'Mina', instrument: 'bass', tokens: ['E', 'A'] });
});

test('an agent reply with prose around the line is understood', () => {
  const body = 'Ha! Let me join thee.\n♪ Merlin (piano): Am F C G, Am F E7 Am\nThere, a tune for the churchyard.';
  assert.deepEqual(parseMusicLine(body), { who: 'Merlin', instrument: 'piano', tokens: ['Am', 'F', 'C', 'G', 'Am', 'F', 'E7', 'Am'] });
  assert.deepEqual(parseMusicLine('♪ drums: kick hat snare hat'), { who: null, instrument: 'drums', tokens: ['kick', 'hat', 'snare', 'hat'] });
  assert.deepEqual(parseMusicLine('**♪ Ariel (guitar): D A Bm G.**')?.tokens, ['D', 'A', 'Bm', 'G']);
  assert.equal(parseMusicLine('No music here, just ♪ and words'), null);
  assert.equal(parseMusicLine('♪ Ariel (guitar): la la la'), null);
});

test('world items are validated', () => {
  const world = {
    schema: 'bookworld/0', slug: 'w', title: 'W', source: { title: 'W', author: 'A', license: 'original' }, start: 'a',
    rooms: [{ id: 'a', name: 'A', description: '', exits: { n: null, e: null, s: null, w: null } }], characters: [],
    items: [{ id: 'guitar', kind: 'instrument', instrument: 'guitar', room: 'a' }, { id: 'bad', kind: 'instrument', instrument: 'harp', room: 'zzz' }],
  };
  const errors = validateWorld(world);
  assert.ok(errors.some((e) => e.includes('unknown instrument')));
  assert.ok(errors.some((e) => e.includes('room zzz')));
  assert.equal(errors.filter((e) => e.includes('guitar')).length, 0);
});
