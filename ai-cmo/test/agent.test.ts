import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { type AgentDeps, buildSystemPrompt, buildTools, runAgent } from "../src/agent.ts";
import { BrandSchema } from "../src/brand.ts";
import { DraftStore } from "../src/drafts.ts";
import { PostizClient } from "../src/postiz.ts";
import { discoverSkills } from "../src/skills.ts";
import { fakePostiz, future, startServer, tmpDir } from "./helpers.ts";

const brand = BrandSchema.parse({
  name: "Acme",
  description: "Analytics",
  audience: "PMs",
  voice: { tone: "Direct", dont: ["Hype"] },
});
// Only the skills shipped in this repo, so results don't depend on `npm run skills:install`.
const skills = discoverSkills(path.resolve(import.meta.dirname, "..", "skills")).filter(
  (s) => !s.file.includes(`${path.sep}vendor${path.sep}`),
);

const deps = (extra: Partial<AgentDeps> = {}): AgentDeps => ({
  config: { model: "claude-opus-5-5", effort: "high", webSearch: false },
  brand,
  skills,
  drafts: new DraftStore(path.join(tmpDir(), "drafts.json")),
  postiz: null,
  ...extra,
});

const tool = (d: AgentDeps, name: string) => buildTools(d).find((t) => t.name === name)!;
const run = async (d: AgentDeps, name: string, input: unknown) => (await tool(d, name).run(input as never)) as string;

test("system prompt carries the brand, the skill index and no timestamp", () => {
  const prompt = buildSystemPrompt(brand, skills);
  assert.match(prompt, /marketing lead for Acme/);
  assert.match(prompt, /- social-post: /);
  assert.equal(prompt, buildSystemPrompt(brand, skills));
  assert.doesNotMatch(prompt, /\d{4}-\d{2}-\d{2}T/);
});

test("the agent has no tool that publishes", () => {
  assert.deepEqual(
    buildTools(deps()).map((t) => t.name),
    ["list_channels", "get_channel_rules", "load_skill", "list_drafts", "save_draft"],
  );
});

test("save_draft stores a pending draft and rejects past dates", async () => {
  const d = deps();
  const input = { platform: "LinkedIn", content: "Hello", scheduled_at: future(), rationale: "r" };

  assert.match(await run(d, "save_draft", { ...input, scheduled_at: future(-2) }), /^Error: .*in the past/);
  assert.equal(d.drafts.list().length, 0);

  const { id } = JSON.parse(await run(d, "save_draft", input));
  const saved = d.drafts.get(id);
  assert.equal(saved.status, "pending");
  assert.equal(saved.platform, "linkedin");
});

test("save_draft enforces the connected channel's length limit", async () => {
  const server = await fakePostiz(20);
  const d = deps({ postiz: new PostizClient(`${server.url}/public/v1`, "test-key") });
  const input = { platform: "linkedin", channel_id: "ch1", scheduled_at: future(), rationale: "r" };

  assert.match(await run(d, "save_draft", { ...input, content: "x".repeat(21) }), /21 characters; the limit for this channel is 20/);
  assert.match(await run(d, "save_draft", { ...input, channel_id: "nope", content: "ok" }), /not a connected channel/);
  assert.equal(d.drafts.list().length, 0);

  JSON.parse(await run(d, "save_draft", { ...input, content: "x".repeat(20) }));
  assert.equal(d.drafts.list()[0]!.integrationId, "ch1");
  assert.match(await run(d, "list_channels", {}), /"platform":"linkedin"/);
  await server.close();
});

test("list_drafts shows rejection reasons; load_skill returns the body or names the options", async () => {
  const d = deps();
  const draft = d.drafts.create({ platform: "x", content: "Buy now", scheduledAt: future(), rationale: "r" });
  d.drafts.update(draft.id, { status: "rejected", rejectionReason: "too pushy" });

  assert.match(await run(d, "list_drafts", { status: "rejected" }), /"rejectionReason":"too pushy"/);
  assert.equal(await run(d, "list_drafts", { status: "pending" }), "The queue is empty.");
  assert.match(await run(d, "load_skill", { name: "social-post" }), /^# Social post/);
  assert.match(await run(d, "load_skill", { name: "../../etc/passwd" }), /Unknown skill .* Available: content-calendar, social-post/);
});

test("runAgent drives the tool loop against the Messages API and saves the draft", async () => {
  const message = (content: unknown[], stop_reason: string) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const api = await startServer((req) => {
    const turns = req.body.messages.length;
    if (turns === 1) {
      return [
        200,
        message(
          [{ type: "tool_use", id: "toolu_1", name: "save_draft", input: { platform: "linkedin", content: "Post body", scheduled_at: future(), rationale: "why" } }],
          "tool_use",
        ),
      ];
    }
    return [200, message([{ type: "text", text: "Saved one draft." }], "end_turn")];
  });

  const activity: string[] = [];
  const d = deps({ client: new Anthropic({ apiKey: "test", baseURL: api.url, maxRetries: 0 }), onActivity: (l) => activity.push(l) });
  const result = await runAgent("One LinkedIn post about funnels", d);

  assert.equal(result.text, "Saved one draft.");
  assert.equal(result.stopReason, "end_turn");
  assert.deepEqual(activity, ["save_draft (linkedin)"]);
  assert.deepEqual(d.drafts.list().map((x) => x.id), result.draftIds);
  assert.equal(d.drafts.list()[0]!.content, "Post body");

  const [first, second] = api.requests;
  assert.match(first!.url, /^\/v1\/messages/);
  assert.equal(first!.body.model, "claude-opus-5-5");
  assert.deepEqual(first!.body.output_config, { effort: "high" });
  assert.equal(first!.body.fallbacks, "default");
  assert.match(String(first!.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.match(first!.body.messages[0].content, /Brief: One LinkedIn post about funnels/);
  assert.deepEqual(first!.body.tools.map((t: { name: string }) => t.name).sort(), ["get_channel_rules", "list_channels", "list_drafts", "load_skill", "save_draft"]);
  // Second request carries the full history, with the tool result reporting the saved draft.
  const toolResult = second!.body.messages[2].content[0];
  assert.equal(toolResult.type, "tool_result");
  assert.match(JSON.stringify(toolResult.content), new RegExp(result.draftIds[0]!));
  await api.close();
});
