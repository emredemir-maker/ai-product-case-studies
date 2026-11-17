import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { BrandSchema } from "../src/brand.ts";
import { DraftStore } from "../src/drafts.ts";
import { RecommendationStore } from "../src/recommendations.ts";
import { type ReviewDeps, RunStore, WatchSchema, runReview } from "../src/review.ts";
import { SnapshotStore } from "../src/site.ts";
import { discoverSkills } from "../src/skills.ts";
import { createUiServer } from "../src/ui.ts";
import { fakeSite, future, startServer, tmpDir } from "./helpers.ts";

const brand = BrandSchema.parse({ name: "Acme", description: "Analytics", audience: "PMs", voice: { tone: "Direct" } });

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

test("a review crawls the site, lets the agent read a page, and records recommendations and the run", async () => {
  const site = await fakeSite();
  const api = await startServer((req) => {
    if (req.body.messages.length > 1) return [200, message([{ type: "text", text: "Pricing has no description. Fix that first." }], "end_turn")];
    return [
      200,
      message(
        [
          { type: "tool_use", id: "t1", name: "fetch_page", input: { url: "/pricing" } },
          { type: "tool_use", id: "t2", name: "fetch_page", input: { url: "https://evil.test/secret" } },
          {
            type: "tool_use",
            id: "t3",
            name: "save_recommendation",
            input: { area: "seo", priority: "high", title: "Add a meta description to /pricing", why: "It has none.", action: 'Use: "Free plan, Pro at $20."', evidence: [`${site.url}/pricing`], agent_prompt: "In the app repository, add a meta description to the pricing page." },
          },
          { type: "tool_use", id: "t4", name: "save_draft", input: { platform: "linkedin", content: "We shipped invites.", scheduled_at: future(), rationale: "New feature" } },
        ],
        "tool_use",
      ),
    ];
  });

  const dir = tmpDir();
  const deps: ReviewDeps = {
    config: { model: "claude-opus-5-5", effort: "high", webSearch: false },
    brand,
    skills: discoverSkills(path.resolve(import.meta.dirname, "..", "skills")),
    drafts: new DraftStore(path.join(dir, "drafts.json")),
    postiz: null,
    client: new Anthropic({ apiKey: "test", baseURL: api.url, maxRetries: 0 }),
    watch: WatchSchema.parse({
      site: { url: site.url },
      repos: [{ name: "app", path: path.join(dir, "no-such-repo") }],
      sources: [
        { type: "geo-optimizer", command: [process.execPath, "-e", 'console.log(JSON.stringify({ score: 41, band: "foundation", recommendations: ["Create /llms.txt"] }))'] },
        { type: "command", name: "Visibility", command: ["no-such-program-xyz"] },
      ],
    }),
    recommendations: new RecommendationStore(path.join(dir, "recommendations.json")),
    snapshots: new SnapshotStore(path.join(dir, "snapshots")),
    runs: new RunStore(path.join(dir, "runs.json")),
  };

  const run = await runReview(deps);

  assert.equal(run.summary, "Pricing has no description. Fix that first.");
  assert.equal(run.pagesChecked, 2);
  assert.match(run.problems[0]!, /Could not read commits from app/);
  assert.match(run.problems[1]!, /Visibility did not run: "no-such-program-xyz" is not installed/);
  assert.deepEqual(run.sources[0], { name: "GEO Optimizer audit", ok: true, score: 41, band: "foundation", recommendations: ["Create /llms.txt"] });
  assert.equal(run.sources[1]!.ok, false);
  const [rec] = deps.recommendations.list("open");
  assert.equal(rec!.title, "Add a meta description to /pricing");
  assert.equal(rec!.agentPrompt, "In the app repository, add a meta description to the pricing page.");
  assert.equal(deps.recommendations.get(rec!.id).id, rec!.id);
  assert.deepEqual(run.recommendationIds, [rec!.id]);
  assert.deepEqual(run.draftIds, deps.drafts.list("pending").map((d) => d.id));
  assert.deepEqual(deps.runs.latest(), run);
  assert.equal(deps.snapshots.latest()!.takenAt, run.at);

  const [first, second] = api.requests;
  const input: string = first!.body.messages[0].content;
  assert.match(input, /Sitemap: found, 2 URLs\./);
  assert.match(input, /## Report: GEO Optimizer audit\n\{"score":41/);
  assert.doesNotMatch(input, /## Report: Visibility/);
  assert.match(input, /This is the first review/);
  assert.match(input, /Problems gathering data\n- Could not read commits from app/);
  assert.match(first!.body.system, /growth lead for Acme/);
  assert.match(first!.body.system, /- plg-review: /);
  assert.match(first!.body.system, /Write every recommendation field \(title, why, action, agent_prompt\), every post and your closing note in English/);
  assert.equal(first!.body.stream, true);
  assert.equal(first!.body.max_tokens, 64000);
  assert.equal(run.complete, true);
  const saveTool = first!.body.tools.find((t: { name: string }) => t.name === "save_recommendation");
  assert.ok("agent_prompt" in saveTool.input_schema.properties);
  assert.equal(saveTool.input_schema.required.includes("agent_prompt"), false);

  const results: { tool_use_id: string; content: unknown }[] = second!.body.messages[2].content;
  const text = (id: string) => JSON.stringify(results.find((r) => r.tool_use_id === id)!.content);
  assert.match(text("t1"), /HTTP 200.*Free plan and Pro at \$20/);
  assert.match(text("t2"), /only pages on http:\/\/127\.0\.0\.1/);

  await site.close();
  await api.close();
});

test("a review cut off at the length limit saves nothing from that turn and keeps the old baseline", async () => {
  const site = await fakeSite();
  const api = await startServer(() => [
    200,
    message(
      [{ type: "tool_use", id: "t1", name: "save_recommendation", input: { area: "seo", priority: "high", title: "Half-written", why: "w", action: "a", evidence: [] } }],
      "max_tokens",
    ),
  ]);
  const dir = tmpDir();
  const activity: string[] = [];
  const deps: ReviewDeps = {
    config: { model: "claude-opus-5-5", effort: "high", webSearch: false },
    brand,
    skills: [],
    drafts: new DraftStore(path.join(dir, "drafts.json")),
    postiz: null,
    client: new Anthropic({ apiKey: "test", baseURL: api.url, maxRetries: 0 }),
    watch: WatchSchema.parse({ site: { url: site.url } }),
    recommendations: new RecommendationStore(path.join(dir, "recommendations.json")),
    snapshots: new SnapshotStore(path.join(dir, "snapshots")),
    runs: new RunStore(path.join(dir, "runs.json")),
    onActivity: (line) => activity.push(line),
  };

  const run = await runReview(deps);

  assert.equal(api.requests.length, 1, "the loop stops; the cut-off turn is not continued");
  assert.equal(run.complete, false);
  assert.match(run.problems[0]!, /cut off at the response length limit/);
  assert.deepEqual(deps.recommendations.list(), []);
  assert.deepEqual(activity, [], "calls that never ran are not reported as done");
  assert.equal(deps.snapshots.latest(), null, "no new baseline");
  assert.equal(deps.runs.latest()!.complete, false);
  assert.equal(deps.runs.latestComplete(), undefined);
  await site.close();
  await api.close();
});

test("the interface serves state, applies decisions, and refuses writes from other origins", async () => {
  const dir = tmpDir();
  const recommendations = new RecommendationStore(path.join(dir, "recommendations.json"));
  const drafts = new DraftStore(path.join(dir, "drafts.json"));
  const rec = recommendations.create({ area: "geo", priority: "medium", title: "Add llms.txt", why: "w", action: "a", evidence: [] });
  const draft = drafts.create({ platform: "x", content: "Hi", scheduledAt: future(), rationale: "r" });
  let reviews = 0;
  const staticDir = path.join(dir, "dist");
  fs.mkdirSync(path.join(staticDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(staticDir, "index.html"), "<title>Growth desk</title>");
  fs.writeFileSync(path.join(staticDir, "assets", "app-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, "secret.json"), "{}");
  assert.throws(() => createUiServer({ staticDir: path.join(dir, "missing") } as never), /not built.*npm run build:ui/s);
  const server = createUiServer({
    staticDir,
    drafts,
    recommendations,
    runs: new RunStore(path.join(dir, "runs.json")),
    postiz: null,
    site: "https://acme.test",
    review: async () => {
      reviews++;
      throw new Error("crawl failed");
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (url: string, body: unknown, headers: Record<string, string> = { Origin: base, "Content-Type": "application/json" }) =>
    fetch(base + url, { method: "POST", headers, body: JSON.stringify(body) });

  const html = await fetch(base + "/");
  assert.match(html.headers.get("content-type")!, /text\/html/);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.match(await html.text(), /<title>Growth desk<\/title>/);
  const asset = await fetch(base + "/assets/app-abc123.js");
  assert.match(asset.headers.get("content-type")!, /text\/javascript/);
  assert.match(asset.headers.get("cache-control")!, /immutable/);
  assert.equal(await asset.text(), "console.log(1)");
  // Only files inside the built folder are served.
  for (const escape of ["/%2e%2e/secret.json", "/..%2fsecret.json", "/assets/../../secret.json", "/assets/missing.js", "/assets"]) {
    assert.equal((await fetch(base + escape)).status, 404, escape);
  }

  const state = await (await fetch(base + "/api/state")).json();
  assert.equal(state.canPublish, false);
  assert.equal(state.recommendations[0].id, rec.id);

  // Another site in the browser, a form post, and a rebound hostname are all refused.
  assert.equal((await post(`/api/recommendations/${rec.id}`, { status: "done" }, { Origin: "https://evil.test", "Content-Type": "application/json" })).status, 403);
  assert.equal((await post(`/api/recommendations/${rec.id}`, { status: "done" }, { Origin: base, "Content-Type": "text/plain" })).status, 403);
  assert.equal((await post(`/api/recommendations/${rec.id}`, { status: "done" }, { "Content-Type": "application/json" })).status, 403);
  const rebound = await new Promise<number>((resolve) =>
    http.get(base + "/api/state", { headers: { Host: "evil.test" } }, (res) => resolve(res.statusCode!)).on("error", () => resolve(0)),
  );
  assert.equal(rebound, 403);
  assert.equal(recommendations.list("open").length, 1);

  assert.equal((await post(`/api/recommendations/${rec.id}`, { status: "dismissed", reason: "Not now" })).status, 200);
  assert.equal(recommendations.list("dismissed")[0]!.dismissReason, "Not now");
  assert.equal((await post(`/api/recommendations/${rec.id}`, { status: "bogus" })).status, 400);

  const refused = await post(`/api/drafts/${draft.id}/approve`, {});
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /Postiz is not configured/);
  assert.equal((await post(`/api/drafts/${draft.id}/reject`, { reason: "Too short" })).status, 200);
  assert.equal(drafts.get(draft.id).rejectionReason, "Too short");
  // A post shared by hand is recorded once and cannot be decided again.
  const byHand = drafts.create({ platform: "linkedin", content: "Hello", scheduledAt: future(), rationale: "r" });
  assert.equal((await post(`/api/drafts/${byHand.id}/shared`, {})).status, 200);
  assert.equal(drafts.get(byHand.id).status, "shared");
  assert.ok(drafts.get(byHand.id).decidedAt);
  assert.equal((await post(`/api/drafts/${byHand.id}/shared`, {})).status, 400);
  assert.equal((await post(`/api/drafts/${byHand.id}/reject`, {})).status, 400);

  const started = await (await post("/api/review", {})).json();
  assert.equal(started.review.running, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = await (await fetch(base + "/api/state")).json();
  assert.deepEqual(after.review, { running: false, error: "crawl failed" });
  assert.equal(reviews, 1);
  await new Promise((resolve) => server.close(resolve));
});
