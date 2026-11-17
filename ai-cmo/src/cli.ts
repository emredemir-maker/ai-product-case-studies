import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "./agent.ts";
import { loadBrand } from "./brand.ts";
import { Auth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { DRAFT_STATUSES, type Draft, DraftStore, type DraftStatus } from "./drafts.ts";
import { PostizClient, PostizError } from "./postiz.ts";
import { approveDraft, rejectDraft } from "./publish.ts";
import { RecommendationStore } from "./recommendations.ts";
import { RunStore, loadWatch, runReview } from "./review.ts";
import { SnapshotStore } from "./site.ts";
import { createUiServer } from "./ui.ts";
import { discoverSkills } from "./skills.ts";

const USAGE = `Usage: cmo <command>

  plan "<brief>"            Run the agent on a brief; it saves drafts for review
  drafts [status]           List drafts (pending | scheduled | shared | rejected)
  show <id>                 Show one draft in full
  approve <id> [--now] [--at <ISO date>] [--channel <id>]
                            Send a draft to Postiz (scheduled, or immediately with --now)
  reject <id> [reason]      Reject a draft; the agent reads the reason on its next run
  review                    Check the site and recent commits; save recommendations and posts
  todo [status]             List recommendations (open | done | dismissed)
  prompt <id>               Print a recommendation's prompt for a coding agent
  ui [--every <hours>]      Open the local interface; optionally run a review on an interval
  channels                  List channels connected in Postiz
  skills                    List installed skills`;

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (key !== "now" && next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else flags[key] = true;
  }
  return { positional, flags };
}

const oneLine = (d: Draft) =>
  `${d.id}  ${d.status.padEnd(9)}  ${d.platform.padEnd(10)}  ${d.scheduledAt}  ${d.content.replace(/\s+/g, " ").slice(0, 60)}`;

function printDraft(d: Draft) {
  console.log(`id:         ${d.id}\nstatus:     ${d.status}\nplatform:   ${d.platform}${d.integrationId ? ` (channel ${d.integrationId})` : ""}`);
  console.log(`scheduled:  ${d.scheduledAt}\nrationale:  ${d.rationale}`);
  if (d.settings) console.log(`settings:   ${JSON.stringify(d.settings)}`);
  if (d.rejectionReason) console.log(`rejected:   ${d.rejectionReason}`);
  console.log(`\n${d.content}\n`);
}

