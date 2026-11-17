import { JsonList, newId } from "./store.ts";
import type { Visual } from "./visual.ts";

/** `shared` means the person posted it by hand, outside Postiz. */
export type DraftStatus = "pending" | "scheduled" | "shared" | "rejected";
export const DRAFT_STATUSES = ["pending", "scheduled", "shared", "rejected"] as const satisfies readonly DraftStatus[];

export interface Draft {
  id: string;
  status: DraftStatus;
  /** Platform identifier, e.g. "linkedin", "x". */
  platform: string;
  /** Postiz integration (connected channel) id, when one was chosen. */
  integrationId?: string;
  content: string;
  /** ISO 8601 time the post should go out. */
  scheduledAt: string;
  /** Why this post, for the person approving it. */
  rationale: string;
  /** Provider-specific Postiz settings. */
  settings?: Record<string, unknown>;
  createdAt: string;
  decidedAt?: string;
  rejectionReason?: string;
  /** Result returned by Postiz when the draft was sent. */
  postiz?: unknown;
  /** The campaign this post belongs to, when it was written as part of one. */
  campaignId?: string;
  /** File in the materials folder to attach when sharing, e.g. a catalog. */
  attachment?: string;
  /** The text before the last revision or edit, kept so that change can be undone. */
  previousContent?: string;
  /** The image to share with the post, rendered on demand from this description. */
  visual?: Visual;
}

export type NewDraft = Pick<Draft, "platform" | "integrationId" | "content" | "scheduledAt" | "rationale" | "settings" | "campaignId" | "attachment" | "visual">;

/** The review queue of posts. */
export class DraftStore {
  private readonly file: JsonList<Draft>;

  constructor(file: string) {
    this.file = new JsonList(file);
  }

  list(status?: DraftStatus): Draft[] {
    const all = this.read();
    return status ? all.filter((d) => d.status === status) : all;
  }

  get(id: string): Draft {
    const draft = this.read().find((d) => d.id === id);
    if (!draft) throw new Error(`No draft with id ${id}`);
    return draft;
  }

  create(input: NewDraft): Draft {
    const all = this.read();
    const draft: Draft = { ...input, id: newId(all), status: "pending", createdAt: new Date().toISOString() };
    this.write([...all, draft]);
    return draft;
  }

  update(id: string, patch: Partial<Omit<Draft, "id">>): Draft {
    const all = this.read();
    const index = all.findIndex((d) => d.id === id);
    if (index === -1) throw new Error(`No draft with id ${id}`);
    const updated = { ...all[index]!, ...patch };
    all[index] = updated;
    this.write(all);
    return updated;
  }

  /**
   * Removes a deleted campaign's posts that nobody acted on (waiting or rejected). Posts that went
   * out stay as a record, no longer tied to the campaign. Returns how many were removed.
   */
  releaseCampaign(campaignId: string): number {
    let removed = 0;
    this.file.rewrite((draft) => {
      if (draft.campaignId !== campaignId) return draft;
      if (draft.status === "pending" || draft.status === "rejected") {
        removed++;
        return null;
      }
      const { campaignId: _, ...kept } = draft;
      return kept;
    });
    return removed;
  }

  private read(): Draft[] {
    return this.file.read();
  }

  private write(drafts: Draft[]): void {
    this.file.write(drafts);
  }
}
