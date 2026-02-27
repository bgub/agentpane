import { useState, useRef, useEffect, Fragment, type DragEvent } from "react"
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
  const { layout, openSessionInPane, closeTab, moveTab, reorderTab, splitPane, closePane, focusPane } = useLayout()
  const [dropTarget, setDropTarget] = useState(false)
  const [dropIndicator, setDropIndicator] = useState<number | null>(null)
  const dropIndicatorRef = useRef<number | null>(null)

  // Clear drag state on global dragend (handles drops outside valid targets)
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setDropTarget(false)
      setDropIndicator(null)
      dropIndicatorRef.current = null
    }
    document.addEventListener("dragend", handleGlobalDragEnd)
    return () => document.removeEventListener("dragend", handleGlobalDragEnd)
  }, [])

  const handleDragStart = (e: DragEvent, sessionId: string) => {
    e.dataTransfer.setData(DRAG_TYPES.paneTab, JSON.stringify({ fromPaneId: paneId, sessionId }))
    e.dataTransfer.effectAllowed = "move"
  }

  const handleTabDragOver = (e: DragEvent, tabIndex: number) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPES.paneTab)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const pos = e.clientX < midX ? tabIndex : tabIndex + 1
    dropIndicatorRef.current = pos
    setDropIndicator(pos)
  }

  const handleDragOver = (e: DragEvent) => {
    const hasTab = e.dataTransfer.types.includes(DRAG_TYPES.paneTab)
    const hasSidebar = e.dataTransfer.types.includes(DRAG_TYPES.sidebarSession)
    if (!hasTab && !hasSidebar) return
    e.preventDefault()
    e.dataTransfer.dropEffect = hasTab ? "move" : "copy"
    if (hasSidebar) setDropTarget(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropTarget(false)
      setDropIndicator(null)
      dropIndicatorRef.current = null
    }
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDropTarget(false)
    const indicatorPos = dropIndicatorRef.current
    setDropIndicator(null)
    dropIndicatorRef.current = null
    // Tab drag
    const tab = parseDragData<{ fromPaneId: string; sessionId: string }>(e, DRAG_TYPES.paneTab)
    if (tab) {
      if (tab.fromPaneId === paneId && indicatorPos !== null) {
        reorderTab(paneId, tab.sessionId, indicatorPos)
      } else if (tab.fromPaneId !== paneId) {
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
        {tabSessionIds.map((sessionId, i) => {
          const session = sessions.find((s) => s.id === sessionId)
          const isActive = sessionId === activeTabSessionId
          return (
            <Fragment key={sessionId}>
              {dropIndicator === i && (
                <div className="w-0.5 shrink-0 self-stretch my-1 rounded-full bg-[var(--t-accent)]" />
              )}
              <div
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                draggable
                onDragStart={(e) => handleDragStart(e, sessionId)}
                onDragOver={(e) => handleTabDragOver(e, i)}
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
            </Fragment>
          )
        })}
        {dropIndicator === tabSessionIds.length && (
          <div className="w-0.5 shrink-0 self-stretch my-1 rounded-full bg-[var(--t-accent)]" />
        )}
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
