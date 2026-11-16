import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { recentCommits } from "../src/repo.ts";
import { SnapshotStore, crawlSite, diffSites } from "../src/site.ts";
import { SourceSchema, runSource } from "../src/sources.ts";
import { fakeSite, tmpDir } from "./helpers.ts";

test("crawl reads the sitemap and same-origin pages, and extracts page signals", async () => {
  const site = await fakeSite();
  const snapshot = await crawlSite(site.url);

  assert.deepEqual(snapshot.sitemap, { found: true, urlCount: 2 });
  assert.deepEqual(snapshot.pages.map((p) => new URL(p.url).pathname), ["/", "/pricing"]);

  const home = snapshot.pages[0]!;
  assert.equal(home.title, "Acme Analytics");
  assert.equal(home.description, "Product analytics.");
  assert.deepEqual(home.h1, ["Analytics without a data team"]);
  assert.deepEqual(home.schemaTypes, ["Organization", "WebSite"]);
  assert.equal(home.imagesMissingAlt, 1);
  assert.equal(home.hasOpenGraph, true);
  assert.equal(home.lang, "en");
  assert.ok(home.wordCount > 200 && home.wordCount < 215, String(home.wordCount));

  const pricing = snapshot.pages[1]!;
  assert.equal(pricing.description, undefined);
  assert.equal(pricing.wordCount, 7);
  await site.close();
});

test("without a sitemap, pages are discovered from links, within the page limit", async () => {
  const { startServer } = await import("./helpers.ts");
  const site = await startServer((req) => {
    if (req.url === "/") return [200, '<title>Home</title><a href="/a">A</a><a href="/b">B</a><a href="https://other.test/">x</a><a href="/logo.png">img</a>', "text/html"];
    if (req.url === "/a" || req.url === "/b") return [200, `<title>${req.url}</title>`, "text/html"];
    return [404, "nope", "text/plain"];
  });
  const all = await crawlSite(site.url);
  assert.deepEqual(all.pages.map((p) => new URL(p.url).pathname), ["/", "/a", "/b"]);
  assert.equal(all.sitemap.found, false);
  assert.equal((await crawlSite(site.url, 2)).pages.length, 2);
  await site.close();
});

test("diff reports added, removed and changed pages; snapshots round-trip", async () => {
  const before = await fakeSite();
  const first = await crawlSite(before.url);
  await before.close();
  assert.deepEqual(diffSites(null, first), { added: [], removed: [], changed: [] });

  const store = new SnapshotStore(path.join(tmpDir(), "snapshots"));
  assert.equal(store.latest(), null);
  store.save(first);
  assert.deepEqual(store.latest(), JSON.parse(JSON.stringify(first)));

  const second = structuredClone(first);
  second.takenAt = new Date(Date.parse(first.takenAt) + 1000).toISOString();
  second.pages[1]!.title = "Plans";
  second.pages[1]!.textHash = "changed";
  second.pages.push({ ...first.pages[0]!, url: `${first.origin}/new` });
  second.pages.shift();
  assert.deepEqual(diffSites(first, second), {
    added: [`${first.origin}/new`],
    removed: [first.pages[0]!.url],
    changed: [{ url: first.pages[1]!.url, fields: ["title", "content"] }],
  });
  store.save(second);
  assert.equal(store.latest()!.takenAt, second.takenAt);
});

test("recentCommits returns subjects, bodies and files since a date", async () => {
  const repo = tmpDir();
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args]);
  git("init", "-q");
  fs.writeFileSync(path.join(repo, "old.txt"), "x");
  git("add", ".");
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-qm", "Old work"], {
    env: { ...process.env, GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z" },
  });
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "invite.ts"), "x");
  git("add", ".");
  git("commit", "-qm", "Add team invites", "-m", "Users can invite teammates by email.");

  const commits = await recentCommits(repo, "2024-01-01T00:00:00Z");
  assert.equal(commits.length, 1);
  assert.equal(commits[0]!.subject, "Add team invites");
  assert.equal(commits[0]!.body, "Users can invite teammates by email.");
  assert.deepEqual(commits[0]!.files, ["src/invite.ts"]);
  assert.equal((await recentCommits(repo, "2019-01-01T00:00:00Z")).length, 2);
  await assert.rejects(recentCommits(path.join(repo, "missing"), "2024-01-01T00:00:00Z"));
});

test("sources: GEO Optimizer preset builds the audit command and reads score and recommendations", async () => {
  // A stand-in for the `geo` CLI that reports the arguments it was given.
  const script = 'console.log(JSON.stringify({ score: 49, band: "foundation", recommendations: ["Create /llms.txt", 7], argv: process.argv.slice(1) }))';
  const source = SourceSchema.parse({ type: "geo-optimizer", command: [process.execPath, "-e", script], maxPages: 10 });
  const result = await runSource(source, "https://acme.test");

  assert.equal(result.ok, true);
  assert.equal(result.name, "GEO Optimizer audit");
  assert.equal(result.score, 49);
  assert.equal(result.band, "foundation");
  assert.deepEqual(result.recommendations, ["Create /llms.txt"]);
  assert.deepEqual(JSON.parse(result.output).argv, ["audit", "--url", "https://acme.test", "--format", "json", "--max-pages", "10"]);
  assert.deepEqual(SourceSchema.parse({ type: "geo-optimizer" }).command, ["uvx", "--from", "geo-optimizer-skill", "geo"]);
});

test("sources: a command's output is passed through; failures are reported, not thrown", async () => {
  const ok = await runSource({ type: "command", name: "Visibility", command: [process.execPath, "-e", 'console.log("mentions: 3")'] }, "https://acme.test");
  assert.deepEqual(ok, { name: "Visibility", ok: true, output: "mentions: 3\n" });

  const missing = await runSource({ type: "command", name: "Nope", command: ["no-such-program-xyz"] }, "https://acme.test");
  assert.equal(missing.ok, false);
  assert.match(missing.error!, /"no-such-program-xyz" is not installed or not on PATH/);

  const failed = await runSource({ type: "command", name: "Fails", command: [process.execPath, "-e", 'console.error("bad key"); process.exit(2)'] }, "https://acme.test");
  assert.equal(failed.ok, false);
  assert.match(failed.error!, /bad key/);

  const silent = await runSource({ type: "command", name: "Silent", command: [process.execPath, "-e", ""] }, "https://acme.test");
  assert.equal(silent.error, "The tool printed nothing.");
  // Arguments are not interpreted by a shell.
  const literal = await runSource({ type: "command", name: "Literal", command: [process.execPath, "-e", "console.log(process.argv[1])", "$(echo injected); ls"] }, "https://acme.test");
  assert.equal(literal.output, "$(echo injected); ls\n");
});
