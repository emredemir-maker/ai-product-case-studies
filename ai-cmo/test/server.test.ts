import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { Auth } from "../src/auth.ts";
import { DraftStore } from "../src/drafts.ts";
import { RecommendationStore } from "../src/recommendations.ts";
import { recentCommits, syncRepo } from "../src/repo.ts";
import { RunStore, WatchSchema, loadWatch } from "../src/review.ts";
import { createUiServer } from "../src/ui.ts";
import { tmpDir } from "./helpers.ts";

const PASSWORD = "correct horse battery";

test("auth: sessions are signed, expire, survive a restart and end when the password changes", () => {
  const secret = path.join(tmpDir(), "data", "session-secret");
  assert.throws(() => new Auth("short", secret, true), /at least 12 characters/);
  const auth = new Auth(PASSWORD, secret, true);
  const t0 = 1_000_000;

  const result = auth.login(PASSWORD, t0);
  assert.ok(result.ok);
  assert.match(result.cookie, /^cmo_session=\d+\.[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
  const cookie = result.cookie.split(";")[0]!;

  assert.equal(auth.isSignedIn(`other=1; ${cookie}`, t0), true);
  assert.equal(auth.isSignedIn(cookie, t0 + 31 * 86_400_000), false, "expired");
  assert.equal(auth.isSignedIn(undefined, t0), false);
  assert.equal(auth.isSignedIn("cmo_session=garbage", t0), false);
  // Pushing the expiry out without the key does not work.
  const [expires, signature] = cookie.slice("cmo_session=".length).split(".");
  assert.equal(auth.isSignedIn(`cmo_session=${Number(expires) + 1}.${signature}`, t0), false);

  assert.equal(new Auth(PASSWORD, secret, true).isSignedIn(cookie, t0), true, "same key after restart");
  assert.equal(new Auth("a different password", secret, true).isSignedIn(cookie, t0), false);
  assert.equal(fs.statSync(secret).mode & 0o077, 0, "secret file is private");
  assert.doesNotMatch((new Auth(PASSWORD, secret, false).login(PASSWORD, t0) as { cookie: string }).cookie, /Secure/);
});

test("auth: wrong passwords lock every attempt out for a growing wait", () => {
  const auth = new Auth(PASSWORD, path.join(tmpDir(), "s"), true);
  let now = 0;
  assert.deepEqual(auth.login("nope", now), { ok: false, retryAfterSeconds: 2 });
  // Even the right password is refused during the wait.
  assert.deepEqual(auth.login(PASSWORD, now + 1000), { ok: false, retryAfterSeconds: 1 });
  now += 2000;
  assert.deepEqual(auth.login(42, now), { ok: false, retryAfterSeconds: 4 });
  now += 4000;
  for (let i = 0; i < 10; i++) {
    const r = auth.login("nope", now) as { retryAfterSeconds: number };
    now += r.retryAfterSeconds * 1000;
  }
  assert.deepEqual(auth.login("nope", now), { ok: false, retryAfterSeconds: 300 }, "capped at five minutes");
  now += 300_000;
  assert.equal(auth.login(PASSWORD, now).ok, true);
  assert.deepEqual(auth.login("nope", now), { ok: false, retryAfterSeconds: 2 }, "counter resets after a success");
});

test("server mode: the API needs a session, on the public host only", async () => {
  const dir = tmpDir();
  const staticDir = path.join(dir, "dist");
  fs.mkdirSync(staticDir);
  fs.writeFileSync(path.join(staticDir, "index.html"), "<title>Büyüme Masası</title>");
  const recommendations = new RecommendationStore(path.join(dir, "recommendations.json"));
  const rec = recommendations.create({ area: "seo", priority: "low", title: "t", why: "w", action: "a", evidence: [] });
  const server = createUiServer({
    staticDir,
    drafts: new DraftStore(path.join(dir, "drafts.json")),
    recommendations,
    runs: new RunStore(path.join(dir, "runs.json")),
    postiz: null,
    site: null,
    auth: new Auth(PASSWORD, path.join(dir, "secret"), true),
    publicUrl: "https://cmo.example.test",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  // Requests arrive from the reverse proxy, carrying the public host name.
  const request = (method: string, url: string, options: { body?: unknown; cookie?: string; host?: string; origin?: string } = {}) =>
    new Promise<{ status: number; json: any; setCookie?: string; retryAfter?: string }>((resolve, reject) => {
      const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
      const req = http.request(
        { port, host: "127.0.0.1", method, path: url, headers: { Host: options.host ?? "cmo.example.test", ...(payload ? { "Content-Type": "application/json", Origin: options.origin ?? "https://cmo.example.test" } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) } },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => resolve({ status: res.statusCode!, json: raw.startsWith("{") || raw.startsWith("[") ? JSON.parse(raw) : raw, setCookie: res.headers["set-cookie"]?.[0], retryAfter: res.headers["retry-after"] as string | undefined }));
        },
      );
      req.on("error", reject);
      req.end(payload);
    });

  assert.deepEqual((await request("GET", "/healthz", { host: "localhost" })).json, { ok: true });
  assert.equal((await request("GET", "/", { host: `localhost:${port}` })).status, 403, "only the public host is served");
  assert.equal((await request("GET", "/")).status, 200, "the page itself needs no session");

  const anonymous = await request("GET", "/api/state");
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.json.signInRequired, true);
  assert.equal((await request("POST", `/api/recommendations/${rec.id}`, { body: { status: "done" } })).status, 401);
  assert.equal(recommendations.list("open").length, 1);

  const wrong = await request("POST", "/api/login", { body: { password: "guess" } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.retryAfter, "2");
  assert.equal(wrong.json.retryAfterSeconds, 2);
  assert.equal((await request("POST", "/api/login", { body: { password: PASSWORD }, origin: "https://evil.test" })).status, 403);

  await new Promise((resolve) => setTimeout(resolve, 2100));
  const login = await request("POST", "/api/login", { body: { password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal(login.json.authEnabled, true);
  const cookie = login.setCookie!.split(";")[0]!;
  assert.match(login.setCookie!, /HttpOnly; SameSite=Strict; .*Secure/);

  assert.equal((await request("GET", "/api/state", { cookie })).status, 200);
  assert.equal((await request("POST", `/api/recommendations/${rec.id}`, { body: { status: "done" }, cookie })).status, 200);
  assert.equal(recommendations.list("done").length, 1);

  const logout = await request("POST", "/api/logout", { body: {}, cookie });
  assert.match(logout.setCookie!, /^cmo_session=; .*Max-Age=0/);
  await new Promise((resolve) => server.close(resolve));
});

test("repositories given by URL are mirrored and kept up to date", async () => {
  const dir = tmpDir();
  const origin = path.join(dir, "origin");
  fs.mkdirSync(origin);
  const git = (...args: string[]) => execFileSync("git", ["-C", origin, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args]);
  const commit = (file: string, message: string) => {
    fs.writeFileSync(path.join(origin, file), "x");
    git("add", ".");
    git("commit", "-qm", message);
  };
  git("init", "-q");
  commit("a.txt", "First feature");

  const watchFile = path.join(dir, "watch.json");
  fs.writeFileSync(watchFile, JSON.stringify({ site: { url: "https://acme.test" }, repos: [{ name: "app", url: `file://${origin}` }] }));
  const repo = loadWatch(watchFile, path.join(dir, "repos")).repos[0]!;
  assert.equal(repo.path, path.join(dir, "repos", "app.git"));

  await syncRepo(repo.url!, repo.path!, "unused-for-file-urls");
  assert.deepEqual((await recentCommits(repo.path!, "2000-01-01")).map((c) => c.subject), ["First feature"]);

  commit("b.txt", "Second feature");
  await syncRepo(repo.url!, repo.path!, null);
  const commits = await recentCommits(repo.path!, "2000-01-01");
  assert.deepEqual(commits.map((c) => c.subject), ["Second feature", "First feature"]);
  assert.deepEqual(commits[0]!.files, ["b.txt"]);

  await assert.rejects(syncRepo(`file://${path.join(dir, "missing")}`, path.join(dir, "repos", "nope.git"), null));
  assert.equal(WatchSchema.safeParse({ site: { url: "https://a.test" }, repos: [{ name: "x" }] }).success, false, "path or url is required");
  assert.equal(WatchSchema.safeParse({ site: { url: "https://a.test" }, repos: [{ name: "x", path: "p", url: "u" }] }).success, false);
  assert.equal(WatchSchema.safeParse({ site: { url: "https://a.test" }, repos: [{ name: "../x", url: "u" }] }).success, false, "names become folder names");
});
