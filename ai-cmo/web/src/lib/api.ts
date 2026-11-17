import type { Draft } from "../../../src/drafts.ts"
import type { Recommendation } from "../../../src/recommendations.ts"
import type { Run } from "../../../src/review.ts"

export type { Draft, Recommendation, Run }

export interface DeskState {
  site: string | null
  /** True when the server asks for a password, so a sign-out control makes sense. */
  authEnabled: boolean
  canPublish: boolean
  canReview: boolean
  review: { running: boolean; error: string | null }
  recommendations: Recommendation[]
  drafts: Draft[]
  runs: Run[]
}

/** The server wants a password before it answers. */
export class SignInRequired extends Error {
  constructor(readonly retryAfterSeconds?: number) {
    super("Sign in required")
  }
}

/** GET when `body` is omitted, POST otherwise. Every endpoint answers with the full state. */
export async function call(path: string, body?: unknown): Promise<DeskState> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const json = (await res.json()) as DeskState | { error: string; retryAfterSeconds?: number }
  if (res.status === 401) throw new SignInRequired("error" in json ? json.retryAfterSeconds : undefined)
  if (!res.ok || "error" in json) throw new Error("error" in json ? json.error : `Request failed (${res.status})`)
  return json
}
