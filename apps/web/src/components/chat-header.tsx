import { GitBranch, Loader2, Plug, Unplug } from "lucide-react"
import { useGitBranchQuery } from "@/lib/queries"
import type { ConfigOption, ConfigSelectGroup } from "./chat-view/types"

interface ChatHeaderProps {
  cwd?: string | undefined
  connected: boolean
  prompting: boolean
  connecting: boolean
  configOptions?: ConfigOption[]
  onConnect: () => void
  onDisconnect: () => void
  onSetConfigOption?: (configId: string, value: string) => void
}

function isGroup(opt: ConfigOption["options"][number]): opt is ConfigSelectGroup {
  return "group" in opt
}

export function ChatHeader({ cwd, connected, prompting, connecting, configOptions, onConnect, onDisconnect, onSetConfigOption }: ChatHeaderProps) {
  const { data: branch } = useGitBranchQuery(cwd)

  return (
    <div className="flex h-10 shrink-0 items-center justify-between px-4 bg-[var(--t-surface)] border-b border-[var(--t-border)]">
      {cwd ? (
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-semibold text-[var(--t-accent)] truncate">{cwd.replace(/^\/home\/[^/]+/, '~')}</span>
          {branch && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--t-muted)] shrink-0">
              <GitBranch className="size-3" />
              {branch}
            </span>
          )}
        </div>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-3 text-xs">
        {configOptions && configOptions.length > 0 && configOptions.map((opt) => (
          <select
            key={opt.id}
            value={opt.currentValue}
            onChange={(e) => onSetConfigOption?.(opt.id, e.target.value)}
            title={opt.description || opt.name}
            className="h-6 px-1.5 rounded border border-[var(--t-border)] bg-[var(--t-surface)] text-[var(--t-text)] text-xs outline-none cursor-pointer hover:border-[var(--t-accent)] transition-colors"
          >
            {opt.options.map((o) =>
              isGroup(o) ? (
                <optgroup key={o.group} label={o.name}>
                  {o.options.map((go) => (
                    <option key={go.value} value={go.value}>{go.name}</option>
                  ))}
                </optgroup>
              ) : (
                <option key={o.value} value={o.value}>{o.name}</option>
              )
            )}
          </select>
        ))}
        {prompting && (
          <span className="flex items-center gap-1.5 text-[var(--t-amber)]">
            <span className="size-1.5 rounded-full bg-[var(--t-amber)] animate-pulse" />
            thinking
          </span>
        )}
        {cwd && (
          <button
            type="button"
            onClick={connected ? onDisconnect : onConnect}
            disabled={connecting}
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
