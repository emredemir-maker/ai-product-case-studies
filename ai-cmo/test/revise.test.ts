import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { BrandSchema } from "../src/brand.ts";
import { DraftStore } from "../src/drafts.ts";
import { RecommendationStore } from "../src/recommendations.ts";
import { RunStore } from "../src/review.ts";
import { editDraft, reviseDraft, undoDraftChange } from "../src/revise.ts";
import { discoverSkills } from "../src/skills.ts";
import { createUiServer } from "../src/ui.ts";
import { future, startServer, tmpDir } from "./helpers.ts";

const brand = BrandSchema.parse({ name: "Clyro Labs", description: "d", language: "Türkçe", audience: "a", voice: { tone: "t" } });
const LONG = "8.024 müşteri talebini analiz ettik.\n\nKaynak: halka açık 8.024 talep.\n\nBu hafta yapılacak tek iş: 20 talebi açın.\n\nclyrolabs.com/cx?ref=linkedin";

const message = (content: unknown[], stop_reason: string) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
const revision = (content: string) => message([{ type: "tool_use", id: "t1", name: "save_revision", input: { content } }], "tool_use");

function setup(apiUrl: string) {
  const dir = tmpDir();
  const drafts = new DraftStore(path.join(dir, "drafts.json"));
  const deps = {
    config: { model: "claude-opus-5-5", effort: "high" as const, webSearch: true },
    brand,
    skills: discoverSkills(path.resolve(import.meta.dirname, "..", "skills")),
    drafts,
    postiz: null,
    client: new Anthropic({ apiKey: "test", baseURL: apiUrl, maxRetries: 0 }),
  };
  return { dir, drafts, deps };
}

test("a revision replaces the post's text, keeps the old one, and can be undone", async () => {
  const api = await startServer((req) => {
    if (req.body.messages.length > 1) return [200, message([{ type: "text", text: "Tamam." }], "end_turn")];
    const asked: string = req.body.messages[0].content;
    return [200, revision(asked.includes("Change the post") ? "8.024 talebi analiz ettik." : "  8.024 talebi analiz ettik. clyrolabs.com/cx?ref=linkedin  ")];
  });
  const { drafts, deps } = setup(api.url);
  const draft = drafts.create({ platform: "linkedin", content: LONG, scheduledAt: future(), rationale: "Açılış", visual: { kind: "statement", headline: "h" } });

  const { draft: revised, usage } = await reviseDraft(deps, draft.id, "shorten");
  assert.equal(revised.content, "8.024 talebi analiz ettik. clyrolabs.com/cx?ref=linkedin");
  assert.equal(revised.previousContent, LONG);
  assert.deepEqual(revised.visual, draft.visual, "the image is left as it was");
  assert.equal(usage.inputTokens, 2);

  const request = api.requests[0]!.body;
  assert.match(request.messages[0].content, /Task: Shorten the post to roughly half its length/);
  assert.match(request.messages[0].content, new RegExp(`The post as it stands \\(${LONG.length} characters\\)`));
  assert.match(request.messages[0].content, /Why the post was written: Açılış/);
  assert.match(request.system, /every fact, number, name, date and link in the revision must already be in the post/);
  assert.match(request.system, /Write the post in Türkçe/);
  assert.deepEqual(request.tools.map((t: { name: string }) => t.name), ["save_revision"], "no web search, no other tools");

  // Undo swaps the two texts; a second undo brings the revision back.
  assert.equal(undoDraftChange(drafts, draft.id).content, LONG);
  assert.equal(undoDraftChange(drafts, draft.id).content, revised.content);

  await reviseDraft(deps, draft.id, "change", "  Son cümleyi çıkarın  ");
  const change = api.requests.at(-2)!.body.messages[0].content;
  assert.match(change, /Task: Change the post as the founder asks below/);
  assert.match(change, /The founder's request: Son cümleyi çıkarın\n/);
  await api.close();
});

test("a revision that cannot be used leaves the post untouched", async () => {
  let reply: unknown = message([{ type: "text", text: "Hangi kısmı?" }], "end_turn");
  const api = await startServer((req) => (req.body.messages.length > 1 ? [200, message([{ type: "text", text: "." }], "end_turn")] : [200, reply]));
  const { drafts, deps } = setup(api.url);
  const draft = drafts.create({ platform: "linkedin", content: LONG, scheduledAt: future(), rationale: "r" });

  await assert.rejects(reviseDraft(deps, draft.id, "change"), /Say what should change/);
  await assert.rejects(reviseDraft(deps, draft.id, "change", "   "), /Say what should change/);
  assert.equal(api.requests.length, 0);
  await assert.rejects(reviseDraft(deps, draft.id, "clarify"), /The post was not revised\. Hangi kısmı\?/);
  reply = revision(LONG);
  await assert.rejects(reviseDraft(deps, draft.id, "clarify"), /identical/);
  assert.equal(drafts.get(draft.id).content, LONG);
  assert.equal(drafts.get(draft.id).previousContent, undefined);
  assert.throws(() => undoDraftChange(drafts, draft.id), /no earlier version/);

  drafts.update(draft.id, { status: "shared" });
  await assert.rejects(reviseDraft(deps, draft.id, "shorten"), /is shared, not pending/);
  assert.throws(() => editDraft(drafts, draft.id, "x"), /is shared, not pending/);
  await api.close();
});

test("the interface edits, revises and undoes a post's text", async () => {
  const { dir, drafts } = setup("http://127.0.0.1:1");
  const staticDir = path.join(dir, "dist");
  fs.mkdirSync(staticDir);
  fs.writeFileSync(path.join(staticDir, "index.html"), "ok");
  const draft = drafts.create({ platform: "linkedin", content: LONG, scheduledAt: future(), rationale: "r" });
  const calls: unknown[] = [];
  const server = createUiServer({
    staticDir,
    drafts,
    recommendations: new RecommendationStore(path.join(dir, "recommendations.json")),
    runs: new RunStore(path.join(dir, "runs.json")),
    postiz: null,
    site: null,
    revise: async (id, mode, instruction) => {
      calls.push([id, mode, instruction]);
      drafts.update(id, { content: "Kısa hali", previousContent: drafts.get(id).content });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (url: string, body: unknown) => fetch(base + url, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const current = async () => (await (await fetch(base + "/api/state")).json()).drafts[0];

  assert.equal((await (await fetch(base + "/api/state")).json()).canRevise, true);

  assert.equal((await post(`/api/drafts/${draft.id}/edit`, { content: "  Elle yazdım  " })).status, 200);
  assert.deepEqual([(await current()).content, (await current()).previousContent], ["Elle yazdım", LONG]);
  assert.equal((await post(`/api/drafts/${draft.id}/edit`, { content: "   " })).status, 400);
  assert.equal((await post(`/api/drafts/${draft.id}/edit`, {})).status, 400);

  assert.equal((await post(`/api/drafts/${draft.id}/undo`, {})).status, 200);
  assert.equal((await current()).content, LONG);

  assert.equal((await post(`/api/drafts/${draft.id}/revise`, { mode: "change", instruction: "Daha kısa" })).status, 200);
  assert.deepEqual(calls, [[draft.id, "change", "Daha kısa"]]);
  assert.equal((await current()).content, "Kısa hali");
  assert.equal((await post(`/api/drafts/${draft.id}/revise`, { mode: "translate" })).status, 400);
  assert.equal(calls.length, 1);
  await new Promise((resolve) => server.close(resolve));
});
