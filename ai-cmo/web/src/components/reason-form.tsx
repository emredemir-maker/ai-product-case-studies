import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** An inline "why?" prompt. The reason is optional; it is what the agent reads on its next run. */
export function ReasonForm(props: { placeholder: string; submitLabel: string; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("")
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        props.onSubmit(reason.trim())
      }}
    >
      <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={props.placeholder} aria-label={props.placeholder} className="min-w-48 flex-1 bg-card" />
      <Button type="submit" variant="outline">
        {props.submitLabel}
      </Button>
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        Vazgeç
      </Button>
    </form>
  )
}
