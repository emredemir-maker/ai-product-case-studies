import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { type AgentDeps, runLoop } from "./agent.ts";
import { type Brand, renderBrand } from "./brand.ts";
import type { Usage } from "./pricing.ts";
import { type Skill, readSkill } from "./skills.ts";
import { VisualSchema } from "./visual.ts";

export interface VisualsResult {
  /** Drafts that were given an image. */
  draftIds: string[];
  summary: string;
  usage: Usage;
}

function buildPrompt(brand: Brand, skills: Skill[]): string {
  const socialPost = skills.find((s) => s.name === "social-post");
  return `You are the marketing lead for ${brand.name}. Posts are waiting in the review queue without images. For each one, decide whether an image would help and, if so, describe it with set_draft_visual. Leave a post without an image when it reads better alone.

# Brand

${renderBrand(brand)}

# How images work

${socialPost ? readSkill(socialPost) : "Images are drawn from fixed branded layouts: stat, statement or screenshot."}

# Language

Write the words on the image and the screenshot prompt in ${brand.language}.

# When you finish

Reply in one or two sentences, in ${brand.language}: how many posts got an image, and which screenshots the founder needs to request. Plain text, no Markdown.`;
}

/** Adds images to pending posts that have none. The posts themselves are not changed. */
export async function runVisuals(deps: AgentDeps): Promise<VisualsResult> {
  const pending = deps.drafts.list("pending").filter((d) => !d.visual && d.platform !== "email");
  if (!pending.length) return { draftIds: [], summary: "", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, models: [], costUsd: 0 } };

  const draftIds: string[] = [];
  const setVisual = betaZodTool({
    name: "set_draft_visual",
    description: "Attach an image description to one waiting post. Call once per post that should have an image.",
    inputSchema: z.object({ draft_id: z.string().describe("Id of the post, from the list in the request"), visual: VisualSchema }),
    run: ({ draft_id, visual }) => {
      if (!pending.some((d) => d.id === draft_id)) return `Error: ${draft_id} is not one of the posts in this request.`;
      deps.drafts.update(draft_id, { visual });
      if (!draftIds.includes(draft_id)) draftIds.push(draft_id);
      return "Saved.";
    },
  });

  const result = await runLoop(
    // Images are written from the posts alone; searching the web would add cost and nothing else.
    { ...deps, config: { ...deps.config, webSearch: false } },
    {
      system: buildPrompt(deps.brand, deps.skills),
      tools: [setVisual],
      user: `Posts waiting without an image:\n\n${pending.map((d) => `id: ${d.id}\nplatform: ${d.platform}\n${d.attachment ? `shared with file: ${d.attachment}\n` : ""}text:\n${d.content}`).join("\n\n---\n\n")}`,
    },
  );
  return { draftIds, summary: result.text, usage: result.usage };
}
