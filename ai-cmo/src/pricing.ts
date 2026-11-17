/**
 * Token accounting and a cost estimate for one agent run.
 *
 * Prices are Anthropic's list prices per million tokens at the time of writing, kept here because
 * the API reports tokens, not money. The estimate leaves out per-search fees for web search, and
 * the invoice in the Anthropic console is the figure that counts.
 */

export interface Usage {
  /** Input tokens billed at the full rate (not read from or written to the cache). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  /** Every model that served a turn; a fallback model can appear next to the configured one. */
  models: string[];
  /** Estimated cost in US dollars, or null when a model's price is not known here. */
  costUsd: number | null;
}

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

/** USD per million tokens. Matched by prefix, so dated snapshots of a model resolve too. */
const PRICES: Record<string, Price> = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Writing to the 5-minute cache costs 1.25 times the input price. */
const CACHE_WRITE_MULTIPLIER = 1.25;

function priceFor(model: string): Price | undefined {
  // Longest key first, so "claude-opus-5-5" is not priced as "claude-opus-5".
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  return key ? PRICES[key] : undefined;
}

/** What one API response reports; a subset of the SDK's usage object. */
export interface ResponseUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export class UsageMeter {
  private readonly usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, models: [], costUsd: 0 };

  /** Adds one response, priced by the model that actually served it. */
  add(model: string, u: ResponseUsage): void {
    const input = u.input_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    this.usage.inputTokens += input;
    this.usage.outputTokens += output;
    this.usage.cacheReadTokens += cacheRead;
    this.usage.cacheWriteTokens += cacheWrite;
    this.usage.webSearches += u.server_tool_use?.web_search_requests ?? 0;
    if (!this.usage.models.includes(model)) this.usage.models.push(model);

    const price = priceFor(model);
    if (!price) this.usage.costUsd = null;
    else if (this.usage.costUsd !== null) {
      this.usage.costUsd += (input * price.input + cacheWrite * price.input * CACHE_WRITE_MULTIPLIER + cacheRead * price.cacheRead + output * price.output) / 1_000_000;
    }
  }

  total(): Usage {
    return { ...this.usage, models: [...this.usage.models], costUsd: this.usage.costUsd === null ? null : Math.round(this.usage.costUsd * 10_000) / 10_000 };
  }
}

export function formatUsage(u: Usage): string {
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const cost = u.costUsd === null ? "cost unknown (no price for this model)" : `about $${u.costUsd.toFixed(2)}`;
  const searches = u.webSearches ? `, ${u.webSearches} web search(es) not included` : "";
  return `${cost}: ${k(u.inputTokens)} input, ${k(u.cacheWriteTokens)} cache write, ${k(u.cacheReadTokens)} cache read, ${k(u.outputTokens)} output tokens${searches}`;
}
