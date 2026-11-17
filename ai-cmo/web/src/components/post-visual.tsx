import { Check, Copy, Download } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { Draft } from "@/lib/api"

/** The image that goes with a post: a preview, a download, and the screenshot request when one is still needed. */
export function PostVisual({ draft }: { draft: Draft }) {
  const [copied, setCopied] = useState(false)
  const visual = draft.visual
  if (!visual) return null
  const waiting = visual.kind === "screenshot" && draft.screenshotReady === false
  // The address changes once the screenshot arrives, so the browser fetches the finished image.
  const src = `/api/drafts/${draft.id}/visual.png?ready=${draft.screenshotReady ? 1 : 0}`

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(visual?.screenshot?.prompt ?? "")
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Kopyalanamadı. Metni seçip elle kopyalayın.")
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-lg border bg-background p-3">
      <img src={src} alt={`Gönderi görseli: ${visual.headline}`} width={176} height={176} loading="lazy" className="size-44 shrink-0 rounded-md border" />
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        {waiting ? (
          <>
            <p className="font-medium">Bu görsel için ekran görüntüsü gerekiyor</p>
            <p className="text-muted-foreground">
              Aşağıdaki isteği uygulamayı geliştiren kod ajanınıza verin. Çıkan dosyayı <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{visual.screenshot?.file}</code> adıyla{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">materials</code> klasörüne koyun; görsel kendiliğinden tamamlanır.
            </p>
            <pre className="max-h-32 overflow-y-auto rounded-md bg-card p-2.5 font-sans text-xs break-words whitespace-pre-wrap">{visual.screenshot?.prompt}</pre>
            <Button size="sm" variant="outline" onClick={copyPrompt}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Kopyalandı" : "Ekran görüntüsü isteğini kopyala"}
            </Button>
          </>
        ) : (
          <>
            <p className="font-medium">Gönderiyle paylaşılacak görsel</p>
            <p className="text-muted-foreground">1200 x 1200 piksel, PNG. Renkler ve logo brand.json dosyasındaki “visual” bölümünden gelir.</p>
            <Button size="sm" variant="outline" asChild>
              <a href={src} download={`gonderi-${draft.id}.png`}>
                <Download />
                Görseli indir
              </a>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
