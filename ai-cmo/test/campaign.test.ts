import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { BrandSchema } from "../src/brand.ts";
import { type CampaignDeps, CampaignStore, listMaterials, runCampaign } from "../src/campaign.ts";
import { DraftStore } from "../src/drafts.ts";
import { RecommendationStore } from "../src/recommendations.ts";
import { RunStore } from "../src/review.ts";
import { discoverSkills } from "../src/skills.ts";
import { createUiServer } from "../src/ui.ts";
import { future, startServer, tmpDir } from "./helpers.ts";

const brand = BrandSchema.parse({ name: "Acme", description: "Analytics", language: "Türkçe", audience: "PMs", voice: { tone: "Direct" } });

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

function setup(api: { url: string }) {
  const dir = tmpDir();
  const materialsDir = path.join(dir, "materials");
  fs.mkdirSync(materialsDir);
  fs.writeFileSync(path.join(materialsDir, "raporlama.pdf"), "%PDF-1.4 fake");
  fs.writeFileSync(path.join(materialsDir, "notlar.md"), "# Notlar\nKök neden raporu haftalık gelir.");
  fs.writeFileSync(path.join(materialsDir, "sunum.pptx"), "not readable");
  fs.mkdirSync(path.join(materialsDir, "eski"));
  const deps: CampaignDeps = {
    config: { model: "claude-opus-5-5", effort: "high", webSearch: false },
    brand,
    skills: discoverSkills(path.resolve(import.meta.dirname, "..", "skills")),
    drafts: new DraftStore(path.join(dir, "drafts.json")),
    postiz: null,
    client: new Anthropic({ apiKey: "test", baseURL: api.url, maxRetries: 0 }),
    campaigns: new CampaignStore(path.join(dir, "campaigns.json")),
    recommendations: new RecommendationStore(path.join(dir, "recommendations.json")),
    materialsDir,
    siteOrigin: null,
  };
  return { dir, deps };
}

test("materials are the readable files directly in the folder", () => {
  const api = { url: "http://127.0.0.1:1" };
  const { deps } = setup(api);
  assert.deepEqual(
    listMaterials(deps.materialsDir).map((m) => [m.name, m.kind]),
    [
      ["notlar.md", "text"],
      ["raporlama.pdf", "pdf"],
    ],
  );
  assert.deepEqual(listMaterials(path.join(deps.materialsDir, "missing")), []);
});

