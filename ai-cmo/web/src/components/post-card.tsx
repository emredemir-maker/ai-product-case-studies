import { useState } from "react"
import { ReasonForm } from "@/components/reason-form"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import type { Draft } from "@/lib/api"
import { DRAFT_STATUS, dayTime, platformName } from "@/lib/tr"

export function PostCard(props: { draft: Draft; canPublish: boolean; onApprove: (now: boolean) => void; onReject: (reason: string) => void }) {
  const { draft, canPublish } = props
  const [rejecting, setRejecting] = useState(false)
  const pending = draft.status === "pending"
  const past = new Date(draft.scheduledAt).getTime() <= Date.now()

  return (
    <Card className={pending ? "gap-4" : "gap-4 opacity-60"}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{platformName(draft.platform)}</Badge>
          <span>
            {pending ? "Planlanan: " : ""}
            {dayTime(draft.scheduledAt)}
          </span>
          {!pending && (
            <span className="font-medium text-foreground">
              {DRAFT_STATUS[draft.status]}
              {draft.rejectionReason ? `: ${draft.rejectionReason}` : ""}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="max-w-[40em] break-words whitespace-pre-wrap">{draft.content}</p>
        <p className="text-sm text-muted-foreground">Neden bu gönderi: {draft.rationale}</p>
      </CardContent>
      {pending && (
        <CardFooter className="block">
          {rejecting ? (
            <ReasonForm
              placeholder="Ne değişmeli? Sonraki çalıştırma bunu okur"
              submitLabel="Reddet"
              onSubmit={(reason) => {
                setRejecting(false)
                props.onReject(reason)
              }}
              onCancel={() => setRejecting(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canPublish || past} title={past ? "Planlanan zaman geçti" : undefined} onClick={() => props.onApprove(false)}>
                Onayla ve zamanla
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={!canPublish}>
                    Şimdi yayınla
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Bu gönderi şimdi yayınlansın mı?</AlertDialogTitle>
                    <AlertDialogDescription>{platformName(draft.platform)} üzerinde hemen yayınlanır ve buradan geri alınamaz.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Taslak kalsın</AlertDialogCancel>
                    <AlertDialogAction onClick={() => props.onApprove(true)}>Şimdi yayınla</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="ghost" onClick={() => setRejecting(true)}>
                Reddet
              </Button>
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
