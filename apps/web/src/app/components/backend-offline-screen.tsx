"use client"

import { Terminal, RefreshCw } from "lucide-react"
import { useSession } from "./session-provider"

export function BackendOfflineScreen() {
  const { healthChecking, retryHealth } = useSession()

  return (
    <div className="flex h-full items-center justify-center bg-[var(--t-bg)]">
      <div className="w-full max-w-sm px-6 space-y-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--t-surface)] border border-[var(--t-border)]">
          <Terminal className="size-5 text-[var(--t-muted)]" />
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-[var(--t-bright)]">Backend not running</h2>
          <p className="text-xs text-[var(--t-muted)] leading-relaxed">
            Start the AgentPane server to connect.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3">
          <code className="text-xs text-[var(--t-accent)] font-mono">pnpm dev</code>
        </div>

        <button
          onClick={retryHealth}
          disabled={healthChecking}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-2 text-xs font-medium text-[var(--t-text)] transition-colors hover:bg-[var(--t-elevated)] hover:border-[var(--t-dim)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`size-3 ${healthChecking ? "animate-spin" : ""}`} />
          {healthChecking ? "Checking..." : "Retry"}
        </button>
      </div>
    </div>
  )
}
