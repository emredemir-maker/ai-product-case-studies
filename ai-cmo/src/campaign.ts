import fs from "node:fs";
import path from "node:path";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { type AgentDeps, buildTools, runLoop } from "./agent.ts";
import { type Brand, renderBrand } from "./brand.ts";
import type { DraftStore } from "./drafts.ts";
import type { Usage } from "./pricing.ts";
import type { RecommendationStore } from "./recommendations.ts";
import { buildSiteTools } from "./review.ts";
import { type Skill, renderSkillIndex } from "./skills.ts";
import { JsonList, newId } from "./store.ts";

/** A file the agent can read while planning and a post can attach: a catalog, a one-pager, a screenshot. */
export interface Material {
  name: string;
  bytes: number;
  kind: "pdf" | "image" | "text";
}

const KINDS: Record<string, { kind: Material["kind"]; mediaType: string }> = {
  ".pdf": { kind: "pdf", mediaType: "application/pdf" },
  ".png": { kind: "image", mediaType: "image/png" },
  ".jpg": { kind: "image", mediaType: "image/jpeg" },
  ".jpeg": { kind: "image", mediaType: "image/jpeg" },
  ".webp": { kind: "image", mediaType: "image/webp" },
  ".gif": { kind: "image", mediaType: "image/gif" },
  ".md": { kind: "text", mediaType: "text/markdown" },
  ".txt": { kind: "text", mediaType: "text/plain" },
};

/** One request to the model may carry 32 MB; a single file is kept well under that. */
const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;

