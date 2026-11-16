import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "node-html-parser";

export interface PageSnapshot {
  url: string;
  status: number;
  title?: string;
  description?: string;
  canonical?: string;
  lang?: string;
  h1: string[];
  h2Count: number;
  wordCount: number;
  noindex: boolean;
  /** schema.org @type values found in JSON-LD. */
  schemaTypes: string[];
  hasOpenGraph: boolean;
  imagesMissingAlt: number;
  /** Hash of the visible text, to detect content changes. */
  textHash: string;
}

export interface SiteSnapshot {
  takenAt: string;
  origin: string;
  robots: { found: boolean; blockedAiCrawlers: string[] };
  sitemap: { found: boolean; urlCount: number };
  llmsTxt: boolean;
  pages: PageSnapshot[];
}

export interface Finding {
  url: string;
  issue: string;
}

export interface SiteDiff {
  added: string[];
  removed: string[];
  changed: { url: string; fields: string[] }[];
}

/** Crawlers that feed AI answer engines; blocking them removes the site from those answers. */
export const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended"];

const USER_AGENT = "ai-cmo-site-watch/0.1";

export function extractPage(url: string, status: number, html: string): PageSnapshot {
  const root = parse(html);
  const meta = (selector: string) => root.querySelector(selector)?.getAttribute("content")?.trim() || undefined;
  const schemaTypes = new Set<string>();
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const visit = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== "object") return;
        const record = node as Record<string, unknown>;
        for (const t of [record["@type"]].flat()) if (typeof t === "string") schemaTypes.add(t);
        visit(record["@graph"]);
      };
      visit(JSON.parse(script.text));
    } catch {
      schemaTypes.add("(invalid JSON-LD)");
    }
  }
  const images = root.querySelectorAll("img");
  for (const el of root.querySelectorAll("script, style, noscript, template")) el.remove();
  // structuredText keeps block elements apart, so "<h1>A</h1><p>B</p>" reads "A B" and not "AB".
  const text = (root.querySelector("body") ?? root).structuredText.replace(/\s+/g, " ").trim();
  return {
    url,
    status,
    title: root.querySelector("title")?.text.trim() || undefined,
    description: meta('meta[name="description"]'),
    canonical: root.querySelector('link[rel="canonical"]')?.getAttribute("href") || undefined,
    lang: root.querySelector("html")?.getAttribute("lang") || undefined,
    h1: root.querySelectorAll("h1").map((h) => h.text.replace(/\s+/g, " ").trim()),
    h2Count: root.querySelectorAll("h2").length,
    wordCount: text ? text.split(" ").length : 0,
    noindex: /noindex/i.test(meta('meta[name="robots"]') ?? ""),
    schemaTypes: [...schemaTypes].sort(),
    hasOpenGraph: Boolean(meta('meta[property="og:title"]')),
    imagesMissingAlt: images.filter((img) => !img.getAttribute("alt")?.trim()).length,
    textHash: crypto.createHash("sha256").update(text).digest("hex").slice(0, 16),
  };
}

/** AI crawlers that robots.txt disallows from the whole site, directly or through `User-agent: *`. */
export function blockedAiCrawlers(robotsTxt: string): string[] {
  const groups: { agents: string[]; disallowAll: boolean }[] = [];
  let current: { agents: string[]; disallowAll: boolean } | undefined;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*(?:#.*)?$/.exec(raw);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!;
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], disallowAll: false }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "disallow" && value === "/" && current) current.disallowAll = true;
  }
  return AI_CRAWLERS.filter((bot) => {
    const own = groups.filter((g) => g.agents.includes(bot.toLowerCase()));
    const applicable = own.length ? own : groups.filter((g) => g.agents.includes("*"));
    return applicable.some((g) => g.disallowAll);
  });
}

async function get(url: string): Promise<{ status: number; body: string; type: string } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    return { status: res.status, body: await res.text(), type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}

const sitemapLocs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

/** Fetches robots.txt, the sitemap, llms.txt and up to `maxPages` same-origin pages. */
export async function crawlSite(siteUrl: string, maxPages = 30): Promise<SiteSnapshot> {
  const origin = new URL(siteUrl).origin;
  const sameOrigin = (u: string) => {
    try {
      return new URL(u, origin).origin === origin;
    } catch {
      return false;
    }
  };

  const robots = await get(`${origin}/robots.txt`);
  const robotsFound = robots?.status === 200 && !robots.type.includes("html");
  const llms = await get(`${origin}/llms.txt`);

  const sitemapUrls = robotsFound ? [...robots.body.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]!) : [];
  if (!sitemapUrls.length) sitemapUrls.push(`${origin}/sitemap.xml`);
  const pageUrls = new Set<string>();
  let sitemapFound = false;
  for (const sitemapUrl of sitemapUrls.filter(sameOrigin).slice(0, 5)) {
    const sitemap = await get(sitemapUrl);
    if (sitemap?.status !== 200 || !sitemap.body.includes("<loc>")) continue;
    sitemapFound = true;
    let locs = sitemapLocs(sitemap.body);
    if (sitemap.body.includes("<sitemapindex")) {
      // One level of nesting covers the usual sitemap-index layout.
      const children = await Promise.all(locs.filter(sameOrigin).slice(0, 5).map(get));
      locs = children.flatMap((c) => (c?.status === 200 ? sitemapLocs(c.body) : []));
    }
    for (const loc of locs) if (sameOrigin(loc)) pageUrls.add(loc);
  }

  const queue = [new URL(siteUrl).href, ...pageUrls];
  const seen = new Set<string>();
  const pages: PageSnapshot[] = [];
  while (queue.length && pages.length < maxPages) {
    const url = queue.shift()!.split("#")[0]!;
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await get(url);
    if (!res) continue;
    if (res.status === 200 && !res.type.includes("html")) continue;
    pages.push(extractPage(url, res.status, res.body));
    // With no sitemap, discover pages from links on the ones already fetched.
    if (!sitemapFound && res.status === 200) {
      for (const a of parse(res.body).querySelectorAll("a[href]")) {
        const href = a.getAttribute("href")!;
        if (/^(mailto|tel|javascript):/i.test(href) || !sameOrigin(href)) continue;
        const next = new URL(href, url);
        if (!/\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico|xml)$/i.test(next.pathname)) queue.push(next.href);
      }
    }
  }

  return {
    takenAt: new Date().toISOString(),
    origin,
    robots: { found: robotsFound, blockedAiCrawlers: robotsFound ? blockedAiCrawlers(robots.body) : [] },
    sitemap: { found: sitemapFound, urlCount: pageUrls.size },
    llmsTxt: llms?.status === 200 && !llms.type.includes("html") && llms.body.trim().length > 0,
    pages,
  };
}

