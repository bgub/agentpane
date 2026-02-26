import { useState, type DragEvent } from "react"
import { X, Columns2, PanelRightClose } from "lucide-react"
import { DRAG_TYPES, parseDragData } from "@/lib/constants"
import { MAX_PANES } from "@/lib/layout-types"
import { useSession } from "./session-provider"
import { useLayout } from "./layout-provider"
import { StatusDot } from "./status-dot"

interface TabBarProps {
  paneId: string
  tabSessionIds: string[]
  activeTabSessionId: string
  isFocused: boolean
}

export function TabBar({ paneId, tabSessionIds, activeTabSessionId, isFocused }: TabBarProps) {
  const { sessions } = useSession()
  const { layout, openSessionInPane, closeTab, moveTab, splitPane, closePane, focusPane } = useLayout()
  const [dropTarget, setDropTarget] = useState(false)

  const handleDragStart = (e: DragEvent, sessionId: string) => {
    e.dataTransfer.setData(DRAG_TYPES.paneTab, JSON.stringify({ fromPaneId: paneId, sessionId }))
    e.dataTransfer.effectAllowed = "move"
  }

  const handleDragOver = (e: DragEvent) => {
    const hasTab = e.dataTransfer.types.includes(DRAG_TYPES.paneTab)
    const hasSidebar = e.dataTransfer.types.includes(DRAG_TYPES.sidebarSession)
    if (!hasTab && !hasSidebar) return
    e.preventDefault()
    e.dataTransfer.dropEffect = hasTab ? "move" : "copy"
    setDropTarget(true)
  }

  const handleDragLeave = () => {
    setDropTarget(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDropTarget(false)
    // Tab drag between panes
    const tab = parseDragData<{ fromPaneId: string; sessionId: string }>(e, DRAG_TYPES.paneTab)
    if (tab) {
      if (tab.fromPaneId === paneId) {
        openSessionInPane(paneId, tab.sessionId)
      } else {
        moveTab(tab.fromPaneId, paneId, tab.sessionId)
      }
      return
    }
    // Sidebar drag → open in this pane as new tab
    const sidebar = parseDragData<{ sessionId: string }>(e, DRAG_TYPES.sidebarSession)
    if (sidebar) {
      openSessionInPane(paneId, sidebar.sessionId)
      focusPane(paneId)
    }
  }


  // Only show tab bar when there are multiple tabs OR multiple panes
  const showBar = tabSessionIds.length > 1 || layout.panes.length > 1

  if (!showBar) return null

  return (
    <div
      className={`flex items-end shrink-0 bg-[var(--t-surface)] transition-colors ${
        dropTarget ? "ring-1 ring-inset ring-[var(--t-accent)]" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex-1 flex items-end min-w-0 overflow-x-auto scrollbar-none gap-px px-1.5 pt-1.5">
        {tabSessionIds.map((sessionId) => {
          const session = sessions.find((s) => s.id === sessionId)
          const isActive = sessionId === activeTabSessionId
          return (
            <div
              key={sessionId}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              draggable
              onDragStart={(e) => handleDragStart(e, sessionId)}
              onClick={() => {
                openSessionInPane(paneId, sessionId)
                focusPane(paneId)
              }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSessionInPane(paneId, sessionId); focusPane(paneId) } }}
              className={`group relative flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 text-[11px] cursor-pointer shrink-0 rounded-t-md transition-colors ${
                isActive
                  ? "bg-[var(--t-bg)] text-[var(--t-bright)]"
                  : "text-[var(--t-dim)] hover:text-[var(--t-text)] hover:bg-[var(--t-elevated)]/60"
              }`}
            >
              {isActive && (
                <span className={`absolute bottom-0 left-1.5 right-1.5 h-0.5 rounded-full ${
                  isFocused ? "bg-[var(--t-accent)]" : "bg-[var(--t-dim)]/50"
                }`} />
              )}
              <StatusDot session={session} size="sm" showDisconnected />
              <span className="truncate max-w-32">{session?.name ?? "Session"}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(paneId, sessionId)
                }}
                className={`shrink-0 p-0.5 rounded-sm transition-all ${
                  isActive
                    ? "text-[var(--t-dim)] hover:text-[var(--t-bright)] hover:bg-[var(--t-elevated)]"
                    : "opacity-0 group-hover:opacity-100 text-[var(--t-dim)] hover:text-[var(--t-bright)] hover:bg-[var(--t-dim)]/20"
                }`}
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center shrink-0 px-1.5 pb-1 gap-0.5">
        <button
          onClick={() => splitPane(paneId)}
          disabled={layout.panes.length >= MAX_PANES || !activeTabSessionId}
          className="p-1 rounded-sm text-[var(--t-dim)] hover:text-[var(--t-bright)] hover:bg-[var(--t-dim)]/20 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Split pane"
        >
          <Columns2 className="size-3" />
        </button>
        {layout.panes.length > 1 && (
          <button
            onClick={() => closePane(paneId)}
            className="p-1 rounded-sm text-[var(--t-dim)] hover:text-[var(--t-bright)] hover:bg-[var(--t-dim)]/20 transition-colors cursor-pointer"
            title="Close pane"
          >
            <PanelRightClose className="size-3" />
          </button>
        )}
      </div>
    </div>
  )
}
