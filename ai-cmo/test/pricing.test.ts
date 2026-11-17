import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageMeter, formatUsage } from "../src/pricing.ts";

test("cost is summed per response at the serving model's prices", () => {
  const meter = new UsageMeter();
  // Opus 5.5: $4 input, $5 cache write (1.25x), $0.20 cache read, $20 output per million tokens.
  meter.add("claude-opus-5-5", { input_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 1_000_000, output_tokens: 50_000, server_tool_use: { web_search_requests: 3 } });
  // 0.40 input + 1.00 cache write + 0.20 cache read + 1.00 output
  assert.equal(meter.total().costUsd, 2.6);

  // A turn served by a fallback model is priced as that model: Sonnet 5.5 at $2 / $10.
  meter.add("claude-sonnet-5-5", { input_tokens: 500_000, output_tokens: 100_000, cache_read_input_tokens: null });
  const total = meter.total();
  // plus 1.00 input + 1.00 output on Sonnet
  assert.equal(total.costUsd, 4.6);
  assert.deepEqual(total.models, ["claude-opus-5-5", "claude-sonnet-5-5"]);
  assert.deepEqual([total.inputTokens, total.cacheWriteTokens, total.cacheReadTokens, total.outputTokens, total.webSearches], [600_000, 200_000, 1_000_000, 150_000, 3]);
  assert.equal(formatUsage(total), "about $4.60: 600k input, 200k cache write, 1000k cache read, 150k output tokens, 3 web search(es) not included");
});

test("model names resolve to the right price, and an unknown model gives no cost", () => {
  const cost = (model: string) => {
    const meter = new UsageMeter();
    meter.add(model, { input_tokens: 1_000_000 });
    return meter.total().costUsd;
  };
  assert.equal(cost("claude-opus-5-5"), 4);
  assert.equal(cost("claude-opus-5"), 5, "not confused with opus-5-5");
  assert.equal(cost("claude-opus-5-20260301"), 5, "dated snapshot");
  assert.equal(cost("claude-haiku-5-5"), 0.1);
  assert.equal(cost("some-future-model"), null);

  // Once any turn has no known price, the total stays unknown; tokens are still counted.
  const meter = new UsageMeter();
  meter.add("some-future-model", { input_tokens: 10, output_tokens: 5 });
  meter.add("claude-opus-5-5", { input_tokens: 10 });
  assert.equal(meter.total().costUsd, null);
  assert.equal(meter.total().inputTokens, 20);
  assert.match(formatUsage(meter.total()), /^cost unknown/);
});
