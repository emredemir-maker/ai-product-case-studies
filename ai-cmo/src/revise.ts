import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { type AgentDeps, runLoop } from "./agent.ts";
import { type Brand, renderBrand } from "./brand.ts";
import type { Draft } from "./drafts.ts";
import type { Usage } from "./pricing.ts";
import { type Skill, readSkill } from "./skills.ts";

export const REVISE_MODES = ["shorten", "clarify", "change"] as const;
export type ReviseMode = (typeof REVISE_MODES)[number];

const TASK: Record<ReviseMode, string> = {
  shorten:
    "Shorten the post to roughly half its length; for LinkedIn aim for 600 to 900 characters. Keep the opening line's claim, the one fact or example that carries the post, the source and scope of any number that stays, the call to action and its links, and the hashtags. Cut repetition, secondary examples and steps the reader does not need in order to act. Do not compress by dropping the words that make sentences readable.",
  clarify:
    "Make the post easier to read on first pass without making it longer. One idea per paragraph, the plain word over the technical one, the subject of each sentence stated. Where a sentence makes the reader work out what it refers to, say the thing. Keep every fact, number, source line, link and hashtag.",
  change: "Change the post as the founder asks below. Change what the request covers and leave the rest as it is.",
};

function buildPrompt(brand: Brand, skills: Skill[]): string {
  const socialPost = skills.find((s) => s.name === "social-post");
  return `You are the marketing lead for ${brand.name}. The founder is reviewing a post you wrote and wants one revision of it. Return the revised post with save_revision; the founder sees it in place of the current text and can undo it.

# Brand

${renderBrand(brand)}

# How posts are written

${socialPost ? readSkill(socialPost) : "Lead with a specific first line, one idea per paragraph, end on something usable."}

# Limits of a revision

You have the post and nothing else: no materials, no pages, no research. So every fact, number, name, date and link in the revision must already be in the post, or be given by the founder in the request. If the request needs a fact you do not have, make the rest of the change and leave that part as it was.

Write the post in ${brand.language}, in the brand's voice. Call save_revision once with the complete new text of the post, ready to publish, and nothing else in it.`;
}

export interface ReviseResult {
  draft: Draft;
  usage: Usage;
}

/** Rewrites one waiting post in place. The previous text is kept so the change can be undone. */
export async function reviseDraft(deps: AgentDeps, id: string, mode: ReviseMode, instruction?: string): Promise<ReviseResult> {
  const draft = deps.drafts.get(id);
  if (draft.status !== "pending") throw new Error(`Draft ${id} is ${draft.status}, not pending`);
  const request = instruction?.trim();
  if (mode === "change" && !request) throw new Error("Say what should change.");

  let revised: string | null = null;
  const saveRevision = betaZodTool({
    name: "save_revision",
    description: "Return the revised post. Call exactly once.",
    inputSchema: z.object({ content: z.string().min(1).describe("The complete revised post, exactly as it should be published") }),
    run: ({ content }) => {
      revised = content.trim();
      return "Saved.";
    },
  });

  const result = await runLoop(
    // A revision works from the post alone, so web search stays off.
    { ...deps, config: { ...deps.config, webSearch: false } },
    {
      system: buildPrompt(deps.brand, deps.skills),
      tools: [saveRevision],
      user: [
        `Task: ${TASK[mode]}`,
        request ? `The founder's request: ${request}` : null,
        `Platform: ${draft.platform}`,
        `Why the post was written: ${draft.rationale}`,
        `The post as it stands (${draft.content.length} characters):\n\n${draft.content}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  );
  if (!revised) throw new Error(`The post was not revised. ${result.text.slice(0, 300)}`.trim());
  if (revised === draft.content) throw new Error("The revision came back identical to the post.");
  return { draft: deps.drafts.update(id, { content: revised, previousContent: draft.content }), usage: result.usage };
}

/** Replaces a waiting post's text with the founder's own edit. */
export function editDraft(drafts: AgentDeps["drafts"], id: string, content: string): Draft {
  const draft = drafts.get(id);
  if (draft.status !== "pending") throw new Error(`Draft ${id} is ${draft.status}, not pending`);
  const text = content.trim();
  if (!text) throw new Error("The post cannot be empty.");
  if (text === draft.content) return draft;
  return drafts.update(id, { content: text, previousContent: draft.content });
}

/** Swaps a post back to the text it had before its last change; doing it again swaps forward. */
export function undoDraftChange(drafts: AgentDeps["drafts"], id: string): Draft {
  const draft = drafts.get(id);
  if (draft.status !== "pending") throw new Error(`Draft ${id} is ${draft.status}, not pending`);
  if (draft.previousContent === undefined) throw new Error("This post has no earlier version.");
  return drafts.update(id, { content: draft.previousContent, previousContent: draft.content });
}
