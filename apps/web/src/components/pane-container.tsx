import { useState, useEffect, type ReactNode, type DragEvent } from "react"
import { Group, Panel, Separator, type Layout } from "react-resizable-panels"
import { Columns2 } from "lucide-react"
import { DRAG_TYPES, parseDragData } from "@/lib/constants"
import { useSession } from "./session-provider"
import { useLayout } from "./layout-provider"
import { BackendOfflineScreen } from "./backend-offline-screen"
import { SessionSetupScreen } from "./session-setup-screen"
import { PaneView } from "./pane-view"

export function PaneContainer() {
  const { backendStatus, showSetup } = useSession()
  const { layout, setPaneSizes, openSessionInNewPane, moveTabToNewPane } = useLayout()
  const [dragState, setDragState] = useState({ dragging: false, splitDropHover: false })

  // Listen globally for sidebar/tab drag start/end to reveal the split drop zone
  useEffect(() => {
    const handleDragStart = (e: globalThis.DragEvent) => {
      if (
        e.dataTransfer?.types.includes(DRAG_TYPES.sidebarSession) ||
        e.dataTransfer?.types.includes(DRAG_TYPES.paneTab)
      ) {
        setDragState((prev) => ({ ...prev, dragging: true }))
      }
    }
    const handleDragEnd = () => {
      setDragState({ dragging: false, splitDropHover: false })
    }
    document.addEventListener("dragstart", handleDragStart)
    document.addEventListener("dragend", handleDragEnd)
    document.addEventListener("drop", handleDragEnd)
    return () => {
      document.removeEventListener("dragstart", handleDragStart)
      document.removeEventListener("dragend", handleDragEnd)
      document.removeEventListener("drop", handleDragEnd)
    }
  }, [])

  const handleLayoutChanged = (layoutMap: Layout) => {
    const sizes = layout.panes.map((pane) => layoutMap[pane.id] ?? 100 / layout.panes.length)
    setPaneSizes(sizes)
  }

  const handleSplitDragOver = (e: DragEvent) => {
    const hasSidebar = e.dataTransfer.types.includes(DRAG_TYPES.sidebarSession)
    const hasTab = e.dataTransfer.types.includes(DRAG_TYPES.paneTab)
    if (!hasSidebar && !hasTab) return
    e.preventDefault()
    e.dataTransfer.dropEffect = hasSidebar ? "copy" : "move"
    setDragState((prev) => ({ ...prev, splitDropHover: true }))
  }

  const handleSplitDragLeave = () => setDragState((prev) => ({ ...prev, splitDropHover: false }))

  const handleSplitDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragState({ dragging: false, splitDropHover: false })
    // Sidebar drag → new pane (copies session)
    const sidebar = parseDragData<{ sessionId: string }>(e, DRAG_TYPES.sidebarSession)
    if (sidebar) {
      openSessionInNewPane(sidebar.sessionId)
      return
    }
    // Tab drag → move tab to new pane
    const tab = parseDragData<{ fromPaneId: string; sessionId: string }>(e, DRAG_TYPES.paneTab)
    if (tab) {
      moveTabToNewPane(tab.fromPaneId, tab.sessionId)
    }
  }

  if (backendStatus === "offline") {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--t-bg)]">
        <BackendOfflineScreen />
      </div>
    )
  }

  if (showSetup) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--t-bg)]">
        <SessionSetupScreen />
      </div>
    )
  }

  if (backendStatus === "checking") {
    return <div className="flex-1 min-w-0 min-h-0 bg-[var(--t-bg)]" />
  }

  // Build flat children array — Panel and Separator must be direct DOM children of Group
  const children: ReactNode[] = []
  layout.panes.forEach((pane, i) => {
    if (i > 0) {
      children.push(
        <Separator
          key={`sep-${pane.id}`}
          className="w-1 bg-[var(--t-surface)] hover:bg-[var(--t-accent)] active:bg-[var(--t-accent)] transition-colors cursor-col-resize"
        />
      )
    }
    children.push(
      <Panel
        key={pane.id}
        id={pane.id}
        defaultSize={`${layout.paneSizes[i] ?? 100 / layout.panes.length}%`}
        minSize="15%"
      >
        <PaneView paneId={pane.id} />
      </Panel>
    )
  })

  const canSplit = layout.panes.length < 4
  const showSplitZone = canSplit && dragState.dragging

  return (
    <div className="flex-1 min-w-0 min-h-0 flex">
      <div className="flex-1 min-w-0">
        <Group
          orientation="horizontal"
          onLayoutChanged={handleLayoutChanged}
          id="agentpane-panels"
        >
          {children}
        </Group>
      </div>

      {/* Drop zone on right edge — appears during sidebar drags, creates a new split pane */}
      {showSplitZone && (
        <button
          type="button"
          onDragOver={handleSplitDragOver}
          onDragLeave={handleSplitDragLeave}
          onDrop={handleSplitDrop}
          className={`shrink-0 flex items-center justify-center transition-all duration-150 ${
            dragState.splitDropHover
              ? "w-24 bg-[var(--t-accent)]/10 border-l-2 border-[var(--t-accent)]"
              : "w-8 bg-[var(--t-surface)]/50 border-l border-dashed border-[var(--t-dim)]"
          }`}
        >
          <div className={`flex flex-col items-center gap-1.5 transition-colors ${
            dragState.splitDropHover ? "text-[var(--t-accent)]" : "text-[var(--t-dim)]"
          }`}>
            <Columns2 className="size-4" />
            {dragState.splitDropHover && <span className="text-[10px] font-medium">Split</span>}
          </div>
        </button>
      )}
    </div>
  )
}
