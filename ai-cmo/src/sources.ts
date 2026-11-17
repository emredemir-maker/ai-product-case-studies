import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/**
 * External audit tools whose output feeds the review. This project does not implement SEO or GEO
 * rules itself; it runs tools that do and hands their output to the agent.
 */
export const SourceSchema = z.discriminatedUnion("type", [
  z.object({
    /** GEO Optimizer (MIT, github.com/Auriti-Labs/geo-optimizer-skill): AI-readiness audit of the site. */
    type: z.literal("geo-optimizer"),
    /**
     * How to invoke its CLI. Left out, it is `uvx --from geo-optimizer-skill geo` (needs `uv`), or
     * the words in CMO_GEO_COMMAND when that is set, as it is in the Docker image.
     */
    command: z.array(z.string()).min(1).optional(),
    /** Audit up to this many sitemap pages and average them, instead of the home page only. */
    maxPages: z.number().int().min(2).max(500).optional(),
  }),
  z.object({
    /** Any command that prints a report, e.g. Canonry: ["cnry", "visibility-stats", "my-site", "--format", "json"]. */
    type: z.literal("command"),
    name: z.string().min(1),
    command: z.array(z.string()).min(1),
  }),
]);
export type Source = z.infer<typeof SourceSchema>;

export interface SourceResult {
  name: string;
  ok: boolean;
  error?: string;
  /** What the tool printed, given to the agent as is. */
  output: string;
  /** Headline numbers, when the tool reports them (GEO Optimizer does). */
  score?: number;
  band?: string;
  recommendations?: string[];
}

const MAX_OUTPUT = 80_000;

function summarizeGeo(stdout: string): Pick<SourceResult, "score" | "band" | "recommendations"> {
  const report = JSON.parse(stdout) as { score?: unknown; band?: unknown; recommendations?: unknown };
  return {
    score: typeof report.score === "number" ? report.score : undefined,
    band: typeof report.band === "string" ? report.band : undefined,
    recommendations: Array.isArray(report.recommendations) ? report.recommendations.filter((r): r is string => typeof r === "string") : undefined,
  };
}

export function geoCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.CMO_GEO_COMMAND?.trim().split(/\s+/).filter(Boolean);
  return configured?.length ? configured : ["uvx", "--from", "geo-optimizer-skill", "geo"];
}

export async function runSource(source: Source, siteUrl: string): Promise<SourceResult> {
  const isGeo = source.type === "geo-optimizer";
  const name = isGeo ? "GEO Optimizer audit" : source.name;
  const [file, ...args] = isGeo
    ? [...(source.command ?? geoCommand()), "audit", "--url", siteUrl, "--format", "json", ...(source.maxPages ? ["--max-pages", String(source.maxPages)] : [])]
    : source.command;
  try {
    // No shell: the configured words are passed to the program as arguments, never interpreted.
    const { stdout } = await run(file!, args, { timeout: 10 * 60_000, maxBuffer: 32 * 1024 * 1024 });
    const output = stdout.length > MAX_OUTPUT ? `${stdout.slice(0, MAX_OUTPUT)}\n[truncated]` : stdout;
    if (!stdout.trim()) return { name, ok: false, error: "The tool printed nothing.", output: "" };
    return { name, ok: true, output, ...(isGeo ? summarizeGeo(stdout) : {}) };
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    const detail =
      e.code === "ENOENT"
        ? `"${file}" is not installed or not on PATH.${isGeo ? " Install uv, or run `pip install geo-optimizer-skill` and set \"command\": [\"geo\"]." : ""}`
        : e.killed
          ? "Timed out after 10 minutes."
          : (e.stderr?.trim() || e.message).split("\n").slice(-3).join(" ").slice(0, 400);
    return { name, ok: false, error: detail, output: "" };
  }
}
