// A thin client for the hosted Ethora MCP server, authenticated with a user API key (Bearer header).
// Tool results come back as JSON text `{ ok, data, ... }`; `call` returns `data`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const DEFAULT_MCP_URL = 'https://mcp.chat.ethora.com/mcp';

export interface EthoraToolResult {
  ok?: boolean;
  error?: string;
  code?: string;
  data?: unknown;
  [k: string]: unknown;
}

export class EthoraMcp {
  private constructor(private client: Client, private transport: StreamableHTTPClientTransport) {}

  static async connect(url: string, apiKey: string | undefined, name = 'bookworld-provisioner'): Promise<EthoraMcp> {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
    const client = new Client({ name, version: '0.1.0' });
    await client.connect(transport);
    return new EthoraMcp(client, transport);
  }

  /** Calls a tool and returns its `data`; throws with the server's message when the tool reports a failure. */
  async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string }[] | undefined)
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n') ?? '';
    let parsed: EthoraToolResult;
    try {
      parsed = JSON.parse(text) as EthoraToolResult;
    } catch {
      if (res.isError) throw new Error(`${name}: ${text.slice(0, 500)}`);
      return text as unknown as T;
    }
    if (res.isError || parsed.ok === false) {
      throw new Error(`${name}: ${parsed.error ?? text.slice(0, 500)}${parsed.code ? ` (${parsed.code})` : ''}`);
    }
    return (parsed.data ?? parsed) as T;
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

/** Finds the first value for any of the given keys anywhere inside a result object (ids live at different depths per tool). */
export function dig(obj: unknown, keys: string[], depth = 0): string | undefined {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
  }
  for (const v of Object.values(o)) {
    const found = dig(v, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}
