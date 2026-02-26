import { useState, useEffect, useRef, type KeyboardEvent } from "react"
import { FolderOpen, ChevronDown, X, Plus } from "lucide-react"
import { PROVIDERS } from "./providers"
import { useSession } from "./session-provider"
import { api } from "@/lib/api"
import type { McpServer } from "@/lib/types"

export function SessionSetupScreen() {
  const { startSession, cancelSetup } = useSession()
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [cwdValue, setCwdValue] = useState("~")
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [showMcp, setShowMcp] = useState(false)
  const [mcpName, setMcpName] = useState("")
  const [mcpType, setMcpType] = useState<"stdio" | "http" | "sse">("stdio")
  const [mcpCommand, setMcpCommand] = useState("")
  const [mcpArgs, setMcpArgs] = useState("")
  const [mcpUrl, setMcpUrl] = useState("")

  useEffect(() => {
    inputRef.current?.focus()
    // Load global MCP defaults
    api.settings.get("mcp_servers")
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json() as { value: string }
        try {
          const servers = JSON.parse(data.value)
          if (Array.isArray(servers)) setMcpServers(servers)
        } catch { /* ignore */ }
      })
      .catch(() => {})
  }, [])

  const addMcpServer = () => {
    if (!mcpName.trim()) return
    let server: McpServer
    if (mcpType === "stdio") {
      if (!mcpCommand.trim()) return
      const base: McpServer = { name: mcpName.trim(), type: "stdio", command: mcpCommand.trim() }
      if (mcpArgs.trim()) (base as { args?: string[] }).args = mcpArgs.trim().split(/\s+/)
      server = base
    } else {
      if (!mcpUrl.trim()) return
      server = { name: mcpName.trim(), type: mcpType, url: mcpUrl.trim() }
    }
    setMcpServers((prev) => [...prev, server])
    setMcpName("")
    setMcpCommand("")
    setMcpArgs("")
    setMcpUrl("")
  }

  const removeMcpServer = (index: number) => {
    setMcpServers((prev) => prev.filter((_, i) => i !== index))
  }

  const handleStart = async () => {
    if (!selectedProvider || starting) return
    setError(null)
    setStarting(true)
    const cwd = cwdValue.trim() || "~"
    let failed = false
    let errorMessage = "Failed to start session"
    try {
      await startSession(selectedProvider, cwd, mcpServers.length > 0 ? mcpServers : undefined)
    } catch (err) {
      failed = true
      if (err instanceof Error) errorMessage = err.message
    }
    if (failed) {
      setError(errorMessage)
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

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowMcp(!showMcp)}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--t-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--t-bright)] transition-colors"
            >
              <ChevronDown className={`size-3 transition-transform ${showMcp ? "" : "-rotate-90"}`} />
              MCP Servers {mcpServers.length > 0 && `(${mcpServers.length})`}
            </button>
            {showMcp && (
              <div className="space-y-2">
                {mcpServers.map((server, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--t-bright)] truncate">{server.name}</div>
                      <div className="text-[11px] text-[var(--t-muted)] truncate">
                        {server.type === "stdio" ? server.command : server.url}
                      </div>
                    </div>
                    <button type="button" onClick={() => removeMcpServer(i)} className="shrink-0 text-[var(--t-dim)] hover:text-[var(--t-red)] cursor-pointer">
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <input
                      value={mcpName}
                      onChange={(e) => setMcpName(e.target.value)}
                      className="flex-1 rounded border border-[var(--t-border)] bg-[var(--t-surface)] px-2 py-1.5 text-xs text-[var(--t-bright)] outline-none placeholder:text-[var(--t-dim)] font-mono"
                      placeholder="Name"
                      spellCheck={false}
                    />
                    <select
                      value={mcpType}
                      onChange={(e) => setMcpType(e.target.value as "stdio" | "http" | "sse")}
                      className="rounded border border-[var(--t-border)] bg-[var(--t-surface)] px-2 py-1.5 text-xs text-[var(--t-bright)] outline-none cursor-pointer"
                    >
                      <option value="stdio">stdio</option>
                      <option value="http">http</option>
                      <option value="sse">sse</option>
                    </select>
                  </div>
                  {mcpType === "stdio" ? (
                    <div className="flex gap-2">
                      <input
                        value={mcpCommand}
                        onChange={(e) => setMcpCommand(e.target.value)}
                        className="flex-1 rounded border border-[var(--t-border)] bg-[var(--t-surface)] px-2 py-1.5 text-xs text-[var(--t-bright)] outline-none placeholder:text-[var(--t-dim)] font-mono"
                        placeholder="Command (e.g. npx)"
                        spellCheck={false}
                      />
                      <input
                        value={mcpArgs}
                        onChange={(e) => setMcpArgs(e.target.value)}
                        className="flex-1 rounded border border-[var(--t-border)] bg-[var(--t-surface)] px-2 py-1.5 text-xs text-[var(--t-bright)] outline-none placeholder:text-[var(--t-dim)] font-mono"
                        placeholder="Args (space-separated)"
                        spellCheck={false}
                      />
                    </div>
                  ) : (
                    <input
                      value={mcpUrl}
                      onChange={(e) => setMcpUrl(e.target.value)}
                      className="w-full rounded border border-[var(--t-border)] bg-[var(--t-surface)] px-2 py-1.5 text-xs text-[var(--t-bright)] outline-none placeholder:text-[var(--t-dim)] font-mono"
                      placeholder="URL"
                      spellCheck={false}
                    />
                  )}
                  <button
                    type="button"
                    onClick={addMcpServer}
                    className="flex items-center gap-1 text-xs text-[var(--t-accent)] hover:text-[var(--t-bright)] cursor-pointer"
                  >
                    <Plus className="size-3" /> Add server
                  </button>
                </div>
              </div>
            )}
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
