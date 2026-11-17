import type { Draft } from "../../../src/drafts.ts"
import type { Recommendation } from "../../../src/recommendations.ts"
import type { Run } from "../../../src/review.ts"

export type { Draft, Recommendation, Run }

export interface DeskState {
  site: string | null
  canPublish: boolean
  canReview: boolean
  review: { running: boolean; error: string | null }
  recommendations: Recommendation[]
  drafts: Draft[]
  runs: Run[]
}

/** GET when `body` is omitted, POST otherwise. Every endpoint answers with the full state. */
export async function call(path: string, body?: unknown): Promise<DeskState> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const json = (await res.json()) as DeskState | { error: string }
  if (!res.ok || "error" in json) throw new Error("error" in json ? json.error : `Request failed (${res.status})`)
  return json
}
