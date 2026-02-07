"use client"

import { useState, useEffect, useCallback } from "react"
import Sidebar from "./sidebar"
import ChatView from "./chat-view"

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

interface SessionLayoutProps {
  initialSessions?: Session[]
}

export default function SessionLayout({ initialSessions }: SessionLayoutProps) {
  const hasInitialData = initialSessions !== undefined
  const hasInitialSessions = !!initialSessions?.length
  const [sessions, setSessions] = useState<Session[]>(initialSessions ?? [])
  const [activeSessionId, _setActiveSessionId] = useState<string | null>(
    hasInitialSessions ? initialSessions[0].id : null
  )

  const setActiveSessionId = useCallback((id: string | null) => {
    _setActiveSessionId(id)
    if (id) localStorage.setItem("acapa:activeSessionId", id)
    else localStorage.removeItem("acapa:activeSessionId")
  }, [])
  const [initialized, setInitialized] = useState(hasInitialSessions)
  const [connectedSessionIds, setConnectedSessionIds] = useState<Set<string>>(
    () => new Set(initialSessions?.filter((s) => s.connected).map((s) => s.id) ?? [])
  )
  const [promptingSessionIds, setPromptingSessionIds] = useState<Set<string>>(
    () => new Set(initialSessions?.filter((s) => s.prompting).map((s) => s.id) ?? [])
  )

  const fetchSessions = useCallback(async () => {
    const res = await fetch("/api/sessions")
    const data: Session[] = await res.json()
    setSessions(data)
    setConnectedSessionIds(
      new Set(data.filter((s) => s.connected).map((s) => s.id))
    )
    setPromptingSessionIds(
      new Set(data.filter((s) => s.prompting).map((s) => s.id))
    )
    return data
  }, [])

  // Load sessions on mount
  useEffect(() => {
    if (hasInitialSessions) {
      // Server provided sessions and we're already initialized.
      // Just check localStorage for a saved active session.
      const saved = localStorage.getItem("acapa:activeSessionId")
      if (saved && initialSessions!.some((s) => s.id === saved)) {
        _setActiveSessionId(saved)
      }
    } else if (hasInitialData) {
      // Server ran but returned zero sessions — auto-create one client-side
      fetch("/api/sessions", { method: "POST" })
        .then((res) => res.json())
        .then((session: Session) => {
          setSessions([session])
          setActiveSessionId(session.id)
          if (session.connected) {
            setConnectedSessionIds(new Set([session.id]))
          }
          setInitialized(true)
        })
    } else {
      // No server data — fetch client-side (fallback)
      fetchSessions().then((data) => {
        if (data.length === 0) {
          fetch("/api/sessions", { method: "POST" })
            .then((res) => res.json())
            .then((session: Session) => {
              setSessions([session])
              setActiveSessionId(session.id)
              if (session.connected) {
                setConnectedSessionIds(new Set([session.id]))
              }
              setInitialized(true)
            })
        } else {
          const saved = localStorage.getItem("acapa:activeSessionId")
          const match = saved && data.some((s) => s.id === saved)
          setActiveSessionId(match ? saved : data[0].id)
          setInitialized(true)
        }
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (agentType?: string) => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_type: agentType }),
    })
    const session: Session = await res.json()
    setSessions((prev) => [...prev, session])
    setActiveSessionId(session.id)
    if (session.connected) {
      setConnectedSessionIds((prev) => new Set([...prev, session.id]))
    }
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" })
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
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
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
    (sessionId: string, connected: boolean) => {
      setConnectedSessionIds((prev) => {
        const next = new Set(prev)
        if (connected) next.add(sessionId)
        else next.delete(sessionId)
        return next
      })
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

  return (
    <div className="flex h-screen bg-[var(--t-bg)]">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        connectedSessionIds={connectedSessionIds}
        promptingSessionIds={promptingSessionIds}
        onSelect={setActiveSessionId}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onRename={handleRename}
      />
      <div className="flex-1 min-h-0 relative">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`absolute inset-0 ${session.id === activeSessionId ? "" : "invisible"}`}
          >
            <ChatView
              sessionId={session.id}
              cwd={session.cwd}
              active={session.id === activeSessionId}
              connected={connectedSessionIds.has(session.id)}
              onPromptingChange={handlePromptingChange}
              onConnectionChange={handleConnectionChange}
            />
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="flex h-full items-center justify-center text-[var(--t-muted)] text-sm">
            No sessions. Click + to create one.
          </div>
        )}
      </div>
    </div>
  )
}
