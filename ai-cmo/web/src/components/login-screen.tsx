import { Sparkles } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type DeskState, SignInRequired, call } from "@/lib/api"

export function LoginScreen({ onSignedIn }: { onSignedIn: (state: DeskState) => void }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await call("/api/login", { password }))
    } catch (err) {
      if (err instanceof SignInRequired) {
        setError(err.retryAfterSeconds ? `Şifre yanlış. Yeniden denemeden önce ${err.retryAfterSeconds} saniye bekleyin.` : "Şifre yanlış.")
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-ink p-5 text-ink-foreground">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div>
          <p className="flex items-center gap-2 font-display text-2xl font-bold">
            <Sparkles className="size-5 text-signal" />
            Büyüme Masası
          </p>
          <p className="mt-1 text-sm text-ink-muted">Devam etmek için şifrenizi girin.</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Şifre
          </label>
          <Input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "password-error" : undefined}
            className="border-ink-raised bg-ink-raised text-ink-foreground"
          />
          {error && (
            <p id="password-error" role="alert" className="text-sm text-[#ff8fa3]">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" disabled={busy || !password} className="w-full bg-signal text-[#1a1d05] hover:bg-signal/85">
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </Button>
      </form>
    </main>
  )
}
