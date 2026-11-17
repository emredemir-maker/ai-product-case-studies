import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { buildTools } from "../src/agent.ts";
import { BrandSchema } from "../src/brand.ts";
import { DraftStore } from "../src/drafts.ts";
import { RecommendationStore } from "../src/recommendations.ts";
import { RunStore } from "../src/review.ts";
import { createUiServer } from "../src/ui.ts";
import { SIZE, type Visual, VisualSchema, renderVisual, screenshotExists } from "../src/visual.ts";
import { runVisuals } from "../src/visuals-run.ts";
import { future, startServer, tmpDir } from "./helpers.ts";

const brand = BrandSchema.parse({ name: "Clyro Labs", description: "d", language: "Türkçe", audience: "a", voice: { tone: "t" }, visual: { footer: "clyrolabs.com" } });

/** A valid 2 x 1 PNG, enough for the renderer to place as a screenshot. */
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEklEQVR4nGP8z8DwnwEImBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==", "base64");

const isPng = (data: Buffer) => data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(16) === SIZE && data.readUInt32BE(20) === SIZE;

test("the image description is validated by kind", () => {
  assert.equal(VisualSchema.safeParse({ kind: "stat", headline: "h" }).success, false, "a stat image needs its number");
  assert.equal(VisualSchema.safeParse({ kind: "stat", headline: "h", stat: "%49,9" }).success, true);
  assert.equal(VisualSchema.safeParse({ kind: "screenshot", headline: "h" }).success, false);
  assert.equal(VisualSchema.safeParse({ kind: "statement", headline: "h" }).success, true);
  // Screenshot names are plain file names, never paths.
  for (const file of ["../secret.png", "a/b.png", "C:\\x.png", ".hidden.png", "shot.gif", "shot"]) {
    assert.equal(VisualSchema.safeParse({ kind: "screenshot", headline: "h", screenshot: { file, prompt: "p" } }).success, false, file);
  }
  assert.equal(VisualSchema.safeParse({ kind: "screenshot", headline: "h", screenshot: { file: "kok-neden_2.PNG", prompt: "p" } }).success, true);
  assert.deepEqual(brand.visual, { background: "#101828", foreground: "#FFFFFF", muted: "#B4BDCC", accent: "#7CD4FD", logoHeight: 56, footer: "clyrolabs.com", font: "Inter" });
});

test("every layout renders a 1200 x 1200 PNG, with Turkish text, a logo and a screenshot", async () => {
  const materialsDir = tmpDir();
  fs.writeFileSync(path.join(materialsDir, "ekran.png"), TINY_PNG);
  fs.writeFileSync(path.join(materialsDir, "logo.png"), TINY_PNG);
  const base = { brandName: brand.name, materialsDir };
  const withLogo = { ...brand.visual, logo: "logo.png" };

  const stat: Visual = { kind: "stat", stat: "%49,9", headline: "Bağımsız ölçüm değil; İstanbul'da yaşam şirketi", detail: "ğüşiöç ĞÜŞİÖÇ ı", source: "8.024 talep" };
  const statement: Visual = { kind: "statement", headline: "Yapay zekâ hazırlar, insan karar verir." };
  const shot: Visual = { kind: "screenshot", headline: "Kök Neden Raporu", screenshot: { file: "ekran.png", prompt: "p" } };
  const missing: Visual = { kind: "screenshot", headline: "Claude bağlantısı", screenshot: { file: "yok.png", prompt: "p" } };

  const plain = await renderVisual({ ...base, style: brand.visual, visual: stat });
  assert.ok(isPng(plain));
  const branded = await renderVisual({ ...base, style: withLogo, visual: stat });
  assert.ok(isPng(branded));
  assert.notDeepEqual(branded, plain, "the logo changes the image");
  assert.ok(isPng(await renderVisual({ ...base, style: brand.visual, visual: statement })));
  // The second bundled typeface, with its own heading weight, and a taller logo.
  const outfit = await renderVisual({ ...base, style: { ...withLogo, font: "Outfit", logoHeight: 120 }, visual: stat });
  assert.ok(isPng(outfit));
  assert.notDeepEqual(outfit, branded);

  assert.equal(screenshotExists(materialsDir, shot), true);
  assert.equal(screenshotExists(materialsDir, missing), false);
  assert.equal(screenshotExists(materialsDir, stat), true, "only screenshot images wait for a file");
  const ready = await renderVisual({ ...base, style: brand.visual, visual: shot });
  const placeholder = await renderVisual({ ...base, style: brand.visual, visual: { ...shot, screenshot: { file: "yok.png", prompt: "p" } } });
  assert.ok(isPng(ready) && isPng(placeholder));
  assert.notDeepEqual(ready, placeholder);
  // A missing logo falls back to the brand name instead of failing.
  assert.ok(isPng(await renderVisual({ ...base, style: { ...brand.visual, logo: "no-logo.png" }, visual: statement })));
});

const message = (content: unknown[], stop_reason: string) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

