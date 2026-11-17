import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Auth } from "./auth.ts";
import type { DraftStore } from "./drafts.ts";
import type { PostizClient } from "./postiz.ts";
import { approveDraft, markDraftShared, rejectDraft } from "./publish.ts";
import type { RecommendationStore } from "./recommendations.ts";
import type { Run, RunStore } from "./review.ts";

export interface UiDeps {
  /** Folder holding the built interface (web/dist): index.html and its assets. */
  staticDir: string;
  drafts: DraftStore;
  recommendations: RecommendationStore;
  runs: RunStore;
  postiz: PostizClient | null;
  /** The watched site, or null when watch.json is not set up. */
  site: string | null;
  /** Starts a review. Absent when the review cannot run (no watch file). */
  review?: () => Promise<Run>;
  /** Password login. Required whenever the interface is reachable from other machines. */
  auth?: Auth;
  /** The address people open, e.g. https://cmo.example.com. Absent means localhost only. */
  publicUrl?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

/**
 * The interface server. It can approve posts for publishing, so:
 * - every request must be addressed to the expected host: localhost, or the public address when
 *   one is configured (this stops DNS rebinding and requests through an unexpected name);
 * - every write must come from this page (this stops other sites open in the browser from
 *   posting to it);
 * - with `auth` set, everything under /api except login needs a signed-in session.
 */
export function createUiServer(deps: UiDeps): http.Server {
  const staticDir = path.resolve(deps.staticDir);
  if (!fs.existsSync(path.join(staticDir, "index.html"))) {
    throw new Error(`The interface is not built (no index.html in ${staticDir}). Run: npm run build:ui`);
  }

  /** Reads a built file by URL path, or returns null. Paths that leave the folder are not served. */
  const readStatic = (pathname: string): { body: Buffer; type: string } | null => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    const file = path.resolve(staticDir, `.${decoded === "/" ? "/index.html" : decoded}`);
    const type = CONTENT_TYPES[path.extname(file)];
    if (!type || !file.startsWith(staticDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    return { body: fs.readFileSync(file), type };
  };
  const publicOrigin = deps.publicUrl ? new URL(deps.publicUrl).origin : null;
  const publicHost = deps.publicUrl ? new URL(deps.publicUrl).host : null;
  const review = { running: false, error: null as string | null };

  const startReview = () => {
    if (!deps.review) throw new HttpError(400, "Set up watch.json to run reviews.");
    if (review.running) return;
    review.running = true;
    review.error = null;
    deps
      .review()
      .catch((error: unknown) => {
        review.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        review.running = false;
      });
  };

  const state = () => ({
    site: deps.site,
    authEnabled: deps.auth !== undefined,
    canPublish: deps.postiz !== null,
    canReview: Boolean(deps.review),
    review,
    recommendations: deps.recommendations.list().reverse(),
    drafts: deps.drafts.list().reverse(),
    runs: deps.runs.list().slice(-10).reverse(),
  });

  const route = async (method: string, pathname: string, body: Record<string, unknown>): Promise<unknown> => {
    if (method === "GET" && pathname === "/api/state") return state();
    if (method !== "POST") throw new HttpError(404, "Not found");

    if (pathname === "/api/review") {
      startReview();
      return state();
    }
    const rec = /^\/api\/recommendations\/([0-9a-f]+)$/.exec(pathname);
    if (rec) {
      const status = body.status;
      if (status !== "open" && status !== "done" && status !== "dismissed") throw new HttpError(400, "Unknown status");
      deps.recommendations.decide(rec[1]!, status, typeof body.reason === "string" ? body.reason : undefined);
      return state();
    }
    const draft = /^\/api\/drafts\/([0-9a-f]+)\/(approve|reject|shared)$/.exec(pathname);
    if (draft) {
      if (draft[2] === "approve") await approveDraft(deps.drafts, deps.postiz, draft[1]!, { now: body.now === true });
      else if (draft[2] === "shared") markDraftShared(deps.drafts, draft[1]!);
      else rejectDraft(deps.drafts, draft[1]!, typeof body.reason === "string" && body.reason ? body.reason : undefined);
      return state();
    }
    throw new HttpError(404, "Not found");
  };

  return http.createServer(async (req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      const method = req.method ?? "GET";
      // For container and proxy health checks, which do not send the public host name.
      if (method === "GET" && req.url === "/healthz") return send(200, { ok: true });

      const host = req.headers.host ?? "";
      const hostAllowed = publicHost ? host === publicHost : /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
      if (!hostAllowed) throw new HttpError(403, publicHost ? `Open this page at ${publicOrigin}.` : "Open this page on localhost.");
      const { pathname } = new URL(req.url ?? "/", `http://${host}`);

      if (method === "GET" && !pathname.startsWith("/api/")) {
        const file = readStatic(pathname);
        if (!file) throw new HttpError(404, "Not found");
        // Asset file names carry a content hash, so they can be cached; index.html cannot.
        const cache = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
        res.writeHead(200, { "Content-Type": file.type, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
        return void res.end(file.body);
      }

      let body: Record<string, unknown> = {};
      if (method === "POST") {
        const origin = req.headers.origin;
        if (origin !== (publicOrigin ?? `http://${host}`) || !req.headers["content-type"]?.startsWith("application/json")) {
          throw new HttpError(403, "Writes are accepted only from this page.");
        }
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 100_000) throw new HttpError(413, "Request too large");
        }
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      }
      if (deps.auth) {
        if (method === "POST" && pathname === "/api/login") {
          const result = deps.auth.login(body.password);
          if (!result.ok) {
            throw new HttpError(401, "Wrong password, or too many attempts.", { "Retry-After": String(result.retryAfterSeconds) });
          }
          return send(200, state(), { "Set-Cookie": result.cookie });
        }
        if (method === "POST" && pathname === "/api/logout") return send(200, { ok: true }, { "Set-Cookie": deps.auth.logoutCookie() });
        if (!deps.auth.isSignedIn(req.headers.cookie)) throw new HttpError(401, "Sign in required.");
      }
      send(200, await route(method, pathname, body));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      const body: Record<string, unknown> = { error: error instanceof Error ? error.message : String(error) };
      if (status === 401) body.signInRequired = true;
      if (error instanceof HttpError && error.headers["Retry-After"]) body.retryAfterSeconds = Number(error.headers["Retry-After"]);
      send(status, body, error instanceof HttpError ? error.headers : {});
    }
  });
}
