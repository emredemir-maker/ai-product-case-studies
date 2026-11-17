import { JsonList, newId } from "./store.ts";

export const AREAS = ["seo", "geo", "plg", "content"] as const;
export const PRIORITIES = ["high", "medium", "low"] as const;
export type RecommendationStatus = "open" | "done" | "dismissed";

export interface Recommendation {
  id: string;
  status: RecommendationStatus;
  area: (typeof AREAS)[number];
  priority: (typeof PRIORITIES)[number];
  title: string;
  /** What was observed and why it matters. */
  why: string;
  /** The concrete change to make. */
  action: string;
  /** Page URLs or commit hashes the recommendation rests on. */
  evidence: string[];
  /** A self-contained brief to paste into a coding agent that will make the change. */
  agentPrompt?: string;
  createdAt: string;
  decidedAt?: string;
  dismissReason?: string;
  /** The campaign this task prepares the site for, when it came out of campaign planning. */
  campaignId?: string;
}

export type NewRecommendation = Pick<Recommendation, "area" | "priority" | "title" | "why" | "action" | "evidence" | "agentPrompt" | "campaignId">;

export class RecommendationStore {
  private readonly file: JsonList<Recommendation>;

  constructor(file: string) {
    this.file = new JsonList(file);
  }

  list(status?: RecommendationStatus): Recommendation[] {
    const all = this.file.read();
    return status ? all.filter((r) => r.status === status) : all;
  }

  create(input: NewRecommendation): Recommendation {
    const all = this.file.read();
    const rec: Recommendation = { ...input, id: newId(all), status: "open", createdAt: new Date().toISOString() };
    this.file.write([...all, rec]);
    return rec;
  }

  get(id: string): Recommendation {
    const rec = this.file.read().find((r) => r.id === id);
    if (!rec) throw new Error(`No recommendation with id ${id}`);
    return rec;
  }

  /** Removes a deleted campaign's site tasks that were not done; finished ones stay, no longer tied to it. */
  releaseCampaign(campaignId: string): number {
    let removed = 0;
    this.file.rewrite((rec) => {
      if (rec.campaignId !== campaignId) return rec;
      if (rec.status !== "done") {
        removed++;
        return null;
      }
      const { campaignId: _, ...kept } = rec;
      return kept;
    });
    return removed;
  }

  decide(id: string, status: RecommendationStatus, reason?: string): Recommendation {
    const all = this.file.read();
    const index = all.findIndex((r) => r.id === id);
    if (index === -1) throw new Error(`No recommendation with id ${id}`);
    const updated: Recommendation = {
      ...all[index]!,
      status,
      decidedAt: status === "open" ? undefined : new Date().toISOString(),
      dismissReason: status === "dismissed" ? reason : undefined,
    };
    all[index] = updated;
    this.file.write(all);
    return updated;
  }
}
