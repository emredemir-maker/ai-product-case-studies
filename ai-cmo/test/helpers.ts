import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ai-cmo-test-"));

export interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

/** Starts an HTTP server on a free port. The handler returns [status, body], JSON unless a content type is given. */
export async function startServer(handler: (req: Recorded) => [number, unknown, string?]) {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const recorded: Recorded = { method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      requests.push(recorded);
      const [status, body, type] = handler(recorded);
      res.writeHead(status, { "Content-Type": type ?? "application/json" });
      res.end(type ? (body as string) : JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

export const future = (hours = 24) => new Date(Date.now() + hours * 3_600_000).toISOString();

/** A fake Postiz with one LinkedIn channel limited to `maxLength` characters. */
export const fakePostiz = (maxLength = 100) =>
  startServer((req) => {
    if (req.headers.authorization !== "test-key") return [401, { msg: "Invalid API key" }];
    if (req.method === "GET" && req.url === "/public/v1/integrations") {
      return [200, [{ id: "ch1", name: "Acme", identifier: "linkedin", disabled: false }]];
    }
    if (req.method === "GET" && req.url === "/public/v1/integration-settings/ch1") {
      return [200, { output: { rules: "", maxLength, settings: "No additional settings required" } }];
    }
    if (req.method === "POST" && req.url === "/public/v1/posts") return [201, [{ postId: "p1", integration: "ch1" }]];
    return [404, { msg: "not found" }];
  });

const html = (head: string, body: string) => `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

/** A fake website: robots.txt that blocks GPTBot, a sitemap with two pages, no llms.txt. */
export const fakeSite = (pricingBody = "<h1>Pricing</h1><p>Free plan and Pro at $20.</p>") =>
  startServer((req) => {
    const base = `http://${req.headers.host}`;
    switch (req.url) {
      case "/robots.txt":
        return [200, `User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`, "text/plain"];
      case "/sitemap.xml":
        return [200, `<urlset><url><loc>${base}/</loc></url><url><loc>${base}/pricing</loc></url><url><loc>https://elsewhere.test/x</loc></url></urlset>`, "application/xml"];
      case "/":
        return [
          200,
          html(
            `<title>Acme Analytics</title><meta name="description" content="Product analytics."><link rel="canonical" href="${base}/"><meta property="og:title" content="Acme"><script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":["WebSite"]}]}</script>`,
            `<h1>Analytics without a data team</h1><h2>How</h2><img src="a.png"><img src="b.png" alt="Chart"><script>ignored()</script><p>${"word ".repeat(200)}</p>`,
          ),
          "text/html",
        ];
      case "/pricing":
        return [200, html("<title>Pricing</title>", pricingBody), "text/html"];
      default:
        return [404, html("<title>Not found</title>", "<h1>Not found</h1>"), "text/html"];
    }
  });
