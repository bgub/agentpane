import { useState, useEffect, type KeyboardEvent, type DragEvent } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EllipsisVertical, Loader2, Plus, Sun, Moon, Monitor } from "lucide-react"
import { useTheme } from "next-themes"
import { DRAG_TYPES } from "@/lib/constants"
import { PROVIDER_INFO } from "./providers"
import { useSession } from "./session-provider"
import { useLayout } from "./layout-provider"
import type { Session } from "@/lib/types"
import { StatusDot } from "./status-dot"

function SessionItem({
  session,
  isHistory,
  isActive,
  isOpenInAnyPane,
  editingId,
  editValue,
  onEditValueChange,
  onEditKeyDown,
  onEditBlur,
  onClick,
  onStartRename,
  onDelete,
}: {
  session: Session
  isHistory: boolean
  isActive: boolean
  isOpenInAnyPane: boolean
  editingId: string | null
  editValue: string
  onEditValueChange: (value: string) => void
  onEditKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  onEditBlur: () => void
  onClick: () => void
  onStartRename: () => void
  onDelete: () => void
}) {
  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPES.sidebarSession, JSON.stringify({ sessionId: session.id }))
    e.dataTransfer.effectAllowed = "copyMove"
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={editingId !== session.id}
      onDragStart={handleDragStart}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick() } }}
      className={`group flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[13px] transition-colors ${
        isActive
          ? "bg-[var(--t-elevated)] text-[var(--t-white)] border-l-2 border-l-[var(--t-accent)]"
          : isOpenInAnyPane
            ? "bg-[var(--t-bg)]/50 text-[var(--t-text)] hover:bg-[var(--t-bg)] hover:text-[var(--t-bright)] border-l-2 border-l-[var(--t-dim)]"
            : isHistory
              ? "text-[var(--t-muted)] hover:bg-[var(--t-bg)] hover:text-[var(--t-text)] border-l-2 border-l-transparent"
              : "text-[var(--t-text)] hover:bg-[var(--t-bg)] hover:text-[var(--t-bright)] border-l-2 border-l-transparent"
      }`}
    >
      {editingId === session.id ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          className="flex-1 bg-[var(--t-bg)] text-[var(--t-white)] text-[13px] outline-none border border-[var(--t-dim)] rounded px-1.5 py-0.5"
          spellCheck={false}
        />
      ) : (
        <>
          <StatusDot session={session} />
          <span className="flex-1 truncate">{session.name}</span>
          {session.agent_type && (
            <span className="shrink-0 text-[10px] font-mono font-medium tracking-wide text-[var(--t-muted)]">
              {PROVIDER_INFO[session.agent_type]?.shortLabel ?? session.agent_type.toUpperCase()}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 shrink-0 cursor-pointer text-[var(--t-dim)] hover:text-[var(--t-bright)] hover:bg-[var(--t-dim)]/20 data-[state=open]:text-[var(--t-bright)] data-[state=open]:bg-[var(--t-dim)]/20 transition-colors rounded px-0.5 py-1"
              >
                <EllipsisVertical className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" className="min-w-32">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onStartRename()
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}

export default function Sidebar() {
  const {
    sessions,
    showSetup,
    backendStatus,
    createSession,
    deleteSession,
    renameSession,
  } = useSession()

  const { layout, openSessionInFocusedPane } = useLayout()

  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [showCheckingSpinner, setShowCheckingSpinner] = useState(false)

  // Show spinner after 2s of "checking" status (setState in timeout callback, not synchronous in effect)
  useEffect(() => {
    if (backendStatus !== "checking") return
    const timer = setTimeout(() => setShowCheckingSpinner(true), 2000)
    return () => clearTimeout(timer)
  }, [backendStatus])

  // Reset spinner when no longer checking (render-time)
  if (showCheckingSpinner && backendStatus !== "checking") {
    setShowCheckingSpinner(false)
  }

  const startRename = (id: string, currentName: string) => {
    setEditingId(id)
    setEditValue(currentName)
  }

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      renameSession(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commitRename()
    if (e.key === "Escape") setEditingId(null)
  }

  // Split sessions into active (connected) and history (disconnected)
  const activeSessions = sessions
    .filter((s) => s.connected)
    .sort((a, b) => b.created_at - a.created_at)

  const historySessions = sessions
    .filter((s) => !s.connected)
    .sort((a, b) => b.created_at - a.created_at)

  const focusedPane = layout.panes.find((p) => p.id === layout.focusedPaneId)

  return (
    <div className="flex h-full w-56 min-h-0 flex-col bg-[var(--t-surface)] border-r border-[var(--t-border)]">
      {/* Header — pinned top */}
      <div className="shrink-0">
        <div className="flex h-10 items-center justify-between px-4 border-b border-[var(--t-border)]">
          <span className="text-xs font-semibold text-[var(--t-bright)]">AgentPane</span>
          {showCheckingSpinner && (
            <Loader2 className="size-3 animate-spin text-[var(--t-dim)]" />
          )}
        </div>
        <div className="px-3 pt-3 pb-2">
          <button
            onClick={() => createSession()}
            className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
              showSetup
                ? "border-[var(--t-accent)] bg-[var(--t-accent)]/10 text-[var(--t-accent)]"
                : "border-[var(--t-border)] bg-[var(--t-bg)] text-[var(--t-text)] hover:bg-[var(--t-elevated)] hover:text-[var(--t-bright)] hover:border-[var(--t-dim)]"
            }`}
          >
            <Plus className="size-3.5" />
            New Session
          </button>
        </div>
      </div>

      {/* Session list — scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="py-1">
          {activeSessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isHistory={false}
              isActive={focusedPane?.activeTabSessionId === session.id && !showSetup}
              isOpenInAnyPane={layout.panes.some((p) => p.tabSessionIds.includes(session.id))}
              editingId={editingId}
              editValue={editValue}
              onEditValueChange={setEditValue}
              onEditKeyDown={handleEditKeyDown}
              onEditBlur={commitRename}
              onClick={() => openSessionInFocusedPane(session.id)}
              onStartRename={() => startRename(session.id, session.name)}
              onDelete={() => deleteSession(session.id)}
            />
          ))}

          {historySessions.length > 0 && (
            <>
              {activeSessions.length > 0 && (
                <div className="mx-3 my-2 border-t border-[var(--t-border)]" />
              )}
              <div className="px-3 py-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-dim)]">
                  History
                </span>
              </div>
              {historySessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isHistory
                  isActive={focusedPane?.activeTabSessionId === session.id && !showSetup}
                  isOpenInAnyPane={layout.panes.some((p) => p.tabSessionIds.includes(session.id))}
                  editingId={editingId}
                  editValue={editValue}
                  onEditValueChange={setEditValue}
                  onEditKeyDown={handleEditKeyDown}
                  onEditBlur={commitRename}
                  onClick={() => openSessionInFocusedPane(session.id)}
                  onStartRename={() => startRename(session.id, session.name)}
                  onDelete={() => deleteSession(session.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Footer — pinned bottom */}
      <div className="shrink-0 h-12 flex items-center px-3 border-t border-[var(--t-border)]">
        {mounted && (
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
            className="flex items-center gap-2 text-xs text-[var(--t-muted)] hover:text-[var(--t-bright)] transition-colors cursor-pointer"
            title={`Theme: ${theme}`}
          >
            {resolvedTheme === "dark" ? <Moon className="size-3.5" /> : resolvedTheme === "light" ? <Sun className="size-3.5" /> : <Monitor className="size-3.5" />}
            <span className="capitalize">{theme}</span>
          </button>
        )}
      </div>
    </div>
  )
}
