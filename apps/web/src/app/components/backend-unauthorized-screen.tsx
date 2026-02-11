"use client"

import { ShieldAlert } from "lucide-react"

export function BackendUnauthorizedScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--t-bg)]">
      <div className="w-full max-w-sm px-6 space-y-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--t-surface)] border border-[var(--t-border)]">
          <ShieldAlert className="size-5 text-[var(--t-muted)]" />
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-[var(--t-bright)]">Authentication required</h2>
          <p className="text-xs text-[var(--t-muted)] leading-relaxed">
            Open the URL printed in your server terminal to connect.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3">
          <code className="text-xs text-[var(--t-accent)] font-mono">npx agentpane</code>
          <p className="mt-2 text-[10px] text-[var(--t-dim)]">
            Then open the URL with token shown in the terminal.
          </p>
        </div>
      </div>
    </div>
  )
}
