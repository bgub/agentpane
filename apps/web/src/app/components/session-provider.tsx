"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api, setToken } from "@/lib/api"
import { useSessionsQuery, useStartSessionMutation, useDeleteSessionMutation, useRenameSessionMutation, queryKeys } from "@/lib/queries"
import type { Session } from "@/lib/types"
import type { InitialData } from "@/lib/server-api"

interface SessionContextValue {
  sessions: Session[]
  activeSessionId: string | null
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
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used within SessionProvider")
  return ctx
}

export function SessionProvider({ children, initialData }: { children: ReactNode; initialData?: InitialData | null }) {
  const queryClient = useQueryClient()
  const { data: sessions = [] } = useSessionsQuery()

  const [activeSessionId, _setActiveSessionId] = useState<string | null>(() => {
    if (!initialData?.sessions.length) return null
    // Derive from saved layout so server + client agree on initial active session
    if (initialData.layout) {
      try {
        const parsed = JSON.parse(initialData.layout) as {
          focusedPaneId?: string
          panes?: Array<{ id: string; activeTabSessionId?: string }>
        }
        if (Array.isArray(parsed.panes) && parsed.panes.length > 0) {
          const focused = parsed.panes.find((p) => p.id === parsed.focusedPaneId) ?? parsed.panes[0]
          if (focused.activeTabSessionId && initialData.sessions.some((s) => s.id === focused.activeTabSessionId)) {
            return focused.activeTabSessionId
          }
        }
      } catch { /* ignore */ }
    }
    const connected = initialData.sessions.find((s) => s.connected)
    return connected?.id ?? initialData.sessions[0].id
  })
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline" | "unauthorized">(
    initialData ? "online" : "checking"
  )
  const [healthChecking, setHealthChecking] = useState(false)
  const [showSetup, setShowSetup] = useState(false)

  const startSessionMutation = useStartSessionMutation()
  const deleteSessionMutation = useDeleteSessionMutation()
  const renameSessionMutation = useRenameSessionMutation()

  const setActiveSessionId = useCallback((id: string | null) => {
    _setActiveSessionId(id)
    if (id) localStorage.setItem("agentpane:activeSessionId", id)
    else localStorage.removeItem("agentpane:activeSessionId")
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

  // Sync auth token on mount: URL token takes priority, then SSR token from initialData
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get("token")
    if (urlToken) {
      setToken(urlToken)
      params.delete("token")
      const qs = params.toString()
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      window.history.replaceState({}, "", newUrl)
    } else if (initialData?.authToken) {
      setToken(initialData.authToken)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Health check on mount when no SSR data
  useEffect(() => {
    if (initialData) return
    checkHealth().then((online) => {
      if (online) queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    })
  }, [initialData, checkHealth, queryClient])

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
        if (backendStatus === "offline" || backendStatus === "unauthorized") {
          queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        }
      } catch {
        setBackendStatus("offline")
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [backendStatus, queryClient])

  const createSession = useCallback(() => {
    setShowSetup(true)
    setActiveSessionId(null)
  }, [setActiveSessionId])

  const startSession = useCallback(
    async (agentType: string, cwd: string) => {
      const session = await startSessionMutation.mutateAsync({ agentType, cwd })
      setActiveSessionId(session.id)
      setShowSetup(false)
    },
    [setActiveSessionId, startSessionMutation]
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
    await deleteSessionMutation.mutateAsync(id)
  }, [deleteSessionMutation])

  const renameSession = useCallback(async (id: string, name: string) => {
    await renameSessionMutation.mutateAsync({ id, name })
  }, [renameSessionMutation])

  const retryHealth = useCallback(() => {
    checkHealth().then((online) => {
      if (online) queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    })
  }, [checkHealth, queryClient])

  const setActiveSession = useCallback((id: string) => {
    setShowSetup(false)
    setActiveSessionId(id)
  }, [setActiveSessionId])

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
