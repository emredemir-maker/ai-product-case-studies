import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { BrandSchema, renderBrand } from "../src/brand.ts";
import { DraftStore } from "../src/drafts.ts";
import { rejectDraft } from "../src/publish.ts";
import { discoverSkills, readSkill } from "../src/skills.ts";
import { future, tmpDir } from "./helpers.ts";

const newDraft = { platform: "linkedin", content: "Hello", scheduledAt: future(), rationale: "why" };

test("drafts persist across store instances and can be rejected once", () => {
  const file = path.join(tmpDir(), "nested", "drafts.json");
  const created = new DraftStore(file).create(newDraft);
  assert.equal(created.status, "pending");

  const store = new DraftStore(file);
  assert.deepEqual(store.get(created.id), created);

  const rejected = rejectDraft(store, created.id, "too salesy");
  assert.equal(rejected.rejectionReason, "too salesy");
  assert.deepEqual(new DraftStore(file).list("rejected").map((d) => d.id), [created.id]);
  assert.throws(() => rejectDraft(store, created.id), /is rejected, not pending/);
  assert.throws(() => store.get("nope"), /No draft with id nope/);
});

test("skills are discovered from SKILL.md frontmatter; repo skills beat vendored ones", () => {
  const dir = tmpDir();
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write("copy/SKILL.md", '---\nname: copywriting\ndescription: "Write page copy: fast."\nmetadata:\n  version: 1.0\n---\n\n# Ours\n');
  write("vendor/pack/skills/copywriting/SKILL.md", "---\nname: copywriting\ndescription: vendored\n---\nTheirs");
  write("vendor/pack/skills/seo-audit/SKILL.md", "---\nname: seo-audit\ndescription: Audit SEO\n---\nAudit body");
  write("no-frontmatter/SKILL.md", "Just a body");

  const skills = discoverSkills(dir);
  assert.deepEqual(skills.map((s) => s.name), ["copywriting", "no-frontmatter", "seo-audit"]);
  const copy = skills[0]!;
  assert.equal(copy.description, "Write page copy: fast.");
  assert.equal(readSkill(copy), "# Ours");
  assert.equal(readSkill(skills[1]!), "Just a body");
});

test("the skills shipped in this repo load", () => {
  const names = discoverSkills(path.resolve(import.meta.dirname, "..", "skills")).map((s) => s.name);
  assert.ok(names.includes("social-post") && names.includes("content-calendar"), names.join(","));
});

test("the example brand file is valid and renders voice rules", () => {
  const file = path.resolve(import.meta.dirname, "..", "brand.example.json");
  const brand = BrandSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  const text = renderBrand(brand);
  assert.match(text, /Voice, don't:\n- Hype words/);
  assert.equal(BrandSchema.safeParse({ name: "x" }).success, false);
});