test("save_draft keeps a valid image description; the images pass adds them to waiting posts only", async () => {
  const dir = tmpDir();
  const drafts = new DraftStore(path.join(dir, "drafts.json"));
  const base = { config: { model: "claude-opus-5-5", effort: "high" as const, webSearch: true }, brand, skills: [], drafts, postiz: null };

  const saveDraft = buildTools(base).find((t) => t.name === "save_draft")!;
  const saved = JSON.parse((await saveDraft.run({ platform: "linkedin", content: "Yüzde 49,9", scheduled_at: future(), rationale: "r", visual: { kind: "stat", stat: "%49,9", headline: "Her iki talepten biri" } } as never)) as string);
  assert.equal(drafts.get(saved.id).visual!.stat, "%49,9");
  assert.throws(() => saveDraft.parse({ platform: "linkedin", content: "x", scheduled_at: future(), rationale: "r", visual: { kind: "stat", headline: "no number" } }), /needs stat/);

  const plain = drafts.create({ platform: "linkedin", content: "Onay akışı", scheduledAt: future(), rationale: "r" });
  const email = drafts.create({ platform: "email", content: "Konu\n\nGövde", scheduledAt: future(), rationale: "r" });
  const shared = drafts.create({ platform: "linkedin", content: "Eski", scheduledAt: future(), rationale: "r" });
  drafts.update(shared.id, { status: "shared" });

  const api = await startServer((req) => {
    if (req.body.messages.length > 1) return [200, message([{ type: "text", text: "Bir gönderiye görsel eklendi." }], "end_turn")];
    return [
      200,
      message(
        [
          { type: "tool_use", id: "t1", name: "set_draft_visual", input: { draft_id: plain.id, visual: { kind: "screenshot", headline: "Onay ekranı", screenshot: { file: "onay.png", prompt: "Onay ekranının görüntüsünü alın." } } } },
          { type: "tool_use", id: "t2", name: "set_draft_visual", input: { draft_id: shared.id, visual: { kind: "statement", headline: "x" } } },
        ],
        "tool_use",
      ),
    ];
  });
  const result = await runVisuals({ ...base, client: new Anthropic({ apiKey: "test", baseURL: api.url, maxRetries: 0 }) });

  assert.deepEqual(result.draftIds, [plain.id]);
  assert.equal(result.summary, "Bir gönderiye görsel eklendi.");
  assert.equal(drafts.get(plain.id).visual!.screenshot!.file, "onay.png");
  assert.equal(drafts.get(shared.id).visual, undefined, "posts that are not waiting are left alone");
  const request = api.requests[0]!.body;
  assert.match(request.messages[0].content, new RegExp(`id: ${plain.id}`));
  assert.doesNotMatch(request.messages[0].content, new RegExp(`id: (${email.id}|${shared.id}|${saved.id})`), "emails, decided posts and posts with an image are not offered");
  assert.deepEqual(request.tools.map((t: { name: string }) => t.name), ["set_draft_visual"], "no web search for this pass");
  assert.match(request.system, /Write the words on the image and the screenshot prompt in Türkçe/);

  // With nothing left to illustrate, no request is made.
  drafts.update(plain.id, { status: "rejected" });
  const before = api.requests.length;
  assert.deepEqual((await runVisuals({ ...base, client: new Anthropic({ apiKey: "test", baseURL: api.url, maxRetries: 0 }) })).draftIds, []);
  assert.equal(api.requests.length, before);
  await api.close();
});

test("the interface serves a post's image and reports whether its screenshot has arrived", async () => {
  const dir = tmpDir();
  const materialsDir = path.join(dir, "materials");
  const staticDir = path.join(dir, "dist");
  fs.mkdirSync(materialsDir);
  fs.mkdirSync(staticDir);
  fs.writeFileSync(path.join(staticDir, "index.html"), "ok");
  const drafts = new DraftStore(path.join(dir, "drafts.json"));
  const withShot = drafts.create({ platform: "linkedin", content: "a", scheduledAt: future(), rationale: "r", visual: { kind: "screenshot", headline: "Rapor", screenshot: { file: "rapor.png", prompt: "p" } } });
  const withoutImage = drafts.create({ platform: "linkedin", content: "b", scheduledAt: future(), rationale: "r" });
  let suggested = 0;
  const server = createUiServer({
    staticDir,
    drafts,
    recommendations: new RecommendationStore(path.join(dir, "recommendations.json")),
    runs: new RunStore(path.join(dir, "runs.json")),
    postiz: null,
    site: null,
    visuals: {
      render: (draft) => renderVisual({ visual: draft.visual!, style: brand.visual, brandName: brand.name, materialsDir }),
      screenshotReady: (draft) => screenshotExists(materialsDir, draft.visual),
      suggest: async () => {
        suggested++;
      },
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const state = async () => (await fetch(base + "/api/state")).json();
  const draftState = async (id: string) => (await state()).drafts.find((d: { id: string }) => d.id === id);

  assert.equal((await draftState(withShot.id)).screenshotReady, false);
  assert.equal("screenshotReady" in (await draftState(withoutImage.id)), false);

  const image = await fetch(`${base}/api/drafts/${withShot.id}/visual.png`);
  assert.equal(image.headers.get("content-type"), "image/png");
  const placeholder = Buffer.from(await image.arrayBuffer());
  assert.ok(isPng(placeholder));
  assert.equal((await fetch(`${base}/api/drafts/${withoutImage.id}/visual.png`)).status, 404);
  assert.equal((await fetch(`${base}/api/drafts/ffffff/visual.png`)).status, 400);

  // Once the file is in the materials folder the image is complete.
  fs.writeFileSync(path.join(materialsDir, "rapor.png"), TINY_PNG);
  assert.equal((await draftState(withShot.id)).screenshotReady, true);
  const finished = Buffer.from(await (await fetch(`${base}/api/drafts/${withShot.id}/visual.png`)).arrayBuffer());
  assert.notDeepEqual(finished, placeholder);

  const started = await fetch(base + "/api/visuals", { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(started.status, 200);
  assert.equal(suggested, 1);
  await new Promise((resolve) => server.close(resolve));
});