/** Mechanical checks that need no judgement. The agent decides what matters and why. */
export function checkSite(site: SiteSnapshot): Finding[] {
  const findings: Finding[] = [];
  const add = (url: string, issue: string) => findings.push({ url, issue });
  if (!site.robots.found) add(site.origin, "No robots.txt");
  if (site.robots.blockedAiCrawlers.length) add(site.origin, `robots.txt blocks AI crawlers: ${site.robots.blockedAiCrawlers.join(", ")}`);
  if (!site.sitemap.found) add(site.origin, "No XML sitemap found");
  if (!site.llmsTxt) add(site.origin, "No llms.txt");

  const titles = new Map<string, string[]>();
  for (const p of site.pages) {
    if (p.status !== 200) {
      add(p.url, `Returns HTTP ${p.status}`);
      continue;
    }
    if (!p.title) add(p.url, "Missing <title>");
    else {
      if (p.title.length > 65) add(p.url, `Title is ${p.title.length} characters (over 65)`);
      titles.set(p.title, [...(titles.get(p.title) ?? []), p.url]);
    }
    if (!p.description) add(p.url, "Missing meta description");
    else if (p.description.length > 165) add(p.url, `Meta description is ${p.description.length} characters (over 165)`);
    if (p.h1.length !== 1) add(p.url, `${p.h1.length} <h1> elements (expected 1)`);
    if (!p.canonical) add(p.url, "Missing canonical link");
    if (p.noindex) add(p.url, "Page is noindex");
    if (!p.schemaTypes.length) add(p.url, "No JSON-LD structured data");
    if (p.schemaTypes.includes("(invalid JSON-LD)")) add(p.url, "JSON-LD does not parse");
    if (!p.hasOpenGraph) add(p.url, "Missing Open Graph tags");
    if (!p.lang) add(p.url, "Missing lang attribute on <html>");
    if (p.imagesMissingAlt) add(p.url, `${p.imagesMissingAlt} image(s) without alt text`);
    if (p.wordCount < 150) add(p.url, `Thin content (${p.wordCount} words)`);
  }
  for (const [title, urls] of titles) {
    if (urls.length > 1) add(urls[0]!, `Title "${title}" is shared by ${urls.length} pages: ${urls.slice(1).join(", ")}`);
  }
  return findings;
}

const COMPARED: (keyof PageSnapshot)[] = ["status", "title", "description", "canonical", "h1", "noindex", "schemaTypes", "textHash"];

export function diffSites(previous: SiteSnapshot | null, current: SiteSnapshot): SiteDiff {
  if (!previous) return { added: [], removed: [], changed: [] };
  const before = new Map(previous.pages.map((p) => [p.url, p]));
  const now = new Map(current.pages.map((p) => [p.url, p]));
  return {
    added: [...now.keys()].filter((u) => !before.has(u)),
    removed: [...before.keys()].filter((u) => !now.has(u)),
    changed: [...now.values()].flatMap((page) => {
      const old = before.get(page.url);
      if (!old) return [];
      const fields = COMPARED.filter((f) => JSON.stringify(old[f]) !== JSON.stringify(page[f])).map((f) => (f === "textHash" ? "content" : f));
      return fields.length ? [{ url: page.url, fields }] : [];
    }),
  };
}

/** Keeps the latest snapshot of each run under `dir`, newest last by file name. */
export class SnapshotStore {
  constructor(private readonly dir: string) {}

  latest(): SiteSnapshot | null {
    if (!fs.existsSync(this.dir)) return null;
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json")).sort();
    const last = files.at(-1);
    return last ? (JSON.parse(fs.readFileSync(path.join(this.dir, last), "utf8")) as SiteSnapshot) : null;
  }

  save(snapshot: SiteSnapshot): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${snapshot.takenAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(snapshot, null, 2));
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json")).sort();
    for (const old of files.slice(0, -30)) fs.rmSync(path.join(this.dir, old));
  }
}
