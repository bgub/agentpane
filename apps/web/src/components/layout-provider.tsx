import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react"
import { MAX_PANES, type Pane, type LayoutState } from "@/lib/layout-types"
import { newPaneId, makeDefaultLayout, parseLayout, evenSizes } from "@/lib/layout-utils"
import { useSession } from "./session-provider"
import { api } from "@/lib/api"

interface LayoutContextValue {
  layout: LayoutState
  splitPane: (paneId: string) => void
  closePane: (paneId: string) => void
  focusPane: (paneId: string) => void
  openSessionInPane: (paneId: string, sessionId: string) => void
  closeTab: (paneId: string, sessionId: string) => void
  moveTab: (fromPaneId: string, toPaneId: string, sessionId: string) => void
  reorderTab: (paneId: string, sessionId: string, insertBeforeIndex: number) => void
  openSessionInFocusedPane: (sessionId: string) => void
  openSessionInNewPane: (sessionId: string) => void
  moveTabToNewPane: (fromPaneId: string, sessionId: string) => void
  setPaneSizes: (sizes: number[]) => void
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext)
  if (!ctx) throw new Error("useLayout must be used within LayoutProvider")
  return ctx
}

export function LayoutProvider({
  children,
  initialLayout,
}: {
  children: ReactNode
  initialLayout?: LayoutState | null | undefined
}) {
  const { sessions, activeSessionId, setActiveSession } = useSession()
  const sessionIds = new Set(sessions.map((s) => s.id))

  const [layout, setLayout] = useState<LayoutState>(() => initialLayout ?? makeDefaultLayout(undefined, "pane-default"))

  const [initialized, setInitialized] = useState(initialLayout != null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Client-side init: load saved layout from backend
  useEffect(() => {
    if (initialized || sessions.length === 0) return
    let cancelled = false

    const init = async () => {
      let res: Response | undefined
      try {
        res = await api.settings.get("layout")
      } catch { /* ignore */ }

      if (cancelled) return

      let layoutValue: string | undefined
      if (res !== undefined && res.ok) {
        const data = await res.json() as { value?: string }
        layoutValue = data !== null && data !== undefined ? data.value : undefined
      }
      if (layoutValue) {
        const parsed = parseLayout(layoutValue, sessionIds)
        if (parsed) {
          setLayout(parsed)
          setInitialized(true)
          return
        }
      }
      setInitialized(true)
    }

    void init()
    return () => { cancelled = true }
  }, [sessions, initialized]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save to backend
  useEffect(() => {
    if (!initialized) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      api.settings.set("layout", JSON.stringify(layout)).catch(() => {})
    }, 500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [layout, initialized])

  // Prune stale session IDs during render (before paint)
  if (initialized && layout.panes.some((p) => p.tabSessionIds.some((id) => id && !sessionIds.has(id)))) {
    const panes = layout.panes.map((p) => {
      const validTabs = p.tabSessionIds.filter((id) => sessionIds.has(id))
      const activeTab = validTabs.includes(p.activeTabSessionId)
        ? p.activeTabSessionId
        : validTabs[0] ?? ""
      return { ...p, tabSessionIds: validTabs, activeTabSessionId: activeTab }
    })
    const nonEmpty = panes.filter((p) => p.tabSessionIds.length > 0)
    const finalPanes = nonEmpty.length > 0 ? nonEmpty : [{ id: layout.panes[0]?.id ?? newPaneId(), tabSessionIds: [], activeTabSessionId: "" }]
    const focusedPaneId = finalPanes.some((p) => p.id === layout.focusedPaneId)
      ? layout.focusedPaneId
      : finalPanes[0].id
    setLayout({
      panes: finalPanes,
      focusedPaneId,
      paneSizes: finalPanes.length === layout.panes.length ? layout.paneSizes : evenSizes(finalPanes.length),
    })
  }

  // Sync focused pane's active tab → SessionProvider's activeSessionId
  useEffect(() => {
    if (!initialized) return
    const focused = layout.panes.find((p) => p.id === layout.focusedPaneId)
    if (focused?.activeTabSessionId && focused.activeTabSessionId !== activeSessionId) {
      setActiveSession(focused.activeTabSessionId)
    }
  }, [layout.focusedPaneId, layout.panes, initialized]) // eslint-disable-line react-hooks/exhaustive-deps

  // Open new sessions in focused pane during render (before paint)
  const [prevActiveSessionId, setPrevActiveSessionId] = useState(activeSessionId)
  if (initialized && activeSessionId && activeSessionId !== prevActiveSessionId) {
    setPrevActiveSessionId(activeSessionId)
    const alreadyOpen = layout.panes.some((p) => p.tabSessionIds.includes(activeSessionId))
    if (!alreadyOpen && sessionIds.has(activeSessionId)) {
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

  const splitPane = (paneId: string) => {
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
  }

  const closePane = (paneId: string) => {
    setLayout((prev) => {
      if (prev.panes.length <= 1) return prev
      const panes = prev.panes.filter((p) => p.id !== paneId)
      const focusedPaneId = prev.focusedPaneId === paneId ? panes[0].id : prev.focusedPaneId
      return { panes, focusedPaneId, paneSizes: evenSizes(panes.length) }
    })
  }

  const focusPane = (paneId: string) => {
    setLayout((prev) => {
      if (prev.focusedPaneId === paneId) return prev
      return { ...prev, focusedPaneId: paneId }
    })
  }

  const openSessionInPane = (paneId: string, sessionId: string) => {
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
  }

  const closeTab = (paneId: string, sessionId: string) => {
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
  }

  const moveTab = (fromPaneId: string, toPaneId: string, sessionId: string) => {
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
  }

  const reorderTab = (paneId: string, sessionId: string, insertBeforeIndex: number) => {
    setLayout((prev) => {
      const pane = prev.panes.find((p) => p.id === paneId)
      if (!pane) return prev
      const fromIndex = pane.tabSessionIds.indexOf(sessionId)
      if (fromIndex === -1) return prev
      if (fromIndex === insertBeforeIndex || fromIndex + 1 === insertBeforeIndex) return prev
      const tabs = [...pane.tabSessionIds]
      tabs.splice(fromIndex, 1)
      const adjustedIndex = insertBeforeIndex > fromIndex ? insertBeforeIndex - 1 : insertBeforeIndex
      tabs.splice(adjustedIndex, 0, sessionId)
      return {
        ...prev,
        panes: prev.panes.map((p) =>
          p.id === paneId ? { ...p, tabSessionIds: tabs } : p
        ),
      }
    })
  }

  const moveTabToNewPane = (fromPaneId: string, sessionId: string) => {
    setLayout((prev) => {
      if (prev.panes.length >= MAX_PANES) return prev
      const fromPane = prev.panes.find((p) => p.id === fromPaneId)
      if (!fromPane || !fromPane.tabSessionIds.includes(sessionId)) return prev

      const fromRemaining = fromPane.tabSessionIds.filter((id) => id !== sessionId)
      let panes: Pane[]
      if (fromRemaining.length === 0) {
        panes = prev.panes.filter((p) => p.id !== fromPaneId)
      } else {
        panes = prev.panes.map((p) => {
          if (p.id !== fromPaneId) return p
          const activeTab = fromRemaining.includes(p.activeTabSessionId)
            ? p.activeTabSessionId
            : fromRemaining[0] ?? ""
          return { ...p, tabSessionIds: fromRemaining, activeTabSessionId: activeTab }
        })
      }

      const newId = newPaneId()
      panes.push({
        id: newId,
        tabSessionIds: [sessionId],
        activeTabSessionId: sessionId,
      })
      return { panes, focusedPaneId: newId, paneSizes: evenSizes(panes.length) }
    })
  }

  const openSessionInFocusedPane = (sessionId: string) => {
    openSessionInPane(layout.focusedPaneId, sessionId)
  }

  const openSessionInNewPane = (sessionId: string) => {
    if (layout.panes.length >= MAX_PANES) {
      openSessionInPane(layout.focusedPaneId, sessionId)
      return
    }
    setLayout((prev) => {
      const newId = newPaneId()
      const newP: Pane = {
        id: newId,
        tabSessionIds: [sessionId],
        activeTabSessionId: sessionId,
      }
      const panes = [...prev.panes, newP]
      return { panes, focusedPaneId: newId, paneSizes: evenSizes(panes.length) }
    })
  }

  const setPaneSizes = (sizes: number[]) => {
    setLayout((prev) => ({ ...prev, paneSizes: sizes }))
  }

  const value: LayoutContextValue = {
    layout,
    splitPane,
    closePane,
    focusPane,
    openSessionInPane,
    closeTab,
    moveTab,
    reorderTab,
    openSessionInFocusedPane,
    openSessionInNewPane,
    moveTabToNewPane,
    setPaneSizes,
  }

  return (
    <LayoutContext value={value}>
      {children}
    </LayoutContext>
  )
}
