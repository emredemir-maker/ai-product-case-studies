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
import { type Draft, capitalize, dayTime, platformName } from "@/lib/api"

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
            {pending ? "Planned for " : ""}
            {dayTime(draft.scheduledAt)}
          </span>
          {!pending && (
            <span className="font-medium">
              {capitalize(draft.status)}
              {draft.rejectionReason ? `: ${draft.rejectionReason}` : ""}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="max-w-[40em] break-words whitespace-pre-wrap">{draft.content}</p>
        <p className="text-sm text-muted-foreground">Why this post: {draft.rationale}</p>
      </CardContent>
      {pending && (
        <CardFooter className="block">
          {rejecting ? (
            <ReasonForm
              placeholder="What should change? The next run reads this"
              submitLabel="Reject"
              onSubmit={(reason) => {
                setRejecting(false)
                props.onReject(reason)
              }}
              onCancel={() => setRejecting(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canPublish || past} title={past ? "The planned time has passed" : undefined} onClick={() => props.onApprove(false)}>
                Approve and schedule
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={!canPublish}>
                    Publish now
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Publish this post now?</AlertDialogTitle>
                    <AlertDialogDescription>It goes out on {platformName(draft.platform)} immediately and cannot be recalled from here.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep as draft</AlertDialogCancel>
                    <AlertDialogAction onClick={() => props.onApprove(true)}>Publish now</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="ghost" onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
