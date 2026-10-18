// Two ways to ask a model for the draft: the Anthropic API (ANTHROPIC_API_KEY) or the Claude Code CLI
// on this machine (`claude -p`, uses the signed-in account). Both return the parsed JSON object.
import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

export type Backend = 'anthropic' | 'claude-cli';

export interface JsonRequest {
  system: string;
  /** conversation so far: the book prompt, then (on repair) the previous answer and the problems */
  messages: { role: 'user' | 'assistant'; content: string }[];
  schema: Record<string, unknown>;
  toolName: string;
  model?: string;
}

export const DEFAULT_MODEL = process.env.GENERATOR_MODEL ?? 'claude-opus-5-5';

export function pickBackend(requested?: string): Backend {
  if (requested === 'anthropic' || requested === 'claude-cli') return requested;
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'claude-cli';
}

export interface Completion {
  value: unknown;
  /** dollars, as reported by the CLI or estimated from tokens for the API */
  usd: number;
}

export async function completeJson(req: JsonRequest, backend: Backend, log: (s: string) => void = () => {}): Promise<Completion> {
  return backend === 'anthropic' ? viaApi(req, log) : viaCli(req, log);
}

/** "<usd per million input tokens>,<output>" from GENERATOR_USD_PER_MTOK; a rough figure for the budget ledger. */
function priceEstimate(inputTokens: number, outputTokens: number): number {
  const [i, o] = (process.env.GENERATOR_USD_PER_MTOK ?? '15,75').split(',').map(Number);
  return (inputTokens * (i || 15) + outputTokens * (o || 75)) / 1_000_000;
}

async function viaApi(req: JsonRequest, log: (s: string) => void): Promise<Completion> {
  const client = new Anthropic();
  const model = req.model ?? DEFAULT_MODEL;
  log(`asking ${model} through the Anthropic API`);
  const stream = client.messages.stream({
    model,
    max_tokens: 32000,
    system: req.system,
    messages: req.messages,
    tools: [{ name: req.toolName, description: 'Emit the finished world draft.', input_schema: req.schema as Anthropic.Tool.InputSchema }],
    tool_choice: { type: 'tool', name: req.toolName },
  });
  const msg = await stream.finalMessage();
  log(`tokens: ${msg.usage.input_tokens} in, ${msg.usage.output_tokens} out`);
  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('the model did not call the tool');
  const usd = priceEstimate(msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0), msg.usage.output_tokens);
  log(`estimated cost: $${usd.toFixed(2)}`);
  return { value: block.input, usd };
}

async function viaCli(req: JsonRequest, log: (s: string) => void): Promise<Completion> {
  // The CLI takes one prompt; fold the conversation into it.
  const prompt = req.messages.map((m) => (m.role === 'user' ? m.content : `YOUR PREVIOUS ANSWER:\n${m.content}`)).join('\n\n');
  const args = ['-p', 'Answer with the JSON object only.', '--output-format', 'json', '--tools', '', '--system-prompt', req.system, '--json-schema', JSON.stringify(req.schema)];
  if (req.model) args.push('--model', req.model);
  log(`asking the Claude Code CLI${req.model ? ` (${req.model})` : ''}`);
  const env = { ...process.env };
  delete env.CLAUDECODE; // the CLI refuses to start inside another Claude Code session otherwise
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn('claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => reject(new Error(`cannot run claude: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude exited with ${code}: ${stderr.slice(0, 2000)}`))));
    child.stdin.end(prompt);
  });
  let envelope: { is_error?: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } };
  try {
    envelope = JSON.parse(out);
  } catch {
    throw new Error(`claude output was not JSON: ${out.slice(0, 500)}`);
  }
  if (envelope.is_error) throw new Error(`claude reported an error: ${envelope.result}`);
  const usd = envelope.total_cost_usd ?? 0;
  if (envelope.total_cost_usd !== undefined) log(`cost: $${usd.toFixed(2)}`);
  if (envelope.structured_output !== undefined) return { value: envelope.structured_output, usd };
  const text = (envelope.result ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last < 0) throw new Error(`no JSON object in the answer: ${text.slice(0, 300)}`);
  return { value: JSON.parse(text.slice(first, last + 1)), usd };
}
