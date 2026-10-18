import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionWorld } from '../src/provision.ts';
import { repoRoot } from '../src/paths.ts';
import { startMockEthora } from './mock-ethora-mcp.ts';

function aliceCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bookworld-alice-'));
  const world = JSON.parse(readFileSync(join(repoRoot(), 'worlds', 'alice', 'world.json'), 'utf8'));
  // a tag with no knowledge file on purpose: it must be skipped with a warning, not fail
  world.characters[0].knowledgeTags = ['alice-ch7', 'alice-nowhere'];
  writeFileSync(join(dir, 'world.json'), JSON.stringify(world));
  mkdirSync(join(dir, 'knowledge'));
  writeFileSync(join(dir, 'knowledge', 'alice-ch7.txt'), 'CHAPTER VII. A Mad Tea-Party\n\nThere was a table set out under a tree...\n');
  return dir;
}

test('provision: creates app, rooms, agent, knowledge and invite; writes ethora.json; reruns are no-ops', async () => {
  const mock = await startMockEthora('test-key');
  const dir = aliceCopy();
  const logs: string[] = [];
  try {
    const ids = await provisionWorld({ dir, mcpUrl: mock.url, apiKey: 'test-key', knowledge: 'files', log: (s) => logs.push(s) });
    assert.match(ids.appId!, /^[0-9a-f]{24}$/);
    assert.equal(Object.keys(ids.rooms).length, 4);
    for (const r of Object.values(ids.rooms)) assert.equal(r.jid, `${ids.appId}_${r.chatId}`);
    const hatter = ids.agents['hatter']!;
    assert.match(hatter.agentId, /^[0-9a-f]{24}$/);
    assert.equal(hatter.home, 'tea-party');
    assert.equal(hatter.visibility, 'unlisted');
    assert.equal(hatter.invited, true);
    assert.match(hatter.botInstanceId!, /^[0-9a-f]{24}$/);
    assert.deepEqual(hatter.knowledge, ['alice-ch7']);

    const names = mock.calls.map((c) => c.name);
    assert.deepEqual(names.filter((n) => n === 'ethora-chat-create').length, 4);
    assert.deepEqual(names.filter((n) => n === 'ethora-agent-create').length, 1);
    const create = mock.calls.find((c) => c.name === 'ethora-agent-create')!.args;
    assert.equal(create.responseMode, 'mentioned');
    assert.equal(create.cooldownSec, 30);
    assert.equal(create.isRAG, true);
    assert.match(String(create.prompt), /Use plain hyphens, never long dashes/);
    const invite = mock.calls.find((c) => c.name === 'ethora-agent-invite')!.args;
    assert.equal(invite.chatJid, ids.rooms['tea-party']!.jid);
    const upload = mock.calls.find((c) => c.name === 'ethora-source-doc-upload')!.args as { files: { name: string; base64: string }[] };
    assert.equal(upload.files[0]!.name, 'alice-ch7.txt');
    assert.match(Buffer.from(upload.files[0]!.base64, 'base64').toString(), /Mad Tea-Party/);
    assert.ok(logs.some((l) => /knowledge file for alice-nowhere not found/.test(l)));

    const written = JSON.parse(readFileSync(join(dir, 'ethora.json'), 'utf8'));
    assert.equal(written.appId, ids.appId);

    // second run: nothing left to do, no calls
    const before = mock.calls.length;
    const again = await provisionWorld({ dir, mcpUrl: mock.url, apiKey: 'test-key', knowledge: 'files', log: (s) => logs.push(s) });
    assert.equal(again.appId, ids.appId);
    assert.equal(mock.calls.length, before);
    assert.ok(logs.some((l) => /nothing to do/.test(l)));
  } finally {
    await mock.close();
  }
});

test('provision: a Gutenberg source is crawled from its URL, once per agent, with the re-crawl switched off', async () => {
  const mock = await startMockEthora();
  const dir = aliceCopy();
  const logs: string[] = [];
  try {
    const ids = await provisionWorld({ dir, mcpUrl: mock.url, log: (s) => logs.push(s) });
    assert.deepEqual(ids.agents['hatter']!.knowledge, ['gutenberg:11']);
    const crawl = mock.calls.filter((c) => c.name === 'ethora-source-site-crawl');
    assert.equal(crawl.length, 1);
    assert.equal(crawl[0]!.args.url, 'https://www.gutenberg.org/cache/epub/11/pg11.txt');
    assert.equal(crawl[0]!.args.agentId, ids.agents['hatter']!.agentId);
    assert.equal(mock.calls.filter((c) => c.name === 'ethora-source-doc-upload').length, 0);
    const watch = mock.calls.find((c) => c.name === 'ethora-source-site-watch-update')!;
    assert.equal(watch.args.schedule, 'off');
    const before = mock.calls.length;
    await provisionWorld({ dir, mcpUrl: mock.url, log: (s) => logs.push(s) });
    assert.equal(mock.calls.length, before);
  } finally {
    await mock.close();
  }
});

test('provision: a wrong key is reported as the server says it', async () => {
  const mock = await startMockEthora('right-key');
  const dir = aliceCopy();
  try {
    await assert.rejects(
      provisionWorld({ dir, mcpUrl: mock.url, apiKey: 'wrong-key', log: () => {} }),
      /ethora-app-create: not logged in \(UNAUTHORIZED\)/,
    );
  } finally {
    await mock.close();
  }
});

test('provision: dry run touches nothing', async () => {
  const mock = await startMockEthora();
  const dir = aliceCopy();
  const logs: string[] = [];
  try {
    await provisionWorld({ dir, mcpUrl: mock.url, dryRun: true, log: (s) => logs.push(s) });
    assert.equal(mock.calls.length, 0);
    assert.ok(logs.some((l) => /create app "Bookworld Alice's Adventures in Wonderland"/.test(l)));
    assert.ok(logs.some((l) => /create room "The Tea Party"/.test(l)));
  } finally {
    await mock.close();
  }
});
