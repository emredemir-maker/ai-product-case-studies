import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { recentCommits } from "../src/repo.ts";
import { SnapshotStore, blockedAiCrawlers, checkSite, crawlSite, diffSites } from "../src/site.ts";
import { fakeSite, tmpDir } from "./helpers.ts";

test("robots.txt: AI crawlers are blocked by their own group or by the wildcard group", () => {
  assert.deepEqual(blockedAiCrawlers("User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n"), ["GPTBot", "ClaudeBot"]);
  assert.equal(blockedAiCrawlers("User-agent: *\nDisallow: / # everything\n").length, 6);
  // A crawler's own group overrides the wildcard.
  assert.equal(blockedAiCrawlers("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n").includes("GPTBot"), false);
  assert.deepEqual(blockedAiCrawlers("User-agent: *\nDisallow:\n"), []);
});

test("crawl reads robots, sitemap and same-origin pages, and extracts page signals", async () => {
  const site = await fakeSite();
  const snapshot = await crawlSite(site.url);

  assert.deepEqual(snapshot.robots, { found: true, blockedAiCrawlers: ["GPTBot"] });
  assert.deepEqual(snapshot.sitemap, { found: true, urlCount: 2 });
  assert.equal(snapshot.llmsTxt, false);
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

  const issues = checkSite(snapshot);
  const on = (pathname: string) => issues.filter((f) => f.url === snapshot.origin + pathname).map((f) => f.issue);
  assert.deepEqual(issues.filter((f) => f.url === snapshot.origin).map((f) => f.issue), ["robots.txt blocks AI crawlers: GPTBot", "No llms.txt"]);
  assert.deepEqual(on("/"), ["1 image(s) without alt text"]);
  assert.deepEqual(on("/pricing"), [
    "Missing meta description",
    "Missing canonical link",
    "No JSON-LD structured data",
    "Missing Open Graph tags",
    "Thin content (7 words)",
  ]);
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
