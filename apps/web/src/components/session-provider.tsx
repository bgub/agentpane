import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useSessionsQuery, useStartSessionMutation, useDeleteSessionMutation, useRenameSessionMutation, queryKeys } from "@/lib/queries"
import type { Session } from "@/lib/types"

interface SessionContextValue {
  sessions: Session[]
  activeSessionId: string | null
  backendStatus: "checking" | "online" | "offline"
  healthChecking: boolean
  showSetup: boolean

  setActiveSession: (id: string) => void
  createSession: () => void
  startSession: (agentType: string, cwd: string) => Promise<void>
  cancelSetup: () => void
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>
  retryHealth: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used within SessionProvider")
  return ctx
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const sessionsQuery = useSessionsQuery()
  const sessions = sessionsQuery.data ?? []

  const [activeSessionId, _setActiveSessionId] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking")
  const [healthChecking, setHealthChecking] = useState(false)
  const [showSetup, setShowSetup] = useState(false)

  const startSessionMutation = useStartSessionMutation()
  const deleteSessionMutation = useDeleteSessionMutation()
  const renameSessionMutation = useRenameSessionMutation()

  const setActiveSessionId = (id: string | null) => {
    _setActiveSessionId(id)
    if (id) localStorage.setItem("agentpane:activeSessionId", id)
    else localStorage.removeItem("agentpane:activeSessionId")
  }

  const runHealthCheck = async (onOnline?: () => void) => {
    setHealthChecking(true)
    try {
      const res = await api.health()
      const data = await res.json()
      if (data?.app === "agentpane") {
        setBackendStatus("online")
        onOnline?.()
        setHealthChecking(false)
        return
      }
    } catch {}
    setBackendStatus("offline")
    setHealthChecking(false)
  }

  // Health check on mount
  useEffect(() => {
    void runHealthCheck()
  }, [])

  useEffect(() => {
    if (sessionsQuery.isSuccess) {
      setBackendStatus("online")
    }
  }, [sessionsQuery.isSuccess])

  // Keep activeSessionId valid and mark backend online when sessions arrive
  useEffect(() => {
    if (sessions.length === 0) return
    _setActiveSessionId((prev) => prev && sessions.some((s) => s.id === prev) ? prev : sessions[0]?.id ?? null)
    setBackendStatus("online")
  }, [sessions])

  // Poll health
  useEffect(() => {
    if (backendStatus === "checking") return
    const interval = setInterval(async () => {
      try {
        const res = await api.health()
        const data = await res.json()
        if (data?.app !== "agentpane") throw new Error()
        if (backendStatus === "offline") {
          queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        }
      } catch {
        setBackendStatus("offline")
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [backendStatus, queryClient])

  const createSession = () => {
    setShowSetup(true)
    setActiveSessionId(null)
  }

  const startSession = async (agentType: string, cwd: string) => {
    const session = await startSessionMutation.mutateAsync({ agentType, cwd })
    setActiveSessionId(session.id)
    setShowSetup(false)
  }

  const cancelSetup = () => {
    setShowSetup(false)
    if (sessions.length > 0) {
      const saved = localStorage.getItem("agentpane:activeSessionId")
      if (saved && sessions.some((s) => s.id === saved)) {
        _setActiveSessionId(saved)
      } else {
        _setActiveSessionId(sessions[0].id)
      }
    }
  }

  const deleteSession = async (id: string) => {
    await deleteSessionMutation.mutateAsync(id)
  }

  const renameSession = async (id: string, name: string) => {
    await renameSessionMutation.mutateAsync({ id, name })
  }

  const retryHealth = () => {
    void runHealthCheck(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    })
  }

  const setActiveSession = (id: string) => {
    setShowSetup(false)
    setActiveSessionId(id)
  }

  return (
    <SessionContext value={{
      sessions,
      activeSessionId,
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
    }}>
      {children}
    </SessionContext>
  )
}
