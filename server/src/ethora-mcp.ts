// The hosted Ethora MCP as a client, authenticated with a user API key. The world service uses it for the
// few things the app's server token is not allowed to do (ETHORA-GAPS #14, #17): changing an agent's
// response mode. Optional: without ETHORA_API_KEY those features degrade to client-side behaviour.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.ETHORA_MCP_URL ?? 'https://mcp.chat.ethora.com/mcp';
const apiKey = process.env.ETHORA_API_KEY;

export const ethoraMcpAvailable = Boolean(apiKey);

/** Runs `fn` with a connected MCP client and closes it afterwards. */
export async function withEthoraMcp<T>(fn: (call: (name: string, args: Record<string, unknown>) => Promise<unknown>) => Promise<T>): Promise<T> {
  if (!apiKey) throw new Error('ETHORA_API_KEY is not set');
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } });
  const client = new Client({ name: 'bookworld-world-service', version: '0.1.0' });
  await client.connect(transport);
  try {
    return await fn(async (name, args) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as { type: string; text?: string }[] | undefined)?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n') ?? '';
      let parsed: { ok?: boolean; error?: string; code?: string; data?: unknown } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      if (res.isError || parsed.ok === false) throw new Error(`${name}: ${parsed.error ?? text.slice(0, 300)}${parsed.code ? ` (${parsed.code})` : ''}`);
      return parsed.data ?? parsed;
    });
  } finally {
    await transport.close().catch(() => undefined);
  }
}
