import { FileClock, ListChecks, LogOut, type LucideIcon, RefreshCw, Send, Sparkles, Terminal } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { LoginScreen } from "@/components/login-screen"
import { PostCard } from "@/components/post-card"
import { RecommendationDetail } from "@/components/recommendation-detail"
import { RunCard } from "@/components/run-card"
import { ScoreDial } from "@/components/score-dial"
import { AreaTag, PriorityDot } from "@/components/tags"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Toaster } from "@/components/ui/sonner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { type DeskState, type Recommendation, SignInRequired, call } from "@/lib/api"
import { AREA, PRIORITY, REC_STATUS, ago, day } from "@/lib/tr"
import { useMedia } from "@/lib/use-media"
import { cn } from "@/lib/utils"

type View = "todo" | "posts" | "changes"
const PRIORITY_ORDER = ["high", "medium", "low"] as const

function Empty({ children }: { children: ReactNode }) {
  return <p className="max-w-[38em] py-8 text-muted-foreground">{children}</p>
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col justify-between gap-2 rounded-xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

export default function App() {
  const [state, setState] = useState<DeskState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [signInRequired, setSignInRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>("todo")
  const [area, setArea] = useState<"all" | Recommendation["area"]>("all")
  const [showClosed, setShowClosed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const wide = useMedia("(min-width: 1024px)")
  const busyRef = useRef(false)

  const run = useCallback(async (path: string, body?: unknown) => {
    busyRef.current = true
    setBusy(true)
    try {
      setState(await call(path, body))
      setLoadError(null)
    } catch (error) {
      if (error instanceof SignInRequired) {
        // The session ended, or there never was one: show the sign-in screen.
        setState(null)
        setSignInRequired(true)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      // A failed action leaves the page as it was; a failed first load has nothing to show.
      if (body === undefined) setLoadError(message)
      else toast.error(message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {})
    setState(null)
    setSignInRequired(true)
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

  if (signInRequired && !state) {
    return (
      <LoginScreen
        onSignedIn={(next) => {
          setSignInRequired(false)
          setState(next)
        }}
      />
    )
  }

  if (!state) {
    return <main className="p-8">{loadError ? <Empty>Yüklenemedi: {loadError}</Empty> : <Empty>Yükleniyor…</Empty>}</main>
  }

  const last = state.runs[0]
  // Runs arrive newest first; the trend reads oldest to newest.
  const scores = state.runs.flatMap((r) => r.sources?.find((s) => s.ok && s.score != null)?.score ?? []).reverse()
  const band = last?.sources?.find((s) => s.ok && s.score != null)?.band
  const openRecs = state.recommendations.filter((r) => r.status === "open")
  const pendingCount = state.drafts.filter((d) => d.status === "pending").length
  const visible = state.recommendations.filter((r) => (showClosed || r.status === "open") && (area === "all" || r.area === area))
  const ordered = PRIORITY_ORDER.flatMap((p) => visible.filter((r) => r.priority === p))
  const selected = ordered.find((r) => r.id === selectedId) ?? ordered[0] ?? null
  const decide = (rec: Recommendation) => (status: Recommendation["status"], reason?: string) => run(`/api/recommendations/${rec.id}`, { status, reason })

  const nav: { id: View; label: string; icon: LucideIcon; count?: number }[] = [
    { id: "todo", label: "Öneriler", icon: ListChecks, count: openRecs.length },
    { id: "posts", label: "Gönderiler", icon: Send, count: pendingCount },
    { id: "changes", label: "Geçmiş", icon: FileClock },
  ]

  const checkButton = (
    <Button disabled={!state.canReview || checking || busy} onClick={() => run("/api/review", {})} className="w-full bg-signal text-[#1a1d05] hover:bg-signal/85">
      <RefreshCw className={checking ? "animate-spin" : undefined} />
      {checking ? "Kontrol ediliyor…" : "Şimdi kontrol et"}
    </Button>
  )

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="flex flex-col gap-6 bg-ink p-4 text-ink-foreground lg:sticky lg:top-0 lg:h-svh lg:p-5">
        <div className="flex items-center justify-between gap-3 lg:block">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-display text-lg font-bold">
              <Sparkles className="size-4.5 text-signal" />
              Büyüme Masası
            </p>
            <p className="mt-0.5 truncate text-sm text-ink-muted">{state.site ? state.site.replace(/^https?:\/\//, "") : "Site ayarlanmadı"}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1 lg:hidden">
            <div className="w-44">{checkButton}</div>
            {state.authEnabled && (
              <button type="button" onClick={signOut} aria-label="Çıkış yap" className="rounded-lg p-2 text-ink-muted outline-none hover:text-ink-foreground focus-visible:ring-2 focus-visible:ring-signal">
                <LogOut className="size-4" />
              </button>
            )}
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Bölümler">
          {nav.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-current={view === id ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-signal",
                view === id ? "bg-ink-raised text-ink-foreground" : "text-ink-muted hover:bg-ink-raised/60 hover:text-ink-foreground",
              )}
            >
              <Icon className={cn("size-4", view === id && "text-signal")} />
              <span className="lg:flex-1">{label}</span>
              {count ? <span className="rounded-full bg-ink-raised px-1.5 text-xs tabular-nums text-ink-foreground">{count}</span> : null}
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden space-y-2 lg:block">
          {checkButton}
          <p className="text-center text-xs text-ink-muted">{checking ? "Site ve son commit'ler inceleniyor" : last ? `Son kontrol ${ago(last.at)}` : "Henüz kontrol yapılmadı"}</p>
        </div>
        {state.authEnabled && (
          <button
            type="button"
            onClick={signOut}
            className="flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm text-ink-muted outline-none hover:bg-ink-raised/60 hover:text-ink-foreground focus-visible:ring-2 focus-visible:ring-signal max-lg:hidden"
          >
            <LogOut className="size-4" />
            Çıkış yap
          </button>
        )}
      </aside>

      <main className="min-w-0 space-y-6 p-4 pb-16 sm:p-6 lg:p-8">
        {state.review.error && (
          <Alert variant="destructive" className="bg-card">
            <AlertTitle>Son kontrol başarısız oldu</AlertTitle>
            <AlertDescription>{state.review.error}</AlertDescription>
          </Alert>
        )}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1fr_1fr]">
          <ScoreDial score={scores.at(-1) ?? null} band={band} history={scores} />
          <Stat label="Açık öneri">
            <p className="font-display text-4xl leading-none font-bold tabular-nums">{openRecs.length}</p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {PRIORITY_ORDER.map((p) => (
                <span key={p} className="flex items-center gap-1.5">
                  <PriorityDot priority={p} />
                  {openRecs.filter((r) => r.priority === p).length} {PRIORITY[p].short.toLocaleLowerCase("tr")}
                </span>
              ))}
            </p>
          </Stat>
          <Stat label="Onay bekleyen gönderi">
            <p className="font-display text-4xl leading-none font-bold tabular-nums">{pendingCount}</p>
            <p className="text-sm text-muted-foreground">{state.canPublish ? "Onayladığınızda Postiz'e gider" : "Yayınlama kapalı: Postiz anahtarı yok"}</p>
          </Stat>
          <Stat label="Son kontrol">
            <p className="font-display text-2xl leading-tight font-bold">{last ? ago(last.at) : "Yapılmadı"}</p>
            <p className="text-sm text-muted-foreground">{last ? `${last.pagesChecked} sayfa, ${last.commits.length} commit incelendi` : "İlk kontrol tüm siteyi yeni sayar"}</p>
          </Stat>
        </section>

        {view === "todo" && (
          <>
            {last?.summary && (
              <section className="rounded-xl border bg-card p-5">
                <h2 className="text-sm font-semibold text-muted-foreground">Son kontrolün özeti</h2>
                <p className="mt-1.5 max-w-[60em] whitespace-pre-wrap">{last.summary}</p>
              </section>
            )}
            <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <ToggleGroup type="single" variant="outline" size="sm" value={area} onValueChange={(v) => v && setArea(v as typeof area)} aria-label="Alana göre süz" className="bg-card">
                    <ToggleGroupItem value="all">Tümü</ToggleGroupItem>
                    {Object.entries(AREA).map(([key, { label }]) => (
                      <ToggleGroupItem key={key} value={key}>
                        {label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={showClosed} onCheckedChange={(v) => setShowClosed(v === true)} className="bg-card" />
                    Kapananları da göster
                  </label>
                </div>
                {ordered.length === 0 ? (
                  <Empty>
                    {state.recommendations.length
                      ? "Burada açık öneri yok. Yenileri bir sonraki kontrolden sonra görünür."
                      : state.canReview
                        ? "Henüz öneri yok. İlk listeyi almak için siteyi kontrol edin."
                        : "watch.example.json dosyasını watch.json olarak kopyalayın, sitenizi ve repolarınızı yazın, sonra yeniden başlatın."}
                  </Empty>
                ) : (
                  <ul className="overflow-hidden rounded-xl border bg-card">
                    {ordered.map((rec, i) => {
                      const firstOfGroup = i === 0 || ordered[i - 1]!.priority !== rec.priority
                      const active = selected?.id === rec.id
                      return (
                        <li key={rec.id} className={cn(i > 0 && "border-t")}>
                          {firstOfGroup && (
                            <p className="flex items-center gap-2 bg-muted/60 px-4 py-1.5 text-xs font-semibold" style={{ color: PRIORITY[rec.priority].color }}>
                              {PRIORITY[rec.priority].label}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(rec.id)
                              if (!wide) setSheetOpen(true)
                            }}
                            aria-current={active && wide ? "true" : undefined}
                            className={cn(
                              "flex w-full items-start gap-3 border-l-[3px] border-transparent px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/70",
                              active && wide && "border-primary bg-primary/[0.06] hover:bg-primary/[0.06]",
                              rec.status !== "open" && "opacity-55",
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 leading-snug font-medium">{rec.title}</span>
                              <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <AreaTag area={rec.area} />
                                <span>{day(rec.createdAt)}</span>
                                {rec.status !== "open" && <span className="font-medium">{REC_STATUS[rec.status]}</span>}
                                {rec.agentPrompt && (
                                  <span className="flex items-center gap-1">
                                    <Terminal className="size-3" />
                                    Prompt hazır
                                  </span>
                                )}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
              {wide && selected && (
                <div className="sticky top-8 max-h-[calc(100svh-4rem)] overflow-y-auto rounded-xl border bg-card p-6">
                  <RecommendationDetail key={selected.id} rec={selected} onDecide={decide(selected)} />
                </div>
              )}
            </section>
            <Sheet open={!wide && sheetOpen && selected !== null} onOpenChange={setSheetOpen}>
              <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
                <SheetHeader className="sr-only">
                  <SheetTitle>Öneri ayrıntısı</SheetTitle>
                  <SheetDescription>Seçilen önerinin gerekçesi, yapılacak değişiklik ve kod ajanı promptu.</SheetDescription>
                </SheetHeader>
                {selected && (
                  <div className="p-5 pt-10">
                    <RecommendationDetail
                      key={selected.id}
                      rec={selected}
                      onDecide={(status, reason) => {
                        setSheetOpen(false)
                        void decide(selected)(status, reason)
                      }}
                    />
                  </div>
                )}
              </SheetContent>
            </Sheet>
          </>
        )}

        {view === "posts" && (
          <section className="space-y-3">
            {state.drafts.length === 0 ? (
              <Empty>Henüz gönderi yok. Bir kontrol duyurmaya değer bir şey bulduğunda taslak burada onayınıza sunulur.</Empty>
            ) : (
              <>
                {!state.canPublish && <p className="text-sm text-muted-foreground">Yayınlama kapalı: gönderileri onaylamak için .env dosyasına POSTIZ_API_KEY ekleyin.</p>}
                <div className="grid items-start gap-3 xl:grid-cols-2">
                  {state.drafts.map((draft) => (
                    <PostCard
                      key={draft.id}
                      draft={draft}
                      canPublish={state.canPublish}
                      onApprove={(now) => run(`/api/drafts/${draft.id}/approve`, { now })}
                      onReject={(reason) => run(`/api/drafts/${draft.id}/reject`, { reason })}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {view === "changes" && (
          <section className="max-w-4xl space-y-3">{state.runs.length === 0 ? <Empty>Henüz kontrol yapılmadı.</Empty> : state.runs.map((r) => <RunCard key={r.at} run={r} />)}</section>
        )}
      </main>
      <Toaster />
    </div>
  )
}
