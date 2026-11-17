import { RefreshCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { PostCard } from "@/components/post-card"
import { AREA_LABEL, RecommendationCard } from "@/components/recommendation-card"
import { RunCard } from "@/components/run-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { type DeskState, type Recommendation, ago, call } from "@/lib/api"

const PRIORITIES = [
  { key: "high", label: "Do first", color: "text-priority-high" },
  { key: "medium", label: "Worth doing", color: "text-priority-medium" },
  { key: "low", label: "When there is time", color: "text-priority-low" },
] as const

function Empty({ children }: { children: string }) {
  return <p className="max-w-[36em] py-7 text-muted-foreground">{children}</p>
}

function TabLabel({ label, count }: { label: string; count?: number }) {
  return (
    <>
      {label}
      {count ? <span className="font-normal text-muted-foreground">{count}</span> : null}
    </>
  )
}

export default function App() {
  const [state, setState] = useState<DeskState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [area, setArea] = useState<"all" | Recommendation["area"]>("all")
  const [showClosed, setShowClosed] = useState(false)
  const busyRef = useRef(false)

  const run = useCallback(async (path: string, body?: unknown) => {
    busyRef.current = true
    setBusy(true)
    try {
      setState(await call(path, body))
      setLoadError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // A failed action leaves the page as it was; a failed first load has nothing to show.
      if (body === undefined) setLoadError(message)
      else toast.error(message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void run("/api/state")
    const onFocus = () => !busyRef.current && void run("/api/state")
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [run])

  // While a check runs on the server, poll for its result.
  const checking = state?.review.running ?? false
  useEffect(() => {
    if (!checking) return
    const timer = setInterval(() => !busyRef.current && void run("/api/state"), 4000)
    return () => clearInterval(timer)
  }, [checking, run])

  if (!state) {
    return <main className="mx-auto max-w-[860px] px-5 py-10">{loadError ? <Empty>{`Could not load: ${loadError}`}</Empty> : <Empty>Loading…</Empty>}</main>
  }

  const last = state.runs[0]
  const geo = last?.sources?.find((s) => s.ok && s.score != null)
  const openCount = state.recommendations.filter((r) => r.status === "open").length
  const pendingCount = state.drafts.filter((d) => d.status === "pending").length
  const visible = state.recommendations.filter((r) => (showClosed || r.status === "open") && (area === "all" || r.area === area))

  return (
    <main className="mx-auto max-w-[860px] px-5 pt-10 pb-24">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[15px] font-semibold">{state.site ? state.site.replace(/^https?:\/\//, "") : "Growth desk"}</h1>
          <p className="text-sm text-muted-foreground">
            {checking ? "Checking the site and recent commits…" : last ? `Last checked ${ago(last.at)}` : "Not checked yet"}
            {!checking && geo ? `. AI readiness ${geo.score}/100` : ""}
          </p>
        </div>
        <Button variant="outline" className="bg-card" disabled={!state.canReview || checking || busy} onClick={() => run("/api/review", {})}>
          <RefreshCw className={checking ? "animate-spin" : undefined} />
          {checking ? "Checking…" : "Check now"}
        </Button>
      </header>

      <section className="mt-7 mb-9 space-y-3">
        {last ? (
          last.summary.split(/\n{2,}/).map((paragraph, i) => (
            <p key={i} className="max-w-[34em] text-[22px] leading-[1.4] font-medium tracking-[-0.01em] whitespace-pre-wrap max-sm:text-[19px]">
              {paragraph}
            </p>
          ))
        ) : (
          <p className="max-w-[34em] text-muted-foreground">After each check, a short note on what changed and what to do first appears here.</p>
        )}
        {state.review.error && (
          <Alert variant="destructive" className="bg-card">
            <AlertTitle>The last check failed</AlertTitle>
            <AlertDescription>{state.review.error}</AlertDescription>
          </Alert>
        )}
      </section>

      <Tabs defaultValue="todo" className="gap-5">
        <TabsList>
          <TabsTrigger value="todo">
            <TabLabel label="To do" count={openCount} />
          </TabsTrigger>
          <TabsTrigger value="posts">
            <TabLabel label="Posts to review" count={pendingCount} />
          </TabsTrigger>
          <TabsTrigger value="changes">What changed</TabsTrigger>
        </TabsList>

        <TabsContent value="todo">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup type="single" variant="outline" size="sm" value={area} onValueChange={(v) => v && setArea(v as typeof area)} aria-label="Filter by area" className="bg-card">
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              {Object.entries(AREA_LABEL).map(([key, label]) => (
                <ToggleGroupItem key={key} value={key}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={showClosed} onCheckedChange={(v) => setShowClosed(v === true)} className="bg-card" />
              Show done and dismissed
            </label>
          </div>
          {visible.length === 0 ? (
            <Empty>
              {state.recommendations.length
                ? "Nothing open here. New recommendations appear after the next check."
                : state.canReview
                  ? "No recommendations yet. Check the site to get the first list."
                  : "Copy watch.example.json to watch.json, set your site and repos, then restart."}
            </Empty>
          ) : (
            PRIORITIES.map(({ key, label, color }) => {
              const items = visible.filter((r) => r.priority === key)
              if (!items.length) return null
              return (
                <section key={key}>
                  <h2 className={`mt-7 mb-2 flex items-center gap-2 text-sm font-semibold ${color}`}>
                    <span className="size-2 rounded-full bg-current" />
                    {label}
                  </h2>
                  <div className="space-y-2.5">
                    {items.map((rec) => (
                      <RecommendationCard key={rec.id} rec={rec} onDecide={(status, reason) => run(`/api/recommendations/${rec.id}`, { status, reason })} />
                    ))}
                  </div>
                </section>
              )
            })
          )}
        </TabsContent>

        <TabsContent value="posts" className="space-y-2.5">
          {state.drafts.length === 0 ? (
            <Empty>No posts yet. When a check finds something worth announcing, the post appears here for you to approve.</Empty>
          ) : (
            <>
              {!state.canPublish && <p className="text-sm text-muted-foreground">Publishing is off: add POSTIZ_API_KEY to .env to approve posts.</p>}
              {state.drafts.map((draft) => (
                <PostCard
                  key={draft.id}
                  draft={draft}
                  canPublish={state.canPublish}
                  onApprove={(now) => run(`/api/drafts/${draft.id}/approve`, { now })}
                  onReject={(reason) => run(`/api/drafts/${draft.id}/reject`, { reason })}
                />
              ))}
            </>
          )}
        </TabsContent>

        <TabsContent value="changes" className="space-y-2.5">
          {state.runs.length === 0 ? <Empty>No checks have run yet.</Empty> : state.runs.map((r) => <RunCard key={r.at} run={r} />)}
        </TabsContent>
      </Tabs>
      <Toaster />
    </main>
  )
}
