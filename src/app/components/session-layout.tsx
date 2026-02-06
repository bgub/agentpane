"use client"

import { useState, useEffect, useCallback } from "react"
import Sidebar from "./sidebar"
import Terminal from "./terminal"

interface Session {
  id: string
  name: string
  cwd: string
  created_at: number
  running?: boolean
}

export default function SessionLayout() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set())

  const fetchSessions = useCallback(async () => {
    const res = await fetch("/api/sessions")
    const data: Session[] = await res.json()
    setSessions(data)
    setRunningSessionIds(
      new Set(data.filter((s) => s.running).map((s) => s.id))
    )
    return data
  }, [])

  // Load sessions on mount
  useEffect(() => {
    fetchSessions().then((data) => {
      if (data.length === 0) {
        // Auto-create first session
        fetch("/api/sessions", { method: "POST" })
          .then((res) => res.json())
          .then((session: Session) => {
            setSessions([session])
            setActiveSessionId(session.id)
            setInitialized(true)
          })
      } else {
        setActiveSessionId(data[0].id)
        setInitialized(true)
      }
    })
  }, [fetchSessions])

  const handleCreate = async () => {
    const res = await fetch("/api/sessions", { method: "POST" })
    const session: Session = await res.json()
    setSessions((prev) => [...prev, session])
    setActiveSessionId(session.id)
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
  }

  const handleRename = async (id: string, name: string) => {
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    const updated: Session = await res.json()
    setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)))
  }

  const handleRunningChange = useCallback(
    (sessionId: string, running: boolean) => {
      setRunningSessionIds((prev) => {
        const next = new Set(prev)
        if (running) next.add(sessionId)
        else next.delete(sessionId)
        return next
      })
    },
    []
  )

  const handleCwdChange = useCallback(
    (sessionId: string, cwd: string) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, cwd } : s))
      )
    },
    []
  )

  if (!initialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500 font-mono text-sm">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        runningSessionIds={runningSessionIds}
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
            <Terminal
              sessionId={session.id}
              active={session.id === activeSessionId}
              cwd={session.cwd}
              onCwdChange={handleCwdChange}
              onRunningChange={handleRunningChange}
            />
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-500 font-mono text-sm">
            No session selected. Click + to create one.
          </div>
        )}
      </div>
    </div>
  )
}
