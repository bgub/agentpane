export default function Loading() {
  return (
    <div className="flex h-screen bg-[var(--t-bg)]">
      {/* Sidebar skeleton */}
      <div className="flex h-full w-56 min-h-0 flex-col bg-[var(--t-surface)] border-r border-[var(--t-border)]">
        {/* Header */}
        <div className="flex h-10 shrink-0 items-center justify-between px-3 border-b border-[var(--t-border)]">
          <span className="text-xs font-medium text-[var(--t-muted)]">Sessions</span>
          <div className="rounded p-1">
            <div className="size-3.5" />
          </div>
        </div>

        {/* Session list shimmer */}
        <div className="flex-1 py-1 space-y-0.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2 border-l-2 border-l-transparent">
              <span className="shrink-0 size-2 rounded-full bg-[var(--t-dim)] animate-pulse" />
              <div
                className="h-3.5 rounded bg-[var(--t-dim)]/40 animate-pulse"
                style={{ width: `${50 + i * 15}%` }}
              />
            </div>
          ))}
        </div>

        {/* Branding */}
        <div className="shrink-0 h-12 flex items-center px-3 border-t border-[var(--t-border)]">
          <span className="text-xs font-medium text-[var(--t-muted)]">AgentPane</span>
        </div>
      </div>

      {/* Chat area skeleton */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Status bar */}
        <div className="flex h-10 shrink-0 items-center justify-between px-4 bg-[var(--t-surface)] border-b border-[var(--t-border)]">
          <div className="h-3 w-32 rounded bg-[var(--t-dim)]/40 animate-pulse" />
          <div className="h-3 w-20 rounded bg-[var(--t-dim)]/40 animate-pulse" />
        </div>

        {/* Empty scrollable area */}
        <div className="flex-1 min-h-0" />

        {/* Input bar */}
        <div className="shrink-0 h-12 border-t border-[var(--t-border)] bg-[var(--t-surface)] px-5 flex items-center">
          <div className="max-w-3xl mx-auto w-full flex items-center gap-2.5">
            <span className="shrink-0 text-sm font-mono text-[var(--t-dim)] select-none">&#10095;</span>
            <span className="text-sm text-[var(--t-dim)]">Send a message...</span>
          </div>
        </div>
      </div>
    </div>
  )
}
