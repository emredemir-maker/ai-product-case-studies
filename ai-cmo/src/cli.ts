import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "./agent.ts";
import { loadBrand } from "./brand.ts";
import { loadConfig } from "./config.ts";
import { type Draft, DraftStore, type DraftStatus } from "./drafts.ts";
import { PostizClient, PostizError } from "./postiz.ts";
import { approveDraft, rejectDraft } from "./publish.ts";
import { discoverSkills } from "./skills.ts";

const USAGE = `Usage: cmo <command>

  plan "<brief>"            Run the agent on a brief; it saves drafts for review
  drafts [status]           List drafts (pending | scheduled | rejected)
  show <id>                 Show one draft in full
  approve <id> [--now] [--at <ISO date>] [--channel <id>]
                            Send a draft to Postiz (scheduled, or immediately with --now)
  reject <id> [reason]      Reject a draft; the agent reads the reason on its next run
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
      if (status && !["pending", "scheduled", "rejected"].includes(status)) throw new Error(`Unknown status: ${status}`);
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
