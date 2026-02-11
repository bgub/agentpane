"use client"

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import type { Pane, LayoutState } from "@/lib/layout-types"
import { useSession } from "./session-provider"

const STORAGE_KEY = "agentpane:layout"
const OLD_STORAGE_KEY = "agentpane:activeSessionId"
const MAX_PANES = 4

interface LayoutContextValue {
  layout: LayoutState
  splitPane: (paneId: string) => void
  closePane: (paneId: string) => void
  focusPane: (paneId: string) => void
  openSessionInPane: (paneId: string, sessionId: string) => void
  closeTab: (paneId: string, sessionId: string) => void
  moveTab: (fromPaneId: string, toPaneId: string, sessionId: string) => void
  openSessionInFocusedPane: (sessionId: string) => void
  openSessionInNewPane: (sessionId: string) => void
  setPaneSizes: (sizes: number[]) => void
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext)
  if (!ctx) throw new Error("useLayout must be used within LayoutProvider")
  return ctx
}

let paneCounter = 0
function newPaneId(): string {
  return `pane-${Date.now()}-${++paneCounter}`
}

function makeDefaultLayout(sessionId?: string): LayoutState {
  const id = newPaneId()
  return {
    panes: [{
      id,
      tabSessionIds: sessionId ? [sessionId] : [],
      activeTabSessionId: sessionId ?? "",
    }],
    focusedPaneId: id,
    paneSizes: [100],
  }
}

function loadLayout(sessionIds: Set<string>): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as LayoutState
      // Validate and prune stale session IDs
      const panes = parsed.panes
        .map((p) => {
          const validTabs = p.tabSessionIds.filter((id) => sessionIds.has(id))
          return {
            ...p,
            tabSessionIds: validTabs,
            activeTabSessionId: validTabs.includes(p.activeTabSessionId)
              ? p.activeTabSessionId
              : validTabs[0] ?? "",
          }
        })
        .filter((p) => p.tabSessionIds.length > 0)

      if (panes.length > 0) {
        const focusedPaneId = panes.some((p) => p.id === parsed.focusedPaneId)
          ? parsed.focusedPaneId
          : panes[0].id
        const paneSizes = parsed.paneSizes.length === panes.length
          ? parsed.paneSizes
          : panes.map(() => 100 / panes.length)
        return { panes, focusedPaneId, paneSizes }
      }
    }
  } catch { /* ignore */ }

  // Migrate old activeSessionId key
  try {
    const oldId = localStorage.getItem(OLD_STORAGE_KEY)
    if (oldId && sessionIds.has(oldId)) {
      localStorage.removeItem(OLD_STORAGE_KEY)
      return makeDefaultLayout(oldId)
    }
  } catch { /* ignore */ }

  // Fallback: first session
  const first = sessionIds.values().next().value
  return makeDefaultLayout(first)
}

function evenSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count)
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const { sessions, activeSessionId, setActiveSession } = useSession()
  const sessionIds = new Set(sessions.map((s) => s.id))
  const [initialized, setInitialized] = useState(false)
  const [layout, setLayout] = useState<LayoutState>(() => makeDefaultLayout())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Initialize from localStorage once sessions load
  useEffect(() => {
    if (initialized || sessions.length === 0) return
    setLayout(loadLayout(sessionIds))
    setInitialized(true)
  }, [sessions, initialized]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save to localStorage
  useEffect(() => {
    if (!initialized) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
    }, 500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [layout, initialized])

  // Prune stale session IDs when sessions change
  useEffect(() => {
    if (!initialized) return
    setLayout((prev) => {
      let changed = false
      const panes = prev.panes.map((p) => {
        const validTabs = p.tabSessionIds.filter((id) => sessionIds.has(id))
        if (validTabs.length !== p.tabSessionIds.length) changed = true
        const activeTab = validTabs.includes(p.activeTabSessionId)
          ? p.activeTabSessionId
          : validTabs[0] ?? ""
        if (activeTab !== p.activeTabSessionId) changed = true
        return { ...p, tabSessionIds: validTabs, activeTabSessionId: activeTab }
      })
      if (!changed) return prev
      const nonEmpty = panes.filter((p) => p.tabSessionIds.length > 0)
      // Keep at least one pane
      const finalPanes = nonEmpty.length > 0 ? nonEmpty : [{ id: prev.panes[0]?.id ?? newPaneId(), tabSessionIds: [], activeTabSessionId: "" }]
      const focusedPaneId = finalPanes.some((p) => p.id === prev.focusedPaneId)
        ? prev.focusedPaneId
        : finalPanes[0].id
      return {
        panes: finalPanes,
        focusedPaneId,
        paneSizes: finalPanes.length === prev.panes.length ? prev.paneSizes : evenSizes(finalPanes.length),
      }
    })
  }, [sessions, initialized]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync focused pane's active tab → SessionProvider's activeSessionId
  useEffect(() => {
    if (!initialized) return
    const focused = layout.panes.find((p) => p.id === layout.focusedPaneId)
    if (focused?.activeTabSessionId && focused.activeTabSessionId !== activeSessionId) {
      setActiveSession(focused.activeTabSessionId)
    }
  }, [layout.focusedPaneId, layout.panes, initialized]) // eslint-disable-line react-hooks/exhaustive-deps

  // Watch for new sessions created via startSession (activeSessionId changes)
  const prevActiveRef = useRef(activeSessionId)
  useEffect(() => {
    if (!initialized) return
    if (activeSessionId && activeSessionId !== prevActiveRef.current) {
      // Check if this session is already open in any pane
      const alreadyOpen = layout.panes.some((p) => p.tabSessionIds.includes(activeSessionId))
      if (!alreadyOpen && sessionIds.has(activeSessionId)) {
        // Open in focused pane
        setLayout((prev) => {
          const panes = prev.panes.map((p) =>
            p.id === prev.focusedPaneId
              ? { ...p, tabSessionIds: [...p.tabSessionIds, activeSessionId], activeTabSessionId: activeSessionId }
              : p
          )
          return { ...prev, panes }
        })
      }
    }
    prevActiveRef.current = activeSessionId
  }, [activeSessionId, initialized]) // eslint-disable-line react-hooks/exhaustive-deps

  const splitPane = useCallback((paneId: string) => {
    setLayout((prev) => {
      if (prev.panes.length >= MAX_PANES) return prev
      const source = prev.panes.find((p) => p.id === paneId)
      if (!source || !source.activeTabSessionId) return prev
      const newPane: Pane = {
        id: newPaneId(),
        tabSessionIds: [source.activeTabSessionId],
        activeTabSessionId: source.activeTabSessionId,
      }
      const idx = prev.panes.findIndex((p) => p.id === paneId)
      const panes = [...prev.panes]
      panes.splice(idx + 1, 0, newPane)
      return { panes, focusedPaneId: newPane.id, paneSizes: evenSizes(panes.length) }
    })
  }, [])

  const closePane = useCallback((paneId: string) => {
    setLayout((prev) => {
      if (prev.panes.length <= 1) return prev
      const panes = prev.panes.filter((p) => p.id !== paneId)
      const focusedPaneId = prev.focusedPaneId === paneId ? panes[0].id : prev.focusedPaneId
      return { panes, focusedPaneId, paneSizes: evenSizes(panes.length) }
    })
  }, [])

  const focusPane = useCallback((paneId: string) => {
    setLayout((prev) => {
      if (prev.focusedPaneId === paneId) return prev
      return { ...prev, focusedPaneId: paneId }
    })
  }, [])

  const openSessionInPane = useCallback((paneId: string, sessionId: string) => {
    setLayout((prev) => {
      const panes = prev.panes.map((p) => {
        if (p.id !== paneId) return p
        if (p.tabSessionIds.includes(sessionId)) {
          return { ...p, activeTabSessionId: sessionId }
        }
        return { ...p, tabSessionIds: [...p.tabSessionIds, sessionId], activeTabSessionId: sessionId }
      })
      return { ...prev, panes, focusedPaneId: paneId }
    })
  }, [])

  const closeTab = useCallback((paneId: string, sessionId: string) => {
    setLayout((prev) => {
      const pane = prev.panes.find((p) => p.id === paneId)
      if (!pane) return prev
      const remaining = pane.tabSessionIds.filter((id) => id !== sessionId)
      if (remaining.length === 0) {
        // Close pane if >1 panes, otherwise leave empty
        if (prev.panes.length > 1) {
          const panes = prev.panes.filter((p) => p.id !== paneId)
          const focusedPaneId = prev.focusedPaneId === paneId ? panes[0].id : prev.focusedPaneId
          return { panes, focusedPaneId, paneSizes: evenSizes(panes.length) }
        }
        return {
          ...prev,
          panes: prev.panes.map((p) =>
            p.id === paneId ? { ...p, tabSessionIds: [], activeTabSessionId: "" } : p
          ),
        }
      }
      const activeTab = remaining.includes(pane.activeTabSessionId)
        ? pane.activeTabSessionId
        : remaining[Math.min(pane.tabSessionIds.indexOf(sessionId), remaining.length - 1)]
      return {
        ...prev,
        panes: prev.panes.map((p) =>
          p.id === paneId ? { ...p, tabSessionIds: remaining, activeTabSessionId: activeTab } : p
        ),
      }
    })
  }, [])

  const moveTab = useCallback((fromPaneId: string, toPaneId: string, sessionId: string) => {
    if (fromPaneId === toPaneId) return
    setLayout((prev) => {
      const fromPane = prev.panes.find((p) => p.id === fromPaneId)
      if (!fromPane || !fromPane.tabSessionIds.includes(sessionId)) return prev

      const fromRemaining = fromPane.tabSessionIds.filter((id) => id !== sessionId)
      let panes = prev.panes.map((p) => {
        if (p.id === fromPaneId) {
          const activeTab = fromRemaining.includes(p.activeTabSessionId)
            ? p.activeTabSessionId
            : fromRemaining[0] ?? ""
          return { ...p, tabSessionIds: fromRemaining, activeTabSessionId: activeTab }
        }
        if (p.id === toPaneId) {
          if (p.tabSessionIds.includes(sessionId)) {
            return { ...p, activeTabSessionId: sessionId }
          }
          return { ...p, tabSessionIds: [...p.tabSessionIds, sessionId], activeTabSessionId: sessionId }
        }
        return p
      })

      // Remove empty source pane if there are other panes
      if (fromRemaining.length === 0 && panes.length > 1) {
        panes = panes.filter((p) => p.id !== fromPaneId)
      }

      const focusedPaneId = panes.some((p) => p.id === toPaneId) ? toPaneId : panes[0].id
      return { panes, focusedPaneId, paneSizes: evenSizes(panes.length) }
    })
  }, [])

  const openSessionInFocusedPane = useCallback((sessionId: string) => {
    setLayout((prev) => {
      const paneId = prev.focusedPaneId
      const panes = prev.panes.map((p) => {
        if (p.id !== paneId) return p
        if (p.tabSessionIds.includes(sessionId)) {
          return { ...p, activeTabSessionId: sessionId }
        }
        return { ...p, tabSessionIds: [...p.tabSessionIds, sessionId], activeTabSessionId: sessionId }
      })
      return { ...prev, panes }
    })
  }, [])

  const openSessionInNewPane = useCallback((sessionId: string) => {
    setLayout((prev) => {
      if (prev.panes.length >= MAX_PANES) {
        // At max panes — fall back to opening in focused pane
        const panes = prev.panes.map((p) => {
          if (p.id !== prev.focusedPaneId) return p
          if (p.tabSessionIds.includes(sessionId)) {
            return { ...p, activeTabSessionId: sessionId }
          }
          return { ...p, tabSessionIds: [...p.tabSessionIds, sessionId], activeTabSessionId: sessionId }
        })
        return { ...prev, panes }
      }
      const newId = newPaneId()
      const newP: Pane = {
        id: newId,
        tabSessionIds: [sessionId],
        activeTabSessionId: sessionId,
      }
      const panes = [...prev.panes, newP]
      return { panes, focusedPaneId: newId, paneSizes: evenSizes(panes.length) }
    })
  }, [])

  const setPaneSizes = useCallback((sizes: number[]) => {
    setLayout((prev) => ({ ...prev, paneSizes: sizes }))
  }, [])

  const value: LayoutContextValue = {
    layout,
    splitPane,
    closePane,
    focusPane,
    openSessionInPane,
    closeTab,
    moveTab,
    openSessionInFocusedPane,
    openSessionInNewPane,
    setPaneSizes,
  }

  return (
    <LayoutContext value={value}>
      {children}
    </LayoutContext>
  )
}
