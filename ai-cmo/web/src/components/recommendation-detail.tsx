import { Check, Copy } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ReasonForm } from "@/components/reason-form"
import { AreaTag, PriorityDot } from "@/components/tags"
import { Button } from "@/components/ui/button"
import type { Recommendation } from "@/lib/api"
import { PRIORITY, REC_STATUS, day } from "@/lib/tr"

export function RecommendationDetail({ rec, onDecide }: { rec: Recommendation; onDecide: (status: Recommendation["status"], reason?: string) => void }) {
  const [dismissing, setDismissing] = useState(false)
  const [copied, setCopied] = useState(false)
  const open = rec.status === "open"

  async function copyPrompt() {
    if (!rec.agentPrompt) return
    try {
      await navigator.clipboard.writeText(rec.agentPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Kopyalanamadı. Prompt metnini seçip elle kopyalayın.")
    }
  }

  return (
    <article className="space-y-5">
      <header className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <PriorityDot priority={rec.priority} />
          <span>{PRIORITY[rec.priority].short} öncelik</span>
          <AreaTag area={rec.area} />
          <span>{day(rec.createdAt)}</span>
          {!open && (
            <span className="font-medium text-foreground">
              {REC_STATUS[rec.status]}
              {rec.dismissReason ? `: ${rec.dismissReason}` : ""}
            </span>
          )}
        </div>
        <h2 className="font-display text-2xl leading-tight font-semibold">{rec.title}</h2>
      </header>

      <section>
        <h3 className="text-sm font-semibold text-muted-foreground">Neden önemli</h3>
        <p className="mt-1">{rec.why}</p>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-muted-foreground">Ne değişecek</h3>
        <p className="mt-1 break-words whitespace-pre-wrap">{rec.action}</p>
      </section>

      {rec.evidence.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground">Dayanak</h3>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm break-all">
            {rec.evidence.map((e) =>
              /^https?:\/\//.test(e) ? (
                <a key={e} href={e} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                  {e.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                <code key={e} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {e}
                </code>
              ),
            )}
          </p>
        </section>
      )}

      {rec.agentPrompt && (
        <section className="overflow-hidden rounded-xl bg-ink text-ink-foreground">
          <div className="flex items-center justify-between gap-3 border-b border-ink-raised px-4 py-2.5">
            <h3 className="text-sm font-semibold">Kod ajanı için prompt</h3>
            <Button size="sm" onClick={copyPrompt} className="bg-signal text-[#1a1d05] hover:bg-signal/85">
              {copied ? <Check /> : <Copy />}
              {copied ? "Kopyalandı" : "Promptu kopyala"}
            </Button>
          </div>
          <pre className="max-h-80 overflow-y-auto px-4 py-3.5 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-foreground/90">{rec.agentPrompt}</pre>
        </section>
      )}

      {dismissing ? (
        <ReasonForm
          placeholder="Neden yapılmayacak? Sonraki kontrol bunu dikkate alır"
          submitLabel="Kapat"
          onSubmit={(reason) => {
            setDismissing(false)
            onDecide("dismissed", reason)
          }}
          onCancel={() => setDismissing(false)}
        />
      ) : open ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onDecide("done")}>
            <Check />
            Yapıldı olarak işaretle
          </Button>
          <Button variant="outline" onClick={() => setDismissing(true)}>
            Yapılmayacak
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => onDecide("open")}>
          Yeniden aç
        </Button>
      )}
    </article>
  )
}
