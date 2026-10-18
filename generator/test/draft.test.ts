import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAssets } from '../src/assets.ts';
import { draftToWorld, fixDashes, type Draft } from '../src/draft.ts';
import { splitChapters, stripGutenberg } from '../src/source.ts';

const assets = loadAssets();
const source = { title: 'Test Book', author: 'Nobody', license: 'public-domain' as const };

function draft(): Draft {
  return {
    title: 'A Test — World',
    start: 'cellar',
    rooms: [
      { id: 'cellar', name: 'The Cellar', description: 'Dark – and damp. A stair leads east.', grid: [0, 0], template: 'box', size: [10, 4, 10],
        palette: { wall: '#333', floor: '#222' }, wallpaper: 'brown_planks_07', floor: 'brown_mud_leaves_01', music: 'frost-waltz',
        props: [
          { id: 'bookcase', pos: [-3, 0, -4.8] },
          { id: 'teacup', pos: [0, 0.76, 0] },
          { id: 'rug', pos: [0, 0, 0] },
          { id: 'unicorn', pos: [1, 0, 1] },
          { id: 'chair', pos: [4.6, 0, 0.2] },
        ] },
      { id: 'Hall of Mirrors', name: 'The Hall', description: 'Mirrors. The cellar is west, the yard north.', grid: [1, 0], template: 'box', size: [12, 4, 8],
        palette: { wall: '#555', floor: '#444' }, props: [] },
      { id: 'yard', name: 'The Yard', description: 'Open sky. The hall is south.', grid: [1, -1], template: 'panorama', size: [16, 5, 16],
        palette: { wall: '#4f7a3a', floor: '#3b6b2a' }, panorama: 'nope', props: [] },
      { id: 'island', name: 'The Island', description: 'Unreachable by design.', grid: [2, 0], template: 'box', size: [8, 4, 8], palette: { wall: '#111', floor: '#000' }, props: [] },
    ],
    links: [['cellar', 'Hall of Mirrors'], ['Hall of Mirrors', 'yard'], ['cellar', 'yard']],
    characters: [
      { id: 'Keeper', name: 'Keeper', home: 'Hall of Mirrors', persona: 'You keep the hall — gruffly.', responseMode: 'smart', cooldownSec: 5, chapters: [1, 9], avatar: 'kaykit:Knight', pos: [0, 0, -2], wander: 0.5,
        schedule: [{ at: '*/30 * * * *', do: 'move', to: 'yard' }, { at: 'bad cron', do: 'say', text: 'x' }] },
    ],
    scripts: [{ id: 'keeper-greets', room: 'Hall of Mirrors', trigger: { onEnter: true }, lines: [{ who: 'Keeper', text: 'Welcome, {player} — mind the glass.' }, { who: 'ghost', text: 'boo' }] }],
  };
}

test('draftToWorld: grid links become symmetric exits, ids become slugs, unreachable rooms get linked', () => {
  const { world, warnings, errors } = draftToWorld(draft(), { assets, source, chapters: [1, 2, 3] });
  assert.deepEqual(errors, []);
  const byId = Object.fromEntries(world.rooms.map((r) => [r.id, r]));
  assert.equal(byId['cellar']!.exits.e, 'hall-of-mirrors');
  assert.equal(byId['hall-of-mirrors']!.exits.w, 'cellar');
  assert.equal(byId['hall-of-mirrors']!.exits.n, 'yard');
  assert.equal(byId['yard']!.exits.s, 'hall-of-mirrors');
  // cellar (0,0) and yard (1,-1) are diagonal: dropped
  assert.ok(warnings.some((w) => /not adjacent/.test(w)));
  // island (2,0) was unreachable and sits next to the hall (1,0): auto-linked
  assert.equal(byId['hall-of-mirrors']!.exits.e, 'island');
  assert.ok(warnings.some((w) => /island was unreachable/.test(w)));
  assert.equal(world.slug, 'a-test-world');
  assert.equal(world.title, 'A Test - World');
});

