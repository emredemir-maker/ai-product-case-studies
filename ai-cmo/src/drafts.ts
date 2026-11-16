import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type DraftStatus = "pending" | "scheduled" | "rejected";

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
}

export type NewDraft = Pick<Draft, "platform" | "integrationId" | "content" | "scheduledAt" | "rationale" | "settings">;

/** JSON-file store for drafts. Single process; every write rewrites the file atomically. */
export class DraftStore {
  constructor(private readonly file: string) {}

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
    let id: string;
    do id = crypto.randomBytes(3).toString("hex");
    while (all.some((d) => d.id === id));
    const draft: Draft = { ...input, id, status: "pending", createdAt: new Date().toISOString() };
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

  private read(): Draft[] {
    if (!fs.existsSync(this.file)) return [];
    return JSON.parse(fs.readFileSync(this.file, "utf8")) as Draft[];
  }

  private write(drafts: Draft[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(drafts, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
