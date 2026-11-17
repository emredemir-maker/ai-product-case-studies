import { Check, ChevronRight, Copy } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ReasonForm } from "@/components/reason-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { type Recommendation, capitalize, day } from "@/lib/api"

export const AREA_LABEL: Record<Recommendation["area"], string> = { seo: "SEO", geo: "GEO", plg: "PLG", content: "Content" }

export function RecommendationCard({ rec, onDecide }: { rec: Recommendation; onDecide: (status: Recommendation["status"], reason?: string) => void }) {
  const [dismissing, setDismissing] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const open = rec.status === "open"

  async function copyPrompt() {
    if (!rec.agentPrompt) return
    try {
      await navigator.clipboard.writeText(rec.agentPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setPromptOpen(true)
      toast.error("Could not copy. The prompt is shown on the card; select and copy it.")
    }
  }

  return (
    <Card className={open ? "gap-4" : "gap-4 opacity-60"}>
      <CardHeader>
        <CardTitle className="text-lg leading-snug">{rec.title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{AREA_LABEL[rec.area]}</Badge>
          <span>Added {day(rec.createdAt)}</span>
          {!open && (
            <span className="font-medium">
              {capitalize(rec.status)}
              {rec.dismissReason ? `: ${rec.dismissReason}` : ""}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="max-w-[42em]">{rec.why}</p>
        <div className="max-w-[44em] border-l-[3px] border-primary pl-3.5">
          <p className="text-sm font-semibold text-muted-foreground">What to change</p>
          <p className="break-words whitespace-pre-wrap">{rec.action}</p>
        </div>
        {rec.evidence.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm break-all text-muted-foreground">
            {rec.evidence.map((e) =>
              /^https?:\/\//.test(e) ? (
                <a key={e} href={e} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                  {e.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                <code key={e} className="font-mono">
                  {e}
                </code>
              ),
            )}
          </p>
        )}
        {rec.agentPrompt && (
          <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
            <CollapsibleTrigger className="group flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
              Prompt for your coding agent
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-w-[46em] rounded-md bg-background p-3.5 font-sans text-sm break-words whitespace-pre-wrap">{rec.agentPrompt}</pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
      <CardFooter className="block">
        {dismissing ? (
          <ReasonForm
            placeholder="Why not? The next check takes this into account"
            submitLabel="Dismiss"
            onSubmit={(reason) => {
              setDismissing(false)
              onDecide("dismissed", reason)
            }}
            onCancel={() => setDismissing(false)}
          />
        ) : open ? (
          <div className="flex flex-wrap gap-2">
            {rec.agentPrompt && (
              <Button onClick={copyPrompt}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy prompt"}
              </Button>
            )}
            <Button variant={rec.agentPrompt ? "outline" : "default"} onClick={() => onDecide("done")}>
              Mark done
            </Button>
            <Button variant="ghost" onClick={() => setDismissing(true)}>
              Dismiss
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => onDecide("open")}>
            Reopen
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
