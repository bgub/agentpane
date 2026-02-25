import type { Pane, LayoutState } from "./layout-types"

let paneCounter = 0
export function newPaneId(): string {
  return `pane-${Date.now()}-${++paneCounter}`
}

export function makeDefaultLayout(sessionId?: string, paneId?: string): LayoutState {
  const id = paneId ?? newPaneId()
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

export function parseLayout(raw: string, sessionIds: Set<string>): LayoutState | null {
  try {
    const parsed = JSON.parse(raw) as LayoutState
    if (!Array.isArray(parsed.panes)) return null
    const panes = parsed.panes
      .map((p) => {
        const validTabs = p.tabSessionIds.filter((id: string) => sessionIds.has(id))
        return {
          ...p,
          tabSessionIds: validTabs,
          activeTabSessionId: validTabs.includes(p.activeTabSessionId)
            ? p.activeTabSessionId
            : validTabs[0] ?? "",
        }
      })
      .filter((p: Pane) => p.tabSessionIds.length > 0)

    if (panes.length > 0) {
      const focusedPaneId = panes.some((p: Pane) => p.id === parsed.focusedPaneId)
        ? parsed.focusedPaneId
        : panes[0].id
      const paneSizes = parsed.paneSizes?.length === panes.length
        ? parsed.paneSizes
        : panes.map(() => 100 / panes.length)
      return { panes, focusedPaneId, paneSizes }
    }
  } catch { /* ignore */ }
  return null
}

export function evenSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count)
}
