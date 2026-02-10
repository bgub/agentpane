"use client"

import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from "react"
import { FolderOpen, Terminal, RefreshCw } from "lucide-react"
import Sidebar from "./sidebar"
import ChatView from "./chat-view"
import { PROVIDERS } from "./providers"
import { api } from "@/lib/api"

interface Session {
  id: string
  name: string
  cwd: string
  agent_type: string
  agent_session_id: string | null
  created_at: number
  connected?: boolean
  prompting?: boolean
}

function SessionSetupScreen({
  onStart,
  onCancel,
}: {
  onStart: (agentType: string, cwd: string) => void
  onCancel: () => void
}) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [cwdValue, setCwdValue] = useState("~")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleStart = () => {
    if (!selectedProvider) return
    onStart(selectedProvider, cwdValue.trim() || "~")
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && selectedProvider) {
      e.preventDefault()
      handleStart()
    }
    if (e.key === "Escape") {
      onCancel()
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

          <button
            onClick={handleStart}
            disabled={!selectedProvider}
            className={`w-full rounded-lg py-2.5 text-sm font-medium transition-all ${
              selectedProvider
                ? "bg-[var(--t-accent)] text-[var(--t-bg)] hover:brightness-110 cursor-pointer"
                : "bg-[var(--t-border)] text-[var(--t-dim)] cursor-not-allowed"
            }`}
          >
            Start session
          </button>
        </div>
      </div>
    </div>
  )
}