test("a campaign is defined once, reads its materials, and files posts and site tasks under itself", async () => {
  const api = await startServer((req) => {
    const turn = req.body.messages.length;
    if (turn === 1) {
      return [
        200,
        message(
          [
            { type: "tool_use", id: "t0", name: "save_draft", input: { platform: "linkedin", content: "Too early", scheduled_at: future(), rationale: "r" } },
            { type: "tool_use", id: "t1", name: "read_material", input: { name: "raporlama.pdf" } },
            { type: "tool_use", id: "t2", name: "read_material", input: { name: "notlar.md" } },
            { type: "tool_use", id: "t3", name: "read_material", input: { name: "../../etc/passwd" } },
          ],
          "tool_use",
        ),
      ];
    }
    if (turn === 3) {
      const plan = { name: "Katalog serisi", goal: "10 ücretsiz analiz talebi", message: "Neden olduğunu söyler", starts_on: "2026-12-07", ends_on: "2026-12-20", phases: [{ title: "Açılış", from: "2026-12-07", to: "2026-12-13", focus: "Raporlama kataloğu" }] };
      return [
        200,
        message(
          [
            { type: "tool_use", id: "t4", name: "define_campaign", input: plan },
            { type: "tool_use", id: "t5", name: "define_campaign", input: plan },
          ],
          "tool_use",
        ),
      ];
    }
    if (turn === 5) {
      return [
        200,
        message(
          [
            { type: "tool_use", id: "t6", name: "save_draft", input: { platform: "linkedin", content: "Raporlama kataloğu yayında.", scheduled_at: future(48), rationale: "Açılış", attachment: "raporlama.pdf" } },
            { type: "tool_use", id: "t7", name: "save_draft", input: { platform: "linkedin", content: "x", scheduled_at: future(72), rationale: "r", attachment: "sunum.pptx" } },
            { type: "tool_use", id: "t8", name: "save_recommendation", input: { area: "content", priority: "high", title: "Katalog indirme sayfası aç", why: "w", action: "a", evidence: [] } },
          ],
          "tool_use",
        ),
      ];
    }
    return [200, message([{ type: "text", text: "İki haftalık plan hazır." }], "end_turn")];
  });
  const { deps } = setup(api);

  const campaign = await runCampaign({ brief: "Raporlama kataloğunu iki haftada duyur.", startsOn: "2026-12-07", weeks: 2, materials: ["raporlama.pdf", "notlar.md"] }, deps);

  assert.equal(campaign.name, "Katalog serisi");
  assert.equal(campaign.summary, "İki haftalık plan hazır.");
  assert.equal(campaign.complete, true);
  assert.deepEqual(campaign.materials, ["raporlama.pdf", "notlar.md"]);
  assert.equal(campaign.usage!.inputTokens, 4);
  assert.equal(deps.campaigns.list().length, 1, "a second define_campaign does not create another");

  // Only the post saved after the campaign was defined, with a valid attachment, exists.
  const drafts = deps.drafts.list();
  assert.deepEqual(drafts.map((d) => [d.content, d.campaignId, d.attachment]), [["Raporlama kataloğu yayında.", campaign.id, "raporlama.pdf"]]);
  assert.deepEqual(campaign.draftIds, [drafts[0]!.id]);
  const [task] = deps.recommendations.list();
  assert.equal(task!.campaignId, campaign.id);
  assert.deepEqual(campaign.recommendationIds, [task!.id]);

  const [first, second, third, fourth] = api.requests;
  assert.match(first!.body.system, /Write the campaign definition, every post, every recommendation and your closing note in Türkçe/);
  assert.match(first!.body.system, /- campaign-plan: /);
  assert.match(first!.body.messages[0].content, /Window: 2 week\(s\), from 2026-12-07 to 2026-12-20\./);
  assert.match(first!.body.messages[0].content, /- raporlama\.pdf \(pdf, 1 KB\)/);
  assert.equal(first!.body.tools.some((t: { name: string }) => t.name === "fetch_page"), false, "no site configured");

  const results = (request: typeof first) => Object.fromEntries((request!.body.messages.at(-1).content as { tool_use_id: string; content: unknown }[]).map((r) => [r.tool_use_id, r.content]));
  const r1 = results(second);
  assert.match(JSON.stringify(r1.t0), /call define_campaign before saving posts/);
  assert.deepEqual((r1.t1 as { type: string; title: string; source: { media_type: string; data: string } }[])[0], {
    type: "document",
    title: "raporlama.pdf",
    source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.4 fake").toString("base64") },
  });
  assert.match(JSON.stringify(r1.t2), /Kök neden raporu haftalık gelir/);
  assert.match(JSON.stringify(r1.t3), /is not one of this campaign's materials/);
  assert.match(JSON.stringify(results(third).t5), /already defined/);
  assert.match(JSON.stringify(results(fourth).t7), /is not one of the available materials/);
  await api.close();
});

test("planning rejects unknown materials and a run that never defines a campaign", async () => {
  const api = await startServer(() => [200, message([{ type: "text", text: "Hangi ürün için?" }], "end_turn")]);
  const { deps } = setup(api);
  const input = { brief: "Bir kampanya planla lütfen.", startsOn: "2026-12-07", weeks: 2 };

  await assert.rejects(runCampaign({ ...input, materials: ["yok.pdf"] }, deps), /Not in the materials folder: yok\.pdf/);
  await assert.rejects(runCampaign({ ...input, materials: ["sunum.pptx"] }, deps), /Not in the materials folder/);
  await assert.rejects(runCampaign({ ...input, brief: "kısa" }, deps), /at least a sentence/);
  assert.equal(api.requests.length, 0, "nothing is sent for invalid input");

  await assert.rejects(runCampaign(input, deps), /did not define a campaign\. Its reply: Hangi ürün için\?/);
  assert.deepEqual(deps.campaigns.list(), []);
  await api.close();
});

test("the interface lists materials and campaigns, starts planning, and archives", async () => {
  const { dir, deps } = setup({ url: "http://127.0.0.1:1" });
  const staticDir = path.join(dir, "dist");
  fs.mkdirSync(staticDir);
  fs.writeFileSync(path.join(staticDir, "index.html"), "ok");
  const existing = deps.campaigns.create({ status: "active", name: "Eski", brief: "b", goal: "g", message: "m", startsOn: "2026-11-01", endsOn: "2026-11-14", phases: [], materials: [], summary: "", draftIds: [], recommendationIds: [], complete: true });
  const received: unknown[] = [];
  let finish!: () => void;
  const server = createUiServer({
    staticDir,
    drafts: deps.drafts,
    recommendations: deps.recommendations,
    runs: new RunStore(path.join(dir, "runs.json")),
    postiz: null,
    site: null,
    campaigns: {
      store: deps.campaigns,
      materialsDir: deps.materialsDir,
      plan: (input) => {
        received.push(input);
        return new Promise((_, reject) => (finish = () => reject(new Error("no API key"))));
      },
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (url: string, body: unknown) => fetch(base + url, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const state = await (await fetch(base + "/api/state")).json();
  assert.equal(state.canPlan, true);
  assert.deepEqual(state.materials.map((m: { name: string }) => m.name), ["notlar.md", "raporlama.pdf"]);
  assert.equal(state.campaigns[0].id, existing.id);

  const bad = await post("/api/campaigns", { brief: "kısa", startsOn: "2026-12-07", weeks: 2 });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /at least a sentence/);
  assert.equal(received.length, 0);

  const input = { brief: "Raporlama kataloğunu duyur.", startsOn: "2026-12-07", weeks: 2, materials: ["raporlama.pdf"] };
  const started = await (await post("/api/campaigns", input)).json();
  assert.equal(started.planning.running, true);
  assert.deepEqual(received, [input]);
  assert.equal((await post("/api/campaigns", input)).status, 409, "one at a time");

  finish();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual((await (await fetch(base + "/api/state")).json()).planning, { running: false, error: "no API key" });

  assert.equal((await post(`/api/campaigns/${existing.id}`, { status: "archived" })).status, 200);
  assert.equal(deps.campaigns.list()[0]!.status, "archived");
  assert.equal((await post(`/api/campaigns/${existing.id}`, { status: "deleted" })).status, 400);

  // Deleting takes the campaign and what nobody acted on; what went out or was done stays, untied.
  const mk = (content: string, campaignId: string) => deps.drafts.create({ platform: "linkedin", content, scheduledAt: "2026-12-08T09:00:00Z", rationale: "r", campaignId });
  const waiting = mk("bekleyen", existing.id);
  const shared = mk("paylaşılan", existing.id);
  deps.drafts.update(shared.id, { status: "shared" });
  const other = mk("başka kampanya", "ffffff");
  const rec = (title: string) => deps.recommendations.create({ area: "content", priority: "low", title, why: "w", action: "a", evidence: [], campaignId: existing.id });
  const open = rec("açık");
  const done = rec("yapıldı");
  deps.recommendations.decide(done.id, "done");

  const after = await (await post(`/api/campaigns/${existing.id}/delete`, {})).json();
  assert.deepEqual(after.campaigns, []);
  assert.deepEqual(deps.drafts.list().map((d) => [d.id, d.campaignId]), [[shared.id, undefined], [other.id, "ffffff"]]);
  assert.equal(deps.drafts.list().some((d) => d.id === waiting.id), false);
  assert.deepEqual(deps.recommendations.list().map((r) => [r.id, r.campaignId]), [[done.id, undefined]]);
  assert.equal(deps.recommendations.list().some((r) => r.id === open.id), false);
  assert.notEqual((await post(`/api/campaigns/${existing.id}/delete`, {})).status, 200, "already gone");
  await new Promise((resolve) => server.close(resolve));
});
