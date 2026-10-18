// A stand-in for the hosted Ethora MCP server: the same tool names and result shapes (as observed on
// 17 Oct 2026), fake ids, and a record of every call so tests can check what the provisioner asked for.
import { createServer, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export interface MockCall { name: string; args: Record<string, unknown> }

export interface MockEthora {
  url: string;
  calls: MockCall[];
  close(): Promise<void>;
}

let counter = 0x1000;
const hex24 = () => (0x6ad3db00ca753490abdaaa00 + counter++).toString(16).padStart(24, '0').slice(-24);

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, ts: new Date().toISOString(), meta: { tool: 'mock' }, data }) }] };
}

function buildServer(calls: MockCall[], expectKey: string | undefined, authHeader: string | undefined) {
  const s = new McpServer({ name: 'mock-ethora', version: '0.0.0' });
  const guard = () => {
    if (expectKey && authHeader !== `Bearer ${expectKey}`) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'not logged in', code: 'UNAUTHORIZED' }) }] };
    }
    return null;
  };
  const tool = (name: string, shape: z.ZodRawShape, handler: (args: Record<string, unknown>) => unknown) => {
    s.registerTool(name, { inputSchema: shape }, async (args: Record<string, unknown>) => {
      const denied = guard();
      if (denied) return denied;
      calls.push({ name, args });
      return ok(handler(args));
    });
  };
  tool('ethora-app-create', { displayName: z.string() }, (a) => ({ app: { _id: hex24(), displayName: a.displayName } }));
  tool('ethora-app-select', { appId: z.string() }, (a) => ({ currentAppId: a.appId }));
  tool('ethora-chat-create', { appId: z.string().optional(), title: z.string(), pinned: z.boolean().optional() }, (a) => {
    const id = hex24();
    const jid = `${a.appId}_${id}`;
    return { result: { title: a.title, jid, pinned: false }, created: { kind: 'room', id, jid, name: a.title } };
  });
  tool('ethora-agent-create', {
    appId: z.string().optional(), name: z.string(), botDisplayName: z.string().optional(), summary: z.string().optional(), prompt: z.string().optional(),
    responseMode: z.string().optional(), cooldownSec: z.number().optional(), isRAG: z.boolean().optional(), categories: z.array(z.string()).optional(), visibility: z.string().optional(),
  }, (a) => ({ ok: true, agent: { id: hex24(), address: '0x' + hex24() + hex24().slice(0, 16), displayName: a.name, responseMode: a.responseMode } }));
  tool('ethora-agent-visibility-set', { agentId: z.string(), visibility: z.string() }, (a) => ({ ok: true, agent: { id: a.agentId, visibility: a.visibility } }));
  tool('ethora-agent-invite', { agentId: z.string(), chatJid: z.string() }, (a) => ({ ok: true, created: true, agent: { id: a.agentId }, botInstance: { _id: hex24(), joinedRooms: [a.chatJid] } }));
  tool('ethora-source-doc-upload', {
    appId: z.string().optional(), agentId: z.string().optional(),
    files: z.array(z.object({ name: z.string(), mimeType: z.string(), base64: z.string() })),
  }, (a) => ({ result: (a.files as { name: string }[]).map((f) => ({ id: hex24(), url: f.name })) }));
  tool('ethora-message-send', { roomJid: z.string().optional(), text: z.string(), waitForReplySec: z.number().optional() }, (a) => ({
    posted: true, replies: [{ from: 'agent', text: `(mock reply to "${String(a.text).slice(0, 30)}")` }],
  }));
  return s;
}

/** Starts the mock on an ephemeral port. `expectKey` makes it demand `Authorization: Bearer <key>`. */
export async function startMockEthora(expectKey?: string): Promise<MockEthora> {
  const calls: MockCall[] = [];
  const http: Server = createServer(async (req, res) => {
    if (!req.url?.startsWith('/mcp')) { res.statusCode = 404; res.end(); return; }
    const server = buildServer(calls, expectKey, req.headers.authorization);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () => new Promise((r) => http.close(() => r())),
  };
}