function BackendOfflineScreen({ onRetry, checking }: { onRetry: () => void; checking: boolean }) {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--t-bg)]">
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
          onClick={onRetry}
          disabled={checking}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-2 text-xs font-medium text-[var(--t-text)] transition-colors hover:bg-[var(--t-elevated)] hover:border-[var(--t-dim)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`size-3 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking..." : "Retry"}
        </button>
      </div>
    </div>
  )
}

export default function SessionLayout() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, _setActiveSessionId] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)
  const [healthChecking, setHealthChecking] = useState(false)

  const setActiveSessionId = useCallback((id: string | null) => {
    _setActiveSessionId(id)
    if (id) localStorage.setItem("agentpane:activeSessionId", id)
    else localStorage.removeItem("agentpane:activeSessionId")
  }, [])

  const [connectedSessionIds, setConnectedSessionIds] = useState<Set<string>>(new Set())
  const [promptingSessionIds, setPromptingSessionIds] = useState<Set<string>>(new Set())

  const loadSessions = useCallback(() => {
    api.sessions.list()
      .then((res) => res.json())
      .then((data: Session[]) => {
        setSessions(data)
        setConnectedSessionIds(new Set(data.filter((s) => s.connected).map((s) => s.id)))
        setPromptingSessionIds(new Set(data.filter((s) => s.prompting).map((s) => s.id)))

        const saved = localStorage.getItem("agentpane:activeSessionId")
        if (saved && data.some((s) => s.id === saved)) {
          _setActiveSessionId(saved)
        } else if (data.length > 0) {
          _setActiveSessionId(data[0].id)
        }

        setInitialized(true)
      })
      .catch(() => setInitialized(true))
  }, [])

  const checkHealth = useCallback(async () => {
    setHealthChecking(true)
    try {
      const res = await api.health()
      const data = await res.json()
      if (data?.app === "agentpane") {
        setBackendOnline(true)
        setHealthChecking(false)
        return true
      }
    } catch {}
    setBackendOnline(false)
    setHealthChecking(false)
    return false
  }, [])

  // Health check on mount, then load sessions if online
  useEffect(() => {
    checkHealth().then((online) => {
      if (online) loadSessions()
      else setInitialized(true)
    })
  }, [checkHealth, loadSessions])

  // Poll: health check + status updates
  useEffect(() => {
    if (!initialized) return
    const interval = setInterval(async () => {
      try {
        const res = await api.health()
        const data = await res.json()
        if (data?.app !== "agentpane") throw new Error()

        if (!backendOnline) {
          setBackendOnline(true)
          loadSessions()
        }

        // Update status while online
        api.sessions.status()
          .then((res) => res.json())
          .then((data: { connected: string[]; prompting: string[] }) => {
            setConnectedSessionIds(new Set(data.connected))
            setPromptingSessionIds(new Set(data.prompting))
          })
          .catch(() => {})
      } catch {
        setBackendOnline(false)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [initialized, backendOnline, loadSessions])

  const handleCreate = useCallback(() => {
    setShowSetup(true)
    setActiveSessionId(null)
  }, [setActiveSessionId])

  const handleSetupStart = useCallback(
    async (agentType: string, cwd: string) => {
      const res = await api.sessions.create({ agent_type: agentType, cwd })
      const session: Session = await res.json()

      setSessions((prev) => [...prev, session])
      setActiveSessionId(session.id)
      if (session.connected) {
        setConnectedSessionIds((prev) => new Set([...prev, session.id]))
      }
      setShowSetup(false)
    },
    [setActiveSessionId]
  )

  const handleSetupCancel = useCallback(() => {
    setShowSetup(false)
    if (sessions.length > 0) {
      const saved = localStorage.getItem("agentpane:activeSessionId")
      if (saved && sessions.some((s) => s.id === saved)) {
        _setActiveSessionId(saved)
      } else {
        _setActiveSessionId(sessions[0].id)
      }
    }
  }, [sessions])

  const handleDelete = async (id: string) => {
    await api.sessions.delete(id)
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id)
      if (activeSessionId === id) {
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
      }
      return remaining
    })
    setConnectedSessionIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setPromptingSessionIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const handleRename = async (id: string, name: string) => {
    const res = await api.sessions.rename(id, name)
    const updated: Session = await res.json()
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)))
  }

  const handlePromptingChange = useCallback(
    (sessionId: string, prompting: boolean) => {
      setPromptingSessionIds((prev) => {
        const next = new Set(prev)
        if (prompting) next.add(sessionId)
        else next.delete(sessionId)
        return next
      })
    },
    []
  )

  const handleConnectionChange = useCallback(
    (sessionId: string, connected: boolean, config?: { cwd: string; agent_type: string }) => {
      setConnectedSessionIds((prev) => {
        const next = new Set(prev)
        if (connected) next.add(sessionId)
        else next.delete(sessionId)
        return next
      })
      if (config) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId ? { ...s, cwd: config.cwd, agent_type: config.agent_type } : s
          )
        )
      }
    },
    []
  )

  if (!initialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--t-bg)] text-[var(--t-muted)] text-sm">
        Loading...
      </div>
    )
  }

  if (backendOnline === false) {
    return (
      <BackendOfflineScreen
        checking={healthChecking}
        onRetry={() => {
          checkHealth().then((online) => {
            if (online) loadSessions()
          })
        }}
      />
    )
  }

  return (
    <div className="flex h-screen bg-[var(--t-bg)] overflow-hidden">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        connectedSessionIds={connectedSessionIds}
        promptingSessionIds={promptingSessionIds}
        showSetup={showSetup}
        onSelect={(id) => {
          setShowSetup(false)
          setActiveSessionId(id)
        }}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onRename={handleRename}
      />
      <div className="flex-1 min-w-0 min-h-0 relative">
        {showSetup && (
          <div className="absolute inset-0 z-10">
            <SessionSetupScreen
              onStart={handleSetupStart}
              onCancel={handleSetupCancel}
            />
          </div>
        )}

        {sessions.map((session) => {
          const isActive = session.id === activeSessionId
          const isConnected = connectedSessionIds.has(session.id)
          if (!isActive && !isConnected) return null

          return (
            <div
              key={session.id}
              className={`absolute inset-0 ${isActive && !showSetup ? "" : "invisible"}`}
            >
              <ChatView
                sessionId={session.id}
                cwd={session.cwd}
                agentType={session.agent_type}
                active={isActive && !showSetup}
                connected={isConnected}
                onPromptingChange={handlePromptingChange}
                onConnectionChange={handleConnectionChange}
              />
            </div>
          )
        })}

        {!showSetup && sessions.length === 0 && (
          <div className="flex h-full items-center justify-center text-[var(--t-muted)] text-sm">
            No sessions. Click + to create one.
          </div>
        )}
      </div>
    </div>
  )
}
