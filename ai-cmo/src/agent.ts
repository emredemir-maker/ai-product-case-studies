import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { z } from "zod";
import { type Brand, renderBrand } from "./brand.ts";
import type { Config } from "./config.ts";
import { DRAFT_STATUSES, type DraftStore } from "./drafts.ts";
import type { PostizClient } from "./postiz.ts";
import { type Usage, UsageMeter } from "./pricing.ts";
import { type Skill, readSkill, renderSkillIndex } from "./skills.ts";

export interface AgentDeps {
  config: Pick<Config, "model" | "effort" | "webSearch">;
  brand: Brand;
  skills: Skill[];
  drafts: DraftStore;
  postiz: PostizClient | null;
  client?: Anthropic;
  /** Called with a one-line description of each tool call, for progress output. */
  onActivity?: (line: string) => void;
}

export interface AgentResult {
  text: string;
  stopReason: string | null;
  usage: Usage;
  draftIds: string[];
}

export function buildSystemPrompt(brand: Brand, skills: Skill[]): string {
  return `You are the marketing lead for ${brand.name}. You turn a brief into a plan and into finished, ready-to-publish posts, which a person on the team then reviews.

# Brand

${renderBrand(brand)}

# How the work reaches the audience

You do not publish. Every post you write goes into a review queue with save_draft, and a person approves or rejects each one before anything is sent to a social platform. Because of that, write each draft as the final text you would stand behind, and use the rationale field to tell the reviewer why this post, on this channel, at this time. Never say a post was published or scheduled; say it is waiting for review.

Call list_drafts early. Rejected drafts carry the reviewer's reason, which is the best signal you have about what this team wants, and pending, scheduled or shared drafts show what is already covered so you do not repeat it.

# Channels

list_channels shows the social accounts connected for publishing. Target those where possible and pass their id to save_draft. Before writing for a connected channel, read its rules with get_channel_rules: the length limit is enforced when you save, and some providers need settings that you pass along with the draft. If no channels are connected, or the brief names a platform that is not connected, still write the draft for that platform by name; the reviewer can connect it later.

# Skills

Skills are playbooks for specific marketing tasks. Load the ones that fit the brief with load_skill before you write, and follow them. Available skills:

${renderSkillIndex(skills) || "(none installed)"}

# Facts

Every factual claim in a post must come from the brand context above or from research you do in this session. When a post depends on something current or external (a statistic, a trend, a competitor move), research it first and keep the claim to what the source supports. If you cannot support a claim, leave it out.

# Language

Write everything the reviewer reads in ${brand.language}: the posts, their rationale and your summary.

# When you finish

Reply with a short summary for the reviewer: the plan in two or three sentences, then the drafts you saved with their id, channel and scheduled time. Mention anything you could not do and why.`;
}

const isoDateTime = z.iso.datetime({ offset: true });

/** Set while a campaign is being planned: its id once defined, and the files a post may attach. */
export interface CampaignContext {
  id: () => string | null;
  materials: string[];
}

