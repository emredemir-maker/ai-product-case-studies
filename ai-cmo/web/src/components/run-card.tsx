import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { type Run, dayTime } from "@/lib/api"

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
        <CardTitle>{dayTime(run.at)}</CardTitle>
        <CardDescription>
          {run.pagesChecked} pages checked, {run.recommendationIds.length} recommendations, {run.draftIds.length} posts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {run.commits.length > 0 && (
          <Section
            label="Product changes"
            items={run.commits.map((c) => (
              <>
                <code className="font-mono">{c.hash}</code> {c.subject} ({c.repo})
              </>
            ))}
          />
        )}
        {run.diff.added.length > 0 && <Section label="New pages" items={run.diff.added} />}
        {run.diff.removed.length > 0 && <Section label="Removed pages" items={run.diff.removed} />}
        {run.diff.changed.length > 0 && <Section label="Changed pages" items={run.diff.changed.map((c) => `${c.url}: ${c.fields.join(", ")}`)} />}
        {(run.sources ?? []).map((s) =>
          s.ok ? (
            <Section key={s.name} label={`${s.name}${s.score != null ? `: ${s.score}/100${s.band ? `, ${s.band}` : ""}` : ""}`} items={(s.recommendations ?? []).slice(0, 12)} />
          ) : (
            <Section key={s.name} label={`${s.name} did not run`} items={[s.error]} />
          ),
        )}
        {run.problems.length > 0 && <Section label="Problems" items={run.problems} />}
      </CardContent>
    </Card>
  )
}
