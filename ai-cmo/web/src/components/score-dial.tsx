import { bandName } from "@/lib/tr"

const R = 52
const ARC = Math.PI * R // length of the half circle

/**
 * The AI-readiness score as a half-circle gauge, with the scores of earlier checks as a trend line.
 * It sits on the dark surface in both themes; this is the one loud element on the page.
 */
export function ScoreDial({ score, band, history }: { score: number | null; band?: string; history: number[] }) {
  const value = score ?? 0
  // The trend is drawn over the range the scores actually cover, so small moves stay visible.
  const low = Math.min(...history)
  const span = Math.max(Math.max(...history) - low, 1)
  const points = history.length > 1 ? history.map((s, i) => `${(i / (history.length - 1)) * 96 + 2},${25 - ((s - low) / span) * 22}`).join(" ") : null
  const previous = history.length > 1 ? history[history.length - 2]! : null
  const delta = score != null && previous != null ? score - previous : null

  return (
    <div className="flex h-full items-center gap-5 rounded-xl bg-ink p-5 text-ink-foreground">
      <svg viewBox="0 0 120 68" className="w-36 shrink-0" role="img" aria-label={score == null ? "AI hazırlık puanı yok" : `AI hazırlık puanı 100 üzerinden ${score}`}>
        <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke="var(--ink-raised)" strokeWidth="10" strokeLinecap="round" />
        {score != null && (
          <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke="var(--signal)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(value / 100) * ARC} ${ARC}`} />
        )}
        <text x="60" y="58" textAnchor="middle" className="fill-current font-display text-[30px] font-bold">
          {score ?? "–"}
        </text>
      </svg>
      <div className="min-w-0">
        <p className="text-sm text-ink-muted">AI hazırlık puanı</p>
        {score == null ? (
          <p className="mt-1 text-sm">Henüz ölçülmedi. İlk kontrolden sonra burada görünür.</p>
        ) : (
          <>
            <p className="font-display text-xl font-semibold">
              {bandName(band) || "100 üzerinden"}
              {delta != null && delta !== 0 && <span className={`ml-2 text-sm font-medium ${delta > 0 ? "text-signal" : "text-[#ff8fa3]"}`}>{delta > 0 ? `+${delta}` : delta}</span>}
            </p>
            {points ? (
              <svg viewBox="0 0 100 28" className="mt-2 h-7 w-28" aria-hidden="true">
                <polyline points={points} fill="none" stroke="var(--signal)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">Eğilim ikinci kontrolden sonra çizilir.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
