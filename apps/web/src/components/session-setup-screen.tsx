import { useState, useEffect, useRef, type KeyboardEvent } from "react"
import { FolderOpen } from "lucide-react"
import { PROVIDERS } from "./providers"
import { useSession } from "./session-provider"

export function SessionSetupScreen() {
  const { startSession, cancelSetup } = useSession()
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [cwdValue, setCwdValue] = useState("~")
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleStart = async () => {
    if (!selectedProvider || starting) return
    setError(null)
    setStarting(true)
    try {
      await startSession(selectedProvider, cwdValue.trim() || "~")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session")
      setStarting(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && selectedProvider) {
      e.preventDefault()
      handleStart()
    }
    if (e.key === "Escape") {
      cancelSetup()
    }
  }

  return (
    <div className="flex h-full flex-col bg-[var(--t-bg)]">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md px-6 space-y-6">
          <div className="space-y-2">
            <div className="text-xs font-medium text-[var(--t-muted)] uppercase tracking-wider">Agent</div>
            <div className="grid grid-cols-2 gap-3">
              {PROVIDERS.map((p) => {
                const selected = selectedProvider === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    className={`group relative text-left rounded-lg border px-4 py-3.5 transition-all cursor-pointer ${
                      selected
                        ? "border-[var(--t-accent)] bg-[var(--t-accent)]/8"
                        : "border-[var(--t-border)] bg-[var(--t-surface)] hover:border-[var(--t-dim)] hover:bg-[var(--t-elevated)]"
                    }`}
                  >
                    <div className={`text-sm font-medium ${selected ? "text-[var(--t-accent)]" : "text-[var(--t-bright)]"}`}>
                      {p.name}
                    </div>
                    <div className="text-[11px] text-[var(--t-muted)] mt-0.5 leading-snug">
                      {p.description}
                    </div>
                    {selected && (
                      <div className="absolute top-2.5 right-2.5 size-2 rounded-full bg-[var(--t-accent)]" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-[var(--t-muted)] uppercase tracking-wider">Working directory</div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-3 py-2 focus-within:border-[var(--t-dim)]">
              <FolderOpen className="size-3.5 shrink-0 text-[var(--t-muted)]" />
              <input
                ref={inputRef}
                value={cwdValue}
                onChange={(e) => setCwdValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent text-sm text-[var(--t-bright)] outline-none placeholder:text-[var(--t-dim)] font-mono"
                placeholder="~/projects/my-app"
                spellCheck={false}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            onClick={handleStart}
            disabled={!selectedProvider || starting}
            className={`w-full rounded-lg py-2.5 text-sm font-medium transition-all ${
              selectedProvider && !starting
                ? "bg-[var(--t-accent)] text-[var(--t-bg)] hover:brightness-110 cursor-pointer"
                : "bg-[var(--t-border)] text-[var(--t-dim)] cursor-not-allowed"
            }`}
          >
            {starting ? "Starting..." : "Start session"}
          </button>
        </div>
      </div>
    </div>
  )
}
