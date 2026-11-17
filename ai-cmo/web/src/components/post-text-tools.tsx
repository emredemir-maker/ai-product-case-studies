import { PencilLine, Undo2, WandSparkles } from "lucide-react"
import { useState } from "react"
import { ReasonForm } from "@/components/reason-form"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { Draft } from "@/lib/api"

type Mode = "idle" | "instructing" | "editing"

/**
 * Ways to change a waiting post's text: three rewrites by the agent (shorter, clearer, or as
 * instructed) and editing by hand. Every change keeps the previous text, so it can be undone.
 */
export function PostTextTools(props: { draft: Draft; canRevise: boolean; run: (path: string, body?: unknown) => Promise<void> }) {
  const { draft, canRevise, run } = props
  const [mode, setMode] = useState<Mode>("idle")
  const [working, setWorking] = useState<string | null>(null)
  const [text, setText] = useState(draft.content)

  async function send(label: string, action: "revise" | "edit" | "undo", body: unknown) {
    setWorking(label)
    try {
      await run(`/api/drafts/${draft.id}/${action}`, body)
      setMode("idle")
    } finally {
      setWorking(null)
    }
  }

  if (mode === "instructing") {
    return (
      <ReasonForm
        placeholder="Ne değişsin? Örn. son paragrafı çıkarın, açılışı soruyla başlatın"
        submitLabel={working ? "Yazılıyor…" : "Değiştir"}
        onSubmit={(instruction) => instruction && send("change", "revise", { mode: "change", instruction })}
        onCancel={() => setMode("idle")}
      />
    )
  }

  if (mode === "editing") {
    return (
      <div className="space-y-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(18, Math.max(6, text.split("\n").length + 2))} aria-label="Gönderi metni" className="bg-background" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={working !== null || !text.trim() || text.trim() === draft.content} onClick={() => send("edit", "edit", { content: text })}>
            Kaydet
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
            Vazgeç
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">{text.trim().length} karakter</span>
        </div>
      </div>
    )
  }

  const busy = working !== null
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground tabular-nums">{draft.content.length} karakter</span>
      {canRevise && (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => send("shorten", "revise", { mode: "shorten" })}>
            <WandSparkles />
            {working === "shorten" ? "Kısaltılıyor…" : "Kısalt"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => send("clarify", "revise", { mode: "clarify" })}>
            <WandSparkles />
            {working === "clarify" ? "Netleştiriliyor…" : "Netleştir"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode("instructing")}>
            <WandSparkles />
            Değiştir
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setText(draft.content)
          setMode("editing")
        }}
      >
        <PencilLine />
        Elle düzenle
      </Button>
      {draft.previousContent !== undefined && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => send("undo", "undo", {})}>
          <Undo2 />
          {working === "undo" ? "Geri alınıyor…" : `Önceki metne dön (${draft.previousContent.length} karakter)`}
        </Button>
      )}
    </div>
  )
}
