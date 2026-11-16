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

/** Starts a JSON HTTP server on a free port. The handler returns [status, body]. */
export async function startServer(handler: (req: Recorded) => [number, unknown]) {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const recorded: Recorded = { method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      requests.push(recorded);
      const [status, body] = handler(recorded);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
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
