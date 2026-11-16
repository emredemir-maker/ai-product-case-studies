import type { Draft, DraftStore } from "./drafts.ts";
import type { PostizClient } from "./postiz.ts";

export interface ApproveOptions {
  /** Publish immediately instead of at the draft's scheduled time. */
  now?: boolean;
  /** Override the scheduled time (ISO 8601). */
  at?: string;
  /** Use this Postiz channel instead of the one on the draft. */
  integrationId?: string;
}

/**
 * The only path from a draft to a published post. It is called from the CLI by a person;
 * the agent has no tool that reaches it.
 */
export async function approveDraft(
  store: DraftStore,
  postiz: PostizClient | null,
  id: string,
  options: ApproveOptions = {},
): Promise<Draft> {
  const draft = store.get(id);
  if (draft.status !== "pending") throw new Error(`Draft ${id} is ${draft.status}, not pending`);
  if (!postiz) throw new Error("Postiz is not configured. Set POSTIZ_API_KEY (and POSTIZ_API_URL) to publish.");

  const date = options.now ? new Date() : new Date(options.at ?? draft.scheduledAt);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${options.at ?? draft.scheduledAt}`);
  if (!options.now && date.getTime() <= Date.now()) {
    throw new Error(`Scheduled time ${date.toISOString()} is in the past. Pass --now or --at <ISO date>.`);
  }

  const integrations = (await postiz.listIntegrations()).filter((i) => !i.disabled);
  const wanted = options.integrationId ?? draft.integrationId;
  let channel = wanted ? integrations.find((i) => i.id === wanted) : undefined;
  if (wanted && !channel) throw new Error(`Postiz channel ${wanted} is not connected or is disabled`);
  if (!channel) {
    const matches = integrations.filter((i) => i.identifier === draft.platform);
    if (matches.length !== 1) {
      throw new Error(
        `Draft ${id} has no channel and ${matches.length} connected "${draft.platform}" channels match. Pass --channel <id> (see: cmo channels).`,
      );
    }
    channel = matches[0]!;
  }

  const result = await postiz.createPost({
    type: options.now ? "now" : "schedule",
    date: date.toISOString(),
    integrationId: channel.id,
    identifier: channel.identifier,
    content: draft.content,
    settings: draft.settings,
  });

  return store.update(id, {
    status: "scheduled",
    integrationId: channel.id,
    scheduledAt: date.toISOString(),
    decidedAt: new Date().toISOString(),
    postiz: result,
  });
}

export function rejectDraft(store: DraftStore, id: string, reason?: string): Draft {
  const draft = store.get(id);
  if (draft.status !== "pending") throw new Error(`Draft ${id} is ${draft.status}, not pending`);
  return store.update(id, { status: "rejected", rejectionReason: reason, decidedAt: new Date().toISOString() });
}
