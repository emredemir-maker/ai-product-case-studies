import { Paperclip } from "lucide-react"
import { type FormEvent, useState } from "react"
import { PostCard } from "@/components/post-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Campaign, DeskState } from "@/lib/api"
import { day, usd } from "@/lib/tr"

/** The Monday after today, as YYYY-MM-DD: campaigns start on a full week by default. */
function nextMonday() {
  const d = new Date()
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

function NewCampaignForm({ state, onSubmit }: { state: DeskState; onSubmit: (input: { brief: string; startsOn: string; weeks: number; materials: string[] }) => void }) {
  const [brief, setBrief] = useState("")
  const [startsOn, setStartsOn] = useState(nextMonday)
  const [weeks, setWeeks] = useState("4")
  const [selected, setSelected] = useState<string[]>([])
  const busy = state.planning.running

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ brief: brief.trim(), startsOn, weeks: Number(weeks), materials: selected })
  }

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="font-display text-xl">Yeni kampanya</CardTitle>
        <CardDescription>Ne duyurmak istediğinizi yazın; plan, takvim ve gönderilerin tamamı sizin için hazırlanır. Hiçbir şey siz paylaşmadan yayınlanmaz.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="brief">Kampanya ne hakkında?</Label>
            <Textarea
              id="brief"
              required
              minLength={10}
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Örn. Altı özellik kataloğumuzu LinkedIn şirket sayfasında sırayla duyurmak istiyorum. Hedef ücretsiz analiz talebi almak."
              className="bg-background"
            />
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <div className="space-y-2">
              <Label htmlFor="starts-on">Başlangıç</Label>
              <Input id="starts-on" type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="w-44 bg-background" />
            </div>
            <div className="space-y-2">
              <Label id="weeks-label">Süre</Label>
              <ToggleGroup type="single" variant="outline" value={weeks} onValueChange={(v) => v && setWeeks(v)} aria-labelledby="weeks-label">
                {["2", "4", "6", "8"].map((w) => (
                  <ToggleGroupItem key={w} value={w} className="px-3.5">
                    {w} hafta
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Kullanılacak kataloglar ve dosyalar</legend>
            {state.materials.length === 0 ? (
              <p className="max-w-[44em] text-sm text-muted-foreground">
                Henüz dosya yok. Kataloglarınızı (PDF, görsel, .md ya da .txt) proje klasöründeki <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">materials</code> klasörüne koyun, sonra bu sayfayı yenileyin.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {state.materials.map((m) => (
                  <li key={m.name}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-sm has-checked:border-primary">
                      <Checkbox checked={selected.includes(m.name)} onCheckedChange={(v) => setSelected(v === true ? [...selected, m.name] : selected.filter((n) => n !== m.name))} />
                      <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{sizeLabel(m.bytes)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !state.canPlan || brief.trim().length < 10}>
              {busy ? "Planlanıyor…" : "Kampanyayı planla"}
            </Button>
            <p className="text-sm text-muted-foreground">Planlama birkaç dakika sürer ve bir site kontrolü kadar, uzun kataloglarda daha fazla tutar.</p>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function CampaignCard(props: { campaign: Campaign; state: DeskState; run: (path: string, body?: unknown) => void }) {
  const { campaign, state, run } = props
  const [open, setOpen] = useState(campaign.status === "active")
  const posts = state.drafts.filter((d) => d.campaignId === campaign.id).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  const tasks = state.recommendations.filter((r) => r.campaignId === campaign.id)
  const waiting = posts.filter((p) => p.status === "pending").length
  const archived = campaign.status === "archived"
  const [noteOpen, setNoteOpen] = useState(false)
  const noteParagraphs = campaign.summary.split(/\n{2,}/)
  const longNote = noteParagraphs.length > 2

  return (
    <Card className={archived ? "gap-4 opacity-70" : "gap-4"}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-display text-xl">{campaign.name}</CardTitle>
            <CardDescription>
              {day(campaign.startsOn)} ile {day(campaign.endsOn)} arası. {posts.length} gönderi{waiting > 0 ? `, ${waiting} tanesi sırada` : ""}
              {tasks.length > 0 && `, sitede ${tasks.length} iş`}
              {archived && ". Arşivlendi"}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Kapat" : "Aç"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => run(`/api/campaigns/${campaign.id}`, { status: archived ? "active" : "archived" })}>
              {archived ? "Geri al" : "Arşivle"}
            </Button>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-5">
          {!campaign.complete && <p className="text-sm font-medium text-destructive">Planlama yarıda kesildi; aşağıdakiler o ana kadar yazılanlar.</p>}
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold text-muted-foreground">Hedef</dt>
              <dd className="mt-1">{campaign.goal}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-muted-foreground">Ana mesaj</dt>
              <dd className="mt-1">{campaign.message}</dd>
            </div>
          </dl>

          {campaign.phases.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground">Takvim</h3>
              {/* An ordered list: the phases follow one another in time. */}
              <ol className="mt-2 space-y-2 border-l-2 border-border pl-4">
                {campaign.phases.map((phase) => (
                  <li key={`${phase.from}-${phase.title}`}>
                    <p className="font-medium">
                      {phase.title} <span className="text-sm font-normal text-muted-foreground">{day(phase.from)} ile {day(phase.to)} arası</span>
                    </p>
                    <p className="text-sm text-muted-foreground">{phase.focus}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {campaign.summary && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground">Planın notu</h3>
              <p className="mt-1 max-w-[60em] whitespace-pre-wrap">{noteOpen || !longNote ? campaign.summary : noteParagraphs.slice(0, 2).join("\n\n")}</p>
              {longNote && (
                <button type="button" onClick={() => setNoteOpen(!noteOpen)} aria-expanded={noteOpen} className="mt-2 rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  {noteOpen ? "Notu kısalt" : "Notun tamamını göster"}
                </button>
              )}
            </div>
          )}

          {campaign.materials.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <Paperclip className="size-4" />
              {campaign.materials.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </p>
          )}

          {tasks.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Bu kampanya için sitede yapılması gereken {tasks.length} iş Öneriler bölümünde: {tasks.map((t) => t.title).join("; ")}.
            </p>
          )}

          {campaign.usage?.costUsd != null && <p className="text-sm text-muted-foreground">Planlamanın tahmini maliyeti {usd(campaign.usage.costUsd)}.</p>}

          {posts.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Gönderiler, paylaşım sırasıyla</h3>
              <div className="grid items-start gap-3 xl:grid-cols-2">
                {posts.map((draft) => (
                  <PostCard
                    key={draft.id}
                    draft={draft}
                    canPublish={state.canPublish}
                    onApprove={(now) => run(`/api/drafts/${draft.id}/approve`, { now })}
                    onShared={() => run(`/api/drafts/${draft.id}/shared`, {})}
                    onReject={(reason) => run(`/api/drafts/${draft.id}/reject`, { reason })}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

export function CampaignsView({ state, run }: { state: DeskState; run: (path: string, body?: unknown) => void }) {
  return (
    <section className="space-y-4">
      {state.planning.error && (
        <Alert variant="destructive" className="bg-card">
          <AlertTitle>Kampanya planlanamadı</AlertTitle>
          <AlertDescription>{state.planning.error}</AlertDescription>
        </Alert>
      )}
      {state.planning.running && (
        <Alert className="bg-card">
          <AlertTitle>Kampanya planlanıyor</AlertTitle>
          <AlertDescription>Kataloglar okunuyor ve gönderiler yazılıyor. Bitince bu sayfada görünür; beklerken başka bölümlere geçebilirsiniz.</AlertDescription>
        </Alert>
      )}
      <NewCampaignForm state={state} onSubmit={(input) => run("/api/campaigns", input)} />
      {state.campaigns.map((campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} state={state} run={run} />
      ))}
    </section>
  )
}