function requireArg(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}.\n\n${USAGE}`);
  return value;
}

async function main() {
  const config = loadConfig();
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const store = new DraftStore(config.draftsFile);
  const postiz = config.postiz ? new PostizClient(config.postiz.baseUrl, config.postiz.apiKey) : null;
  const recommendations = new RecommendationStore(config.recommendationsFile);
  const runs = new RunStore(config.runsFile);
  let reviewing: ReturnType<typeof runReview> | undefined;
  // One review at a time: the interval and the "Check now" button share the run in progress.
  const review = (onActivity?: (line: string) => void) =>
    (reviewing ??= runReview({
      config,
      brand: loadBrand(config.brandFile),
      skills: discoverSkills(config.skillsDir),
      drafts: store,
      postiz,
      watch: loadWatch(config.watchFile, config.reposDir),
      gitToken: config.gitToken,
      recommendations,
      snapshots: new SnapshotStore(config.snapshotsDir),
      runs,
      onActivity,
    }).finally(() => {
      reviewing = undefined;
    }));

  switch (command) {
    case "plan": {
      const brief = requireArg(positional.join(" ").trim(), "brief");
      const result = await runAgent(brief, {
        config,
        brand: loadBrand(config.brandFile),
        skills: discoverSkills(config.skillsDir),
        drafts: store,
        postiz,
        onActivity: (line) => console.error(`  · ${line}`),
      });
      console.log(`\n${result.text}\n`);
      if (result.stopReason !== "end_turn") {
        console.error(`Warning: the run stopped early (${result.stopReason}); the plan may be incomplete.`);
      }
      console.log(`${result.draftIds.length} draft(s) saved. Review with: cmo drafts pending`);
      break;
    }
    case "drafts": {
      const status = positional[0] as DraftStatus | undefined;
      if (status && !DRAFT_STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
      const list = store.list(status);
      console.log(list.length ? list.map(oneLine).join("\n") : "No drafts.");
      break;
    }
    case "show":
      printDraft(store.get(requireArg(positional[0], "draft id")));
      break;
    case "approve": {
      const draft = await approveDraft(store, postiz, requireArg(positional[0], "draft id"), {
        now: flags.now === true,
        at: typeof flags.at === "string" ? flags.at : undefined,
        integrationId: typeof flags.channel === "string" ? flags.channel : undefined,
      });
      console.log(`Sent ${draft.id} to Postiz (${flags.now ? "publishing now" : `scheduled for ${draft.scheduledAt}`}).`);
      break;
    }
    case "reject": {
      const draft = rejectDraft(store, requireArg(positional[0], "draft id"), positional.slice(1).join(" ") || undefined);
      console.log(`Rejected ${draft.id}.`);
      break;
    }
    case "review": {
      const run = await review((line) => console.error(`  · ${line}`));
      console.log(`\n${run.summary}\n`);
      for (const problem of run.problems) console.error(`Warning: ${problem}`);
      console.log(`${run.pagesChecked} pages checked, ${run.recommendationIds.length} recommendation(s), ${run.draftIds.length} post(s). See: cmo todo, or cmo ui`);
      break;
    }
    case "todo": {
      const status = (positional[0] ?? "open") as "open" | "done" | "dismissed";
      if (!["open", "done", "dismissed"].includes(status)) throw new Error(`Unknown status: ${status}`);
      const list = recommendations.list(status);
      for (const r of list) console.log(`${r.id}  ${r.priority.padEnd(6)}  ${r.area.padEnd(7)}  ${r.title}\n        ${r.action.replace(/\s+/g, " ").slice(0, 200)}\n`);
      if (!list.length) console.log(`No ${status} recommendations.`);
      break;
    }
    case "prompt": {
      const rec = recommendations.get(requireArg(positional[0], "recommendation id"));
      if (!rec.agentPrompt) throw new Error(`Recommendation ${rec.id} has no prompt for a coding agent.`);
      console.log(rec.agentPrompt);
      break;
    }
    case "ui": {
      const canReview = fs.existsSync(config.watchFile);
      const loopback = ["127.0.0.1", "localhost", "::1"].includes(config.uiHost);
      if (!loopback && !(config.password && config.publicUrl)) {
        throw new Error("To listen on a non-local address (CMO_HOST), set CMO_PASSWORD and CMO_PUBLIC_URL. Without them anyone who can reach the port could approve posts.");
      }
      const auth = config.password ? new Auth(config.password, config.sessionSecretFile, config.publicUrl?.startsWith("https://") ?? false) : undefined;
      const server = createUiServer({
        staticDir: path.join(config.root, "web", "dist"),
        drafts: store,
        recommendations,
        runs,
        postiz,
        site: canReview ? new URL(loadWatch(config.watchFile, config.reposDir).site.url).origin : null,
        review: canReview ? () => review() : undefined,
        auth,
        publicUrl: config.publicUrl ?? undefined,
      });
      // Stop cleanly on Ctrl+C (and Ctrl+Break on Windows) instead of relying on the default handling,
      // which does not always reach the process when it is started through a wrapper such as npx.
      for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
        process.on(signal, () => {
          console.log("\nStopping.");
          process.exit(0);
        });
      }
      server.listen(config.uiPort, config.uiHost, () => console.log(`Growth desk: ${config.publicUrl ?? `http://localhost:${config.uiPort}`}`));
      if (flags.every !== undefined) {
        const hours = Number(flags.every);
        if (!canReview || !(hours >= 1)) throw new Error("--every needs a number of hours (1 or more) and a watch.json");
        const tick = () => review().then((r) => console.log(`Review done: ${r.recommendationIds.length} recommendation(s)`), (e) => console.error(`Review failed: ${e instanceof Error ? e.message : e}`));
        // Run now only when the last review is older than the interval, so restarts don't re-run it.
        const last = runs.latest();
        if (!last || last.complete === false || Date.now() - new Date(last.at).getTime() > hours * 3_600_000) void tick();
        setInterval(tick, hours * 3_600_000);
      }
      break;
    }
    case "channels": {
      if (!postiz) throw new Error("Postiz is not configured. Set POSTIZ_API_KEY (and POSTIZ_API_URL).");
      const channels = await postiz.listIntegrations();
      console.log(
        channels.length
          ? channels.map((c) => `${c.id}  ${c.identifier.padEnd(10)}  ${c.name}${c.disabled ? "  (disabled)" : ""}`).join("\n")
          : "No channels connected.",
      );
      break;
    }
    case "skills":
      for (const s of discoverSkills(config.skillsDir)) console.log(`${s.name}\n    ${s.description}`);
      break;
    default:
      console.log(USAGE);
      if (command && command !== "help" && command !== "--help") process.exitCode = 1;
  }
}

const envFile = path.resolve(import.meta.dirname, "..", ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

main().catch((error: unknown) => {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error("Claude API authentication failed. Set ANTHROPIC_API_KEY in .env.");
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error("Claude API rate limit reached. Try again shortly.");
  } else if (error instanceof Anthropic.APIError) {
    console.error(`Claude API error ${error.status}: ${error.message}`);
  } else if (error instanceof PostizError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
