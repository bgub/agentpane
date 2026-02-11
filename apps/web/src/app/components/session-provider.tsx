"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { api, setToken } from "@/lib/api"
import type { Session } from "@/lib/types"

interface SessionContextValue {
  sessions: Session[]
  activeSessionId: string | null
  connectedSessionIds: Set<string>
  promptingSessionIds: Set<string>
  backendStatus: "checking" | "online" | "offline" | "unauthorized"
  healthChecking: boolean
  showSetup: boolean

  setActiveSession: (id: string) => void
  createSession: () => void
  startSession: (agentType: string, cwd: string) => Promise<void>
  cancelSetup: () => void
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>
  retryHealth: () => void
  onPromptingChange: (sessionId: string, prompting: boolean) => void
  onConnectionChange: (sessionId: string, connected: boolean, config?: { cwd: string; agent_type: string }) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used within SessionProvider")
  return ctx
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, _setActiveSessionId] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline" | "unauthorized">("checking")
  const [healthChecking, setHealthChecking] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [connectedSessionIds, setConnectedSessionIds] = useState<Set<string>>(new Set())
  const [promptingSessionIds, setPromptingSessionIds] = useState<Set<string>>(new Set())

  const setActiveSessionId = useCallback((id: string | null) => {
    _setActiveSessionId(id)
    if (id) localStorage.setItem("agentpane:activeSessionId", id)
    else localStorage.removeItem("agentpane:activeSessionId")
  }, [])

  const loadSessions = useCallback(() => {
    api.sessions.list()
      .then((res) => {
        if (res.status === 401) {
          setToken(null)
          setBackendStatus("unauthorized")
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: Session[] | undefined) => {
        if (!data) return
        setSessions(data)
        setConnectedSessionIds(new Set(data.filter((s) => s.connected).map((s) => s.id)))
        setPromptingSessionIds(new Set(data.filter((s) => s.prompting).map((s) => s.id)))

        const saved = localStorage.getItem("agentpane:activeSessionId")
        if (saved && data.some((s) => s.id === saved)) {
          _setActiveSessionId(saved)
        } else if (data.length > 0) {
          _setActiveSessionId(data[0].id)
        }

        setBackendStatus("online")
      })
      .catch(() => setBackendStatus("online"))
  }, [])

  const checkHealth = useCallback(async () => {
    setHealthChecking(true)
    try {
      const res = await api.health()
      const data = await res.json()
      if (data?.app === "agentpane") {
        setHealthChecking(false)
        return true
      }
    } catch {}
    setBackendStatus("offline")
    setHealthChecking(false)
    return false
  }, [])

  // Read auth token from URL on mount, store in localStorage, strip from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get("token")
    if (token) {
      setToken(token)
      params.delete("token")
      const qs = params.toString()
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      window.history.replaceState({}, "", newUrl)
    }
  }, [])

  // Health check on mount, then load sessions if online
  useEffect(() => {
    checkHealth().then((online) => {
      if (online) loadSessions()
    })
  }, [checkHealth, loadSessions])

  // Poll: health check + status updates
  useEffect(() => {
    if (backendStatus === "checking") return
    const interval = setInterval(async () => {
      try {
        const res = await api.health()
        const data = await res.json()
        if (data?.app !== "agentpane") throw new Error()

        if (backendStatus === "offline" || backendStatus === "unauthorized") {
          loadSessions()
        }

        // Update status while online
        api.sessions.status()
          .then((res) => {
            if (res.status === 401) {
              setToken(null)
              setBackendStatus("unauthorized")
              return
            }
            if (!res.ok) return
            return res.json()
          })
          .then((data: { connected: string[]; prompting: string[] } | undefined) => {
            if (!data) return
            setConnectedSessionIds(new Set(data.connected))
            setPromptingSessionIds(new Set(data.prompting))
          })
          .catch(() => {})
      } catch {
        setBackendStatus("offline")
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [backendStatus, loadSessions])

  const createSession = useCallback(() => {
    setShowSetup(true)
    setActiveSessionId(null)
  }, [setActiveSessionId])

  const startSession = useCallback(
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

  const cancelSetup = useCallback(() => {
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

  const deleteSession = useCallback(async (id: string) => {
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
  }, [activeSessionId, setActiveSessionId])

  const renameSession = useCallback(async (id: string, name: string) => {
    const res = await api.sessions.rename(id, name)
    const updated: Session = await res.json()
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)))
  }, [])

  const retryHealth = useCallback(() => {
    checkHealth().then((online) => {
      if (online) loadSessions()
    })
  }, [checkHealth, loadSessions])

  const onPromptingChange = useCallback(
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

  const onConnectionChange = useCallback(
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

  const setActiveSession = useCallback((id: string) => {
    setShowSetup(false)
    setActiveSessionId(id)
  }, [setActiveSessionId])

  const value: SessionContextValue = {
    sessions,
    activeSessionId,
    connectedSessionIds,
    promptingSessionIds,
    backendStatus,
    healthChecking,
    showSetup,
    setActiveSession,
    createSession,
    startSession,
    cancelSetup,
    deleteSession,
    renameSession,
    retryHealth,
    onPromptingChange,
    onConnectionChange,
  }

  return (
    <SessionContext value={value}>
      {children}
    </SessionContext>
  )
}