/** Files directly inside the materials folder that the agent can read. Other file types are left out. */
export function listMaterials(dir: string): Material[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && KINDS[path.extname(entry.name).toLowerCase()])
    .map((entry) => ({ name: entry.name, bytes: fs.statSync(path.join(dir, entry.name)).size, kind: KINDS[path.extname(entry.name).toLowerCase()]!.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface CampaignPhase {
  title: string;
  from: string;
  to: string;
  focus: string;
}

export interface Campaign {
  id: string;
  status: "active" | "archived";
  name: string;
  /** What the founder asked for. */
  brief: string;
  goal: string;
  /** The one message every piece of the campaign carries. */
  message: string;
  startsOn: string;
  endsOn: string;
  phases: CampaignPhase[];
  materials: string[];
  /** The agent's closing note on the plan. */
  summary: string;
  draftIds: string[];
  recommendationIds: string[];
  /** False when planning was cut off; the posts written so far are kept. */
  complete: boolean;
  usage?: Usage;
  createdAt: string;
}

export class CampaignStore {
  private readonly file: JsonList<Campaign>;

  constructor(file: string) {
    this.file = new JsonList(file);
  }

  list(): Campaign[] {
    return this.file.read();
  }

  create(input: Omit<Campaign, "id" | "createdAt">): Campaign {
    const all = this.file.read();
    const campaign: Campaign = { ...input, id: newId(all), createdAt: new Date().toISOString() };
    this.file.write([...all, campaign]);
    return campaign;
  }

  update(id: string, patch: Partial<Omit<Campaign, "id">>): Campaign {
    const all = this.file.read();
    const index = all.findIndex((c) => c.id === id);
    if (index === -1) throw new Error(`No campaign with id ${id}`);
    const updated = { ...all[index]!, ...patch };
    all[index] = updated;
    this.file.write(all);
    return updated;
  }

  remove(id: string): void {
    if (!this.file.read().some((c) => c.id === id)) throw new Error(`No campaign with id ${id}`);
    this.file.rewrite((c) => (c.id === id ? null : c));
  }
}

/**
 * Deletes a campaign with everything of it that was not acted on. Posts that were shared or
 * scheduled and site tasks that were done are kept as a record.
 */
export function deleteCampaign(deps: { campaigns: CampaignStore; drafts: DraftStore; recommendations: RecommendationStore }, id: string) {
  deps.campaigns.remove(id);
  return { posts: deps.drafts.releaseCampaign(id), tasks: deps.recommendations.releaseCampaign(id) };
}

export const CampaignInputSchema = z.object({
  brief: z.string().trim().min(10, "Describe the campaign in at least a sentence").max(4000),
  startsOn: z.iso.date(),
  weeks: z.number().int().min(1).max(12),
  materials: z.array(z.string()).max(12).default([]),
});
export type CampaignInput = z.infer<typeof CampaignInputSchema>;

export interface CampaignDeps extends AgentDeps {
  campaigns: CampaignStore;
  recommendations: RecommendationStore;
  materialsDir: string;
  /** Origin of the watched site, when one is configured; lets the agent read its pages. */
  siteOrigin: string | null;
}

export function buildCampaignSystemPrompt(brand: Brand, skills: Skill[]): string {
  return `You are the marketing lead for ${brand.name}, working with its founder, who builds the product alone. The founder gives you a brief; you turn it into a campaign they can run by themselves: one goal, one message, a schedule, and every post written out in full.

# Brand

${renderBrand(brand)}

# How to work

Load the campaign-plan skill first, then social-post before you write posts, and any other skill that fits the brief.

Check what already exists with list_drafts and list_recommendations: posts already shared or waiting, and reasons the founder gave for rejecting or dismissing things. Build on that rather than repeating it.

When the brief comes with materials (catalogs, one-pagers, screenshots), read every one with read_material before you plan. They are the substance of the campaign: what each one covers decides the order and the angle. A claim in a post must come from a material, the brand description above, a page you read, or research you did in this session.

Define the campaign once with define_campaign before saving anything else. Then write every post with save_draft, scheduled inside the campaign's dates. When a post announces or draws on a material, name that file in the post's attachment so the founder knows what to share with it. Posts go to a review queue; you do not publish, and the founder may post them by hand.

If the campaign needs something on the site that is not there yet (a page for the thing being announced, a download link, a tracked link), save it with save_recommendation, with a prompt for the coding agent as usual. Keep these to what the campaign depends on.

For an email, save a draft with platform "email": the subject on the first line, a blank line, then the body.

Available skills:

${renderSkillIndex(skills) || "(none installed)"}

# Language

The founder reads ${brand.language}. Write the campaign definition, every post, every recommendation and your closing note in ${brand.language}. Keep file names, URLs and quoted text as they are.

# When you finish

Reply with a note to the founder of at most about 150 words. The plan, the schedule and the posts are already on the page next to it, so do not retell them. Say only what the page does not: first, in a sentence or two, the idea behind the order you chose; then what the founder must prepare, check or decide before the first post goes out, most urgent first, one short paragraph each. The note is shown as plain text, so write prose without Markdown: no headings, bullet lists or bold.`;
}

function buildCampaignTools(deps: CampaignDeps, input: CampaignInput, state: { campaign: Campaign | null }) {
  const defineCampaign = betaZodTool({
    name: "define_campaign",
    description: "Record the campaign's plan. Call exactly once, before saving any post or recommendation; they are filed under it.",
    inputSchema: z.object({
      name: z.string().min(1).max(80).describe("A short name the founder will recognise it by"),
      goal: z.string().min(1).describe("The one outcome the campaign should move, stated so that it could be checked afterwards"),
      message: z.string().min(1).describe("The single message every piece carries, in one or two sentences"),
      starts_on: z.iso.date().describe("First day, YYYY-MM-DD"),
      ends_on: z.iso.date().describe("Last day, YYYY-MM-DD"),
      phases: z
        .array(z.object({ title: z.string().min(1), from: z.iso.date(), to: z.iso.date(), focus: z.string().min(1).describe("What this stretch is for and what goes out in it") }))
        .min(1)
        .max(8),
    }),
    run: (plan) => {
      if (state.campaign) return `Error: the campaign is already defined (id ${state.campaign.id}). Carry on with the posts.`;
      if (plan.ends_on < plan.starts_on) return "Error: ends_on is before starts_on.";
      state.campaign = deps.campaigns.create({
        status: "active",
        name: plan.name,
        brief: input.brief,
        goal: plan.goal,
        message: plan.message,
        startsOn: plan.starts_on,
        endsOn: plan.ends_on,
        phases: plan.phases,
        materials: input.materials,
        summary: "",
        draftIds: [],
        recommendationIds: [],
        complete: false,
      });
      return JSON.stringify({ id: state.campaign.id });
    },
  });

  const readMaterial = betaZodTool({
    name: "read_material",
    description: "Read one of the campaign's materials in full: a PDF comes back as a document, an image as an image, a text file as text.",
    inputSchema: z.object({ name: z.string().describe("File name from the materials list in the brief") }),
    run: ({ name }) => {
      // Only names from the selected list are read, so the name can never point outside the folder.
      if (!input.materials.includes(name)) return `Error: "${name}" is not one of this campaign's materials: ${input.materials.join(", ") || "none"}.`;
      const file = path.join(deps.materialsDir, name);
      const type = KINDS[path.extname(name).toLowerCase()]!;
      const size = fs.statSync(file).size;
      if (size > MAX_MATERIAL_BYTES) return `Error: ${name} is ${Math.round(size / 1024 / 1024)} MB; files over 20 MB cannot be read.`;
      if (type.kind === "text") {
        const text = fs.readFileSync(file, "utf8");
        return text.length > 200_000 ? `${text.slice(0, 200_000)}\n[truncated]` : text;
      }
      const data = fs.readFileSync(file).toString("base64");
      if (type.kind === "pdf") {
        return [{ type: "document" as const, title: name, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }];
      }
      return [{ type: "image" as const, source: { type: "base64" as const, media_type: type.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data } }];
    },
  });

  return input.materials.length ? [defineCampaign, readMaterial] : [defineCampaign];
}

/** Plans one campaign from a brief. Posts and site tasks are saved as the agent works. */
export async function runCampaign(rawInput: unknown, deps: CampaignDeps): Promise<Campaign> {
  const input = CampaignInputSchema.parse(rawInput);
  const available = listMaterials(deps.materialsDir);
  const unknown = input.materials.filter((name) => !available.some((m) => m.name === name));
  if (unknown.length) throw new Error(`Not in the materials folder: ${unknown.join(", ")}`);

  const state: { campaign: Campaign | null } = { campaign: null };
  const draftIds: string[] = [];
  const recommendationIds: string[] = [];
  const campaignId = () => state.campaign?.id ?? null;
  const ends = new Date(`${input.startsOn}T00:00:00Z`);
  ends.setUTCDate(ends.getUTCDate() + input.weeks * 7 - 1);

  const materials = available.filter((m) => input.materials.includes(m.name));
  const user = [
    `Brief from the founder:\n${input.brief}`,
    `Window: ${input.weeks} week(s), from ${input.startsOn} to ${ends.toISOString().slice(0, 10)}.`,
    materials.length
      ? `Materials (read each with read_material):\n${materials.map((m) => `- ${m.name} (${m.kind}, ${Math.max(1, Math.round(m.bytes / 1024))} KB)`).join("\n")}`
      : "No materials were attached to this brief.",
    deps.siteOrigin ? `The site is ${deps.siteOrigin}; you can read its pages with fetch_page.` : "No site is configured, so pages cannot be read.",
  ].join("\n\n");

  const result = await runLoop(deps, {
    system: buildCampaignSystemPrompt(deps.brand, deps.skills),
    tools: [
      ...buildCampaignTools(deps, input, state),
      ...buildSiteTools(deps, deps.siteOrigin, recommendationIds, campaignId),
      ...buildTools(deps, draftIds, { id: campaignId, materials: input.materials }),
    ],
    user,
  });

  if (!state.campaign) {
    throw new Error(
      result.stopReason === "end_turn" ? `The agent did not define a campaign. Its reply: ${result.text.slice(0, 500)}` : `Planning stopped early (${result.stopReason}) before the campaign was defined.`,
    );
  }
  return deps.campaigns.update(state.campaign.id, { summary: result.text, draftIds, recommendationIds, usage: result.usage, complete: result.stopReason === "end_turn" });
}
