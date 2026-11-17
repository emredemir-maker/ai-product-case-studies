import type { Draft, Recommendation } from "@/lib/api"

/** Interface text and formatting, in Turkish. */

export const AREA: Record<Recommendation["area"], { label: string; color: string }> = {
  seo: { label: "SEO", color: "var(--area-seo)" },
  geo: { label: "GEO", color: "var(--area-geo)" },
  plg: { label: "PLG", color: "var(--area-plg)" },
  content: { label: "İçerik", color: "var(--area-content)" },
}

export const PRIORITY: Record<Recommendation["priority"], { label: string; short: string; color: string }> = {
  high: { label: "Önce bunlar", short: "Yüksek", color: "var(--priority-high)" },
  medium: { label: "Yapmaya değer", short: "Orta", color: "var(--priority-medium)" },
  low: { label: "Vakit olunca", short: "Düşük", color: "var(--priority-low)" },
}

export const REC_STATUS: Record<Recommendation["status"], string> = { open: "Açık", done: "Yapıldı", dismissed: "Kapatıldı" }
export const DRAFT_STATUS: Record<Draft["status"], string> = { pending: "Onay bekliyor", scheduled: "Zamanlandı", shared: "Elle paylaşıldı", rejected: "Reddedildi" }

/** GEO Optimizer's score bands. */
const BAND: Record<string, string> = { critical: "Kritik", foundation: "Temel", good: "İyi", excellent: "Mükemmel" }
export const bandName = (band?: string) => (band ? (BAND[band] ?? band) : "")

const DIFF_FIELD: Record<string, string> = {
  status: "durum kodu",
  title: "başlık",
  description: "açıklama",
  canonical: "canonical",
  h1: "H1",
  noindex: "noindex",
  schemaTypes: "yapısal veri",
  content: "içerik",
}
export const diffField = (field: string) => DIFF_FIELD[field] ?? field

const PLATFORM: Record<string, string> = { linkedin: "LinkedIn", x: "X", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", threads: "Threads", bluesky: "Bluesky" }
export const platformName = (id: string) => PLATFORM[id] ?? id.charAt(0).toLocaleUpperCase("tr") + id.slice(1)

export const day = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })
export const dayTime = (iso: string) => new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

/** Dollar amounts the Turkish way: "0,84 $". Small costs keep a third digit so they do not read as zero. */
export const usd = (amount: number) => `${amount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: amount < 0.1 ? 3 : 2 })} $`

export const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000).toLocaleString("tr-TR")} bin` : String(n))

export function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "az önce"
  if (mins < 60) return `${mins} dk önce`
  if (mins < 1440) return `${Math.round(mins / 60)} sa önce`
  return `${Math.round(mins / 1440)} gün önce`
}
