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

export function SessionProvider({ children, initialData }: { children: ReactNode; initialData?: InitialData | null }) {
  const queryClient = useQueryClient()
  const { data: sessions = [] } = useSessionsQuery()

  const [activeSessionId, _setActiveSessionId] = useState<string | null>(
    initialData?.sessions[0]?.id ?? null
  )
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline" | "unauthorized">(
    initialData ? "online" : "checking"
  )
  const [healthChecking, setHealthChecking] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [connectedSessionIds, setConnectedSessionIds] = useState<Set<string>>(
    () => new Set(initialData?.sessions.filter((s) => s.connected).map((s) => s.id) ?? [])
  )
  const [promptingSessionIds, setPromptingSessionIds] = useState<Set<string>>(
    () => new Set(initialData?.sessions.filter((s) => s.prompting).map((s) => s.id) ?? [])
  )

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

  // Health check on mount, then trigger session refetch if online
  // When initialData is provided, data is already loaded — just restore active session from localStorage
  useEffect(() => {
    if (initialData) {
      const saved = localStorage.getItem("agentpane:activeSessionId")
      if (saved && initialData.sessions.some((s) => s.id === saved)) {
        _setActiveSessionId(saved)
      } else if (initialData.sessions.length > 0) {
        _setActiveSessionId(initialData.sessions[0].id)
      }
      return
    }
    checkHealth().then((online) => {
      if (online) {
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
      }
    })
  }, [initialData, checkHealth, queryClient])

  // When sessions query data arrives from a refetch, sync connected/prompting/activeSessionId
  useEffect(() => {
    if (sessions.length === 0) return
    setConnectedSessionIds(new Set(sessions.filter((s) => s.connected).map((s) => s.id)))
    setPromptingSessionIds(new Set(sessions.filter((s) => s.prompting).map((s) => s.id)))

    // Restore active session from localStorage if needed
    _setActiveSessionId((prev) => {
      if (prev && sessions.some((s) => s.id === prev)) return prev
      const saved = localStorage.getItem("agentpane:activeSessionId")
      if (saved && sessions.some((s) => s.id === saved)) return saved
      return sessions[0]?.id ?? null
    })
    setBackendStatus("online")
  }, [sessions])

  // Poll: health check only (connected/prompting state driven by SSE events)
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
      if (session.connected) {
        setConnectedSessionIds((prev) => new Set([...prev, session.id]))
      }
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
  }, [deleteSessionMutation])

  const renameSession = useCallback(async (id: string, name: string) => {
    await renameSessionMutation.mutateAsync({ id, name })
  }, [renameSessionMutation])

  const retryHealth = useCallback(() => {
    checkHealth().then((online) => {
      if (online) queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    })
  }, [checkHealth, queryClient])

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
        queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
          old?.map((s) =>
            s.id === sessionId ? { ...s, cwd: config.cwd, agent_type: config.agent_type } : s
          )
        )
      }
    },
    [queryClient]
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
