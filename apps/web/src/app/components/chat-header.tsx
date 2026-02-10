"use client"

import { Loader2, Plug, Unplug } from "lucide-react"

interface ChatHeaderProps {
  cwd?: string | undefined
  connected: boolean
  prompting: boolean
  connecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function ChatHeader({ cwd, connected, prompting, connecting, onConnect, onDisconnect }: ChatHeaderProps) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between px-4 bg-[var(--t-surface)] border-b border-[var(--t-border)]">
      {cwd ? (
        <span className="text-xs font-semibold text-[var(--t-accent)] truncate min-w-0">{cwd.replace(/^\/home\/[^/]+/, '~')}</span>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-3 text-xs">
        {prompting && (
          <span className="flex items-center gap-1.5 text-[var(--t-amber)]">
            <span className="size-1.5 rounded-full bg-[var(--t-amber)] animate-pulse" />
            thinking
          </span>
        )}
        {cwd && (
          <button
            onClick={connected ? onDisconnect : onConnect}
            disabled={connecting || prompting}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer disabled:cursor-default ${
              connecting
                ? "text-[var(--t-amber)] bg-[var(--t-amber)]/10"
                : connected
                  ? "text-[var(--t-green)] hover:bg-[var(--t-red)]/10 hover:text-[var(--t-red)]"
                  : "text-[var(--t-dim)] hover:bg-[var(--t-green)]/10 hover:text-[var(--t-green)]"
            }`}
            title={connecting ? "Connecting..." : connected ? "Disconnect agent" : "Connect agent"}
          >
            {connecting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : connected ? (
              <Plug className="size-3" />
            ) : (
              <Unplug className="size-3" />
            )}
            {connecting ? "connecting" : connected ? "connected" : "disconnected"}
          </button>
        )}
      </div>
    </div>
  )
}
