import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Run } from "@/lib/api"
import { bandName, dayTime, diffField } from "@/lib/tr"

function Section({ label, items }: { label: string; items: ReactNode[] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      {items.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm break-words">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function RunCard({ run }: { run: Run }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="font-display text-lg">{dayTime(run.at)}</CardTitle>
        <CardDescription>
          {run.pagesChecked} sayfa incelendi, {run.recommendationIds.length} öneri, {run.draftIds.length} gönderi
          {run.complete === false && <span className="font-medium text-destructive">. Yarıda kesildi; sonraki kontrol aynı değişiklikleri yeniden inceler</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {run.summary && <p className="max-w-[46em] whitespace-pre-wrap">{run.summary}</p>}
        {run.commits.length > 0 && (
          <Section
            label="Üründeki değişiklikler"
            items={run.commits.map((c) => (
              <>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{c.hash}</code> {c.subject} ({c.repo})
              </>
            ))}
          />
        )}
        {run.diff.added.length > 0 && <Section label="Yeni sayfalar" items={run.diff.added} />}
        {run.diff.removed.length > 0 && <Section label="Kaldırılan sayfalar" items={run.diff.removed} />}
        {run.diff.changed.length > 0 && <Section label="Değişen sayfalar" items={run.diff.changed.map((c) => `${c.url}: ${c.fields.map(diffField).join(", ")}`)} />}
        {(run.sources ?? []).map((s) =>
          s.ok ? (
            <Section key={s.name} label={`${s.name}${s.score != null ? `: ${s.score}/100${s.band ? `, ${bandName(s.band)}` : ""}` : ""}`} items={(s.recommendations ?? []).slice(0, 12)} />
          ) : (
            <Section key={s.name} label={`${s.name} çalışmadı`} items={[s.error]} />
          ),
        )}
        {run.problems.length > 0 && <Section label="Sorunlar" items={run.problems} />}
      </CardContent>
    </Card>
  )
}
