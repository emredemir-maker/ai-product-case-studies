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

export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })
export const dayTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

export function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`
  return `${Math.round(mins / 1440)} d ago`
}

const PLATFORM_NAMES: Record<string, string> = { linkedin: "LinkedIn", x: "X", youtube: "YouTube", tiktok: "TikTok" }
export const platformName = (id: string) => PLATFORM_NAMES[id] ?? capitalize(id)

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