test('draftToWorld: assets resolve to files, unknown ones degrade with warnings', () => {
  const { world, warnings } = draftToWorld(draft(), { assets, source, chapters: [1, 2, 3] });
  const cellar = world.rooms[0]!;
  assert.equal(cellar.wallpaper, 'assets/textures/brown_planks_07.jpg');
  assert.equal(cellar.floor, 'assets/textures/brown_mud_leaves_01.jpg');
  assert.equal(cellar.music?.title, 'Frost Waltz');
  assert.match(cellar.music!.credit!, /Kevin MacLeod/);
  const yard = world.rooms.find((r) => r.id === 'yard')!;
  assert.equal(yard.scene?.template, 'panorama');
  assert.equal(yard.scene?.panorama, 'assets/panoramas/borghese_gardens_2k.hdr');
  assert.ok(warnings.some((w) => /unknown panorama "nope"/.test(w)));
  assert.equal(yard.wallpaper, null);
});

test('draftToWorld: props are checked against the catalog, tagged and kept out of doorways', () => {
  const { world, warnings } = draftToWorld(draft(), { assets, source, chapters: [1, 2, 3] });
  const props = world.rooms[0]!.scene!.props!;
  const ids = props.map((p) => p.id);
  assert.ok(!ids.includes('unicorn'));
  assert.ok(warnings.some((w) => /unknown prop "unicorn"/.test(w)));
  assert.equal(props.find((p) => p.id === 'teacup')?.onTop, true);
  assert.equal(props.find((p) => p.id === 'rug')?.flat, true);
  assert.equal(props.find((p) => p.id === 'rug')?.pos[1], 0.01);
  // the chair stood in the east doorway (exit to the hall)
  assert.ok(!ids.includes('chair'));
  assert.ok(warnings.some((w) => /"chair".*blocked a doorway/.test(w)));
  assert.ok(ids.includes('bookcase'));
});

test('draftToWorld: characters and scripts are cleaned up and the cost rules enforced', () => {
  const { world, warnings, errors } = draftToWorld(draft(), { assets, source, chapters: [1, 2, 3] });
  assert.deepEqual(errors, []);
  const keeper = world.characters[0]!;
  assert.equal(keeper.id, 'keeper');
  assert.equal(keeper.home, 'hall-of-mirrors');
  assert.equal(keeper.cooldownSec, 20);
  assert.equal(keeper.responseMode, 'smart');
  assert.deepEqual(keeper.knowledgeTags, ['a-test-world-ch1']);
  assert.equal(keeper.persona, 'You keep the hall - gruffly.');
  assert.deepEqual(keeper.schedule, [{ at: '*/30 * * * *', do: 'move', to: 'yard' }]);
  assert.ok(warnings.some((w) => /bad cron/.test(w)));
  const script = world.scripts![0]!;
  assert.equal(script.room, 'hall-of-mirrors');
  assert.equal(script.lines.length, 1);
  assert.equal(script.lines[0]!.text, 'Welcome, {player} - mind the glass.');
  assert.equal(script.cooldownSec, 180);
});

test('fixDashes', () => {
  assert.equal(fixDashes('a — b'), 'a - b');
  assert.equal(fixDashes('a—b'), 'a - b');
  assert.equal(fixDashes('1865–1870'), '1865-1870');
  assert.equal(fixDashes('tea – cake'), 'tea - cake');
});

test('source: Gutenberg wrapper is stripped and chapters split; a table of contents is ignored', () => {
  const raw = [
    'The Project Gutenberg eBook of X', 'Title: X', '', '*** START OF THE PROJECT GUTENBERG EBOOK X ***', '',
    'CONTENTS', 'CHAPTER I. Down', 'CHAPTER II. Pool', '',
    'CHAPTER I.', 'Down the Rabbit-Hole', '', 'x'.repeat(700), '',
    'CHAPTER II.', 'The Pool of Tears', '', 'y'.repeat(700), '',
    'CHAPTER III.', 'A Caucus-Race', '', 'z'.repeat(700), '',
    '*** END OF THE PROJECT GUTENBERG EBOOK X ***', 'licence text',
  ].join('\n');
  const text = stripGutenberg(raw);
  assert.ok(!text.includes('licence text'));
  assert.ok(!text.includes('Title: X'));
  const ch = splitChapters(text);
  assert.equal(ch.length, 3);
  assert.equal(ch[0]!.title, 'CHAPTER I. Down the Rabbit-Hole');
  assert.equal(ch[2]!.index, 3);
});