export function buildTools(deps: AgentDeps, savedIds: string[] = [], campaign?: CampaignContext) {
  const { drafts, postiz, skills } = deps;

  const listChannels = betaZodTool({
    name: "list_channels",
    description:
      "List the social media accounts connected for publishing. Returns id, name and platform identifier for each. Call this before choosing where a post goes.",
    inputSchema: z.object({}),
    run: async () => {
      if (!postiz) return "No publishing service is configured, so there are no connected channels. Draft by platform name.";
      const channels = (await postiz.listIntegrations())
        .filter((c) => !c.disabled)
        .map(({ id, name, identifier, profile }) => ({ id, name, platform: identifier, profile }));
      return channels.length ? JSON.stringify(channels) : "No channels are connected yet. Draft by platform name.";
    },
  });

  const getChannelRules = betaZodTool({
    name: "get_channel_rules",
    description:
      "Get the posting rules for a connected channel: maximum post length, platform rules, and the schema of provider-specific settings to pass to save_draft. Call this before writing for a connected channel.",
    inputSchema: z.object({ channel_id: z.string().describe("Channel id from list_channels") }),
    run: async ({ channel_id }) => {
      if (!postiz) return "No publishing service is configured.";
      return JSON.stringify(await postiz.getChannelRules(channel_id));
    },
  });

  const loadSkill = betaZodTool({
    name: "load_skill",
    description: "Load the full instructions of a skill by name. Load every skill relevant to the task before writing.",
    inputSchema: z.object({ name: z.string().describe("Skill name from the list in the system prompt") }),
    run: ({ name }) => {
      const skill = skills.find((s) => s.name === name);
      if (!skill) return `Unknown skill "${name}". Available: ${skills.map((s) => s.name).join(", ") || "none"}`;
      return readSkill(skill);
    },
  });

  const listDrafts = betaZodTool({
    name: "list_drafts",
    description:
      "List drafts already in the review queue with their status (pending, scheduled through the publishing service, shared by hand, rejected). Rejected drafts include the reviewer's reason. Call this before planning so you build on feedback and avoid duplicates.",
    inputSchema: z.object({
      status: z.enum(DRAFT_STATUSES).optional().describe("Only drafts with this status"),
    }),
    run: ({ status }) => {
      const list = drafts
        .list(status)
        .slice(-50)
        .map(({ id, status, platform, content, scheduledAt, rejectionReason }) => ({
          id,
          status,
          platform,
          scheduledAt,
          content,
          ...(rejectionReason ? { rejectionReason } : {}),
        }));
      return list.length ? JSON.stringify(list) : "The queue is empty.";
    },
  });

  const saveDraft = betaZodTool({
    name: "save_draft",
    description:
      "Save one finished post to the review queue. A person approves it before it is published. Call once per post. Returns the draft id, or an error to fix (for example when the content is over the channel's length limit).",
    inputSchema: z.object({
      platform: z.string().describe('Platform identifier, e.g. "linkedin", "x", "threads". Use the value from list_channels when targeting a connected channel.'),
      channel_id: z.string().optional().describe("Channel id from list_channels, when targeting a connected channel"),
      content: z.string().min(1).describe("The final post text, exactly as it should be published"),
      scheduled_at: isoDateTime.describe("When the post should go out, ISO 8601 with timezone offset, in the future"),
      rationale: z.string().min(1).describe("For the reviewer: why this post, on this channel, at this time"),
      settings: z.record(z.string(), z.unknown()).optional().describe("Provider-specific settings, following the schema from get_channel_rules"),
      attachment: z.string().optional().describe("File name of a material to attach when the post is shared, such as the catalog it announces. Only names from the campaign's materials list."),
    }),
    run: async (input) => {
      if (new Date(input.scheduled_at).getTime() <= Date.now()) {
        return `Error: scheduled_at ${input.scheduled_at} is in the past. Pick a future time.`;
      }
      if (input.channel_id && postiz) {
        const channels = await postiz.listIntegrations();
        const channel = channels.find((c) => c.id === input.channel_id && !c.disabled);
        if (!channel) return `Error: channel_id ${input.channel_id} is not a connected channel. Call list_channels.`;
        const { maxLength } = await postiz.getChannelRules(channel.id);
        if (maxLength > 0 && input.content.length > maxLength) {
          return `Error: content is ${input.content.length} characters; the limit for this channel is ${maxLength}. Shorten it and save again.`;
        }
      }
      if (campaign && !campaign.id()) return "Error: call define_campaign before saving posts, so they are filed under the campaign.";
      if (input.attachment && !campaign?.materials.includes(input.attachment)) {
        return `Error: "${input.attachment}" is not one of the available materials${campaign?.materials.length ? `: ${campaign.materials.join(", ")}` : ""}.`;
      }
      const draft = drafts.create({
        platform: input.platform.toLowerCase(),
        integrationId: input.channel_id,
        content: input.content,
        scheduledAt: new Date(input.scheduled_at).toISOString(),
        rationale: input.rationale,
        settings: input.settings,
        campaignId: campaign?.id() ?? undefined,
        attachment: input.attachment,
      });
      savedIds.push(draft.id);
      return JSON.stringify({ id: draft.id, status: draft.status });
    },
  });

  return [listChannels, getChannelRules, loadSkill, listDrafts, saveDraft];
}

function describeToolCall(name: string, input: unknown): string {
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const detail = args.name ?? args.platform ?? args.channel_id ?? args.query ?? args.url ?? args.title ?? args.status ?? "";
  return detail ? `${name} (${String(detail)})` : name;
}

export interface LoopInput {
  system: string;
  tools: BetaRunnableTool<any>[];
  user: string;
}

/** Runs one agent loop to completion and returns the final text. */
export async function runLoop(deps: Pick<AgentDeps, "config" | "client" | "onActivity">, input: LoopInput) {
  const client = deps.client ?? new Anthropic();
  const runner = client.beta.messages.toolRunner({
    model: deps.config.model,
    // One turn can carry several recommendations, each with a long prompt for a coding agent.
    // 16k was not enough in practice: the turn was cut off and its tool calls never ran.
    // Streaming is what lets a response this long run without hitting an HTTP timeout.
    max_tokens: 64000,
    stream: true,
    max_iterations: 60,
    // Full history on every turn: a plain stateless request, with the stable prefix cached.
    thread: false,
    cache_control: { type: "ephemeral" },
    output_config: { effort: deps.config.effort },
    // If the model declines a request, the API re-runs it on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: input.system,
    tools: [...input.tools, ...(deps.config.webSearch ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 8 }] : [])],
    // The date goes in the user turn so the system prompt stays byte-identical across runs.
    messages: [{ role: "user", content: `Today is ${new Date().toISOString()}.\n\n${input.user}` }],
  });

  let last: Anthropic.Beta.BetaMessage | undefined;
  const meter = new UsageMeter();
  for await (const stream of runner) {
    const message = await stream.finalMessage();
    last = message;
    meter.add(message.model, message.usage);
    // A turn cut off at the length limit may end in a half-written tool call; the runner does not
    // execute any of that turn's calls, so do not report them as done.
    if (message.stop_reason === "max_tokens") break;
    for (const block of message.content) {
      if (block.type === "tool_use" || block.type === "server_tool_use") {
        deps.onActivity?.(describeToolCall(block.name, block.input));
      }
    }
  }
  if (!last) throw new Error("The agent returned no response");

  const text = last.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { text, stopReason: last.stop_reason, usage: meter.total() };
}

/** Runs the agent on one brief. Drafts are written to the store as it works. */
export async function runAgent(brief: string, deps: AgentDeps): Promise<AgentResult> {
  const draftIds: string[] = [];
  const result = await runLoop(deps, {
    system: buildSystemPrompt(deps.brand, deps.skills),
    tools: buildTools(deps, draftIds),
    user: `Brief: ${brief}`,
  });
  return { ...result, draftIds };
}
