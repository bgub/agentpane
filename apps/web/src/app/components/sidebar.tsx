"use client"

import { useState, useRef, useEffect, type KeyboardEvent } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { EllipsisVertical, Plus } from "lucide-react"
import { PROVIDER_INFO } from "./providers"

interface Session {
  id: string
  name: string
  cwd: string
  agent_type: string
  created_at: number
}

interface SidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  connectedSessionIds: Set<string>
  promptingSessionIds: Set<string>
  showSetup: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
}

export default function Sidebar({
  sessions,
  activeSessionId,
  connectedSessionIds,
  promptingSessionIds,
  showSetup,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingId])

  const startRename = (id: string, currentName: string) => {
    setEditingId(id)
    setEditValue(currentName)
  }

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commitRename()
    if (e.key === "Escape") setEditingId(null)
  }

  // Split sessions into active (connected) and history (disconnected)
  const activeSessions = sessions
    .filter((s) => connectedSessionIds.has(s.id))
    .sort((a, b) => b.created_at - a.created_at)

  const historySessions = sessions
    .filter((s) => !connectedSessionIds.has(s.id))
    .sort((a, b) => b.created_at - a.created_at)

  const statusDot = (sessionId: string) => {
    if (promptingSessionIds.has(sessionId)) {
      return <span className="shrink-0 size-2 rounded-full bg-[var(--t-amber)] animate-pulse" />
    }
    if (connectedSessionIds.has(sessionId)) {
      return <span className="shrink-0 size-2 rounded-full bg-[var(--t-green)]" />
    }
    return null
  }

  const renderSession = (session: Session, isHistory: boolean) => {
    const isActive = session.id === activeSessionId && !showSetup

    return (
      <div
        key={session.id}
        onClick={() => onSelect(session.id)}
        className={`group flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[13px] transition-colors ${
          isActive
            ? "bg-[var(--t-elevated)] text-[var(--t-white)] border-l-2 border-l-[var(--t-accent)]"
            : isHistory
              ? "text-[var(--t-muted)] hover:bg-[var(--t-bg)] hover:text-[var(--t-text)] border-l-2 border-l-transparent"
              : "text-[var(--t-text)] hover:bg-[var(--t-bg)] hover:text-[var(--t-bright)] border-l-2 border-l-transparent"
        }`}
      >
        {editingId === session.id ? (
          <input
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={commitRename}
            className="flex-1 bg-[var(--t-bg)] text-[var(--t-white)] text-[13px] outline-none border border-[var(--t-dim)] rounded px-1.5 py-0.5"
            spellCheck={false}
          />
        ) : (
          <>
            {statusDot(session.id)}
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
                    startRename(session.id, session.name)
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(session.id)
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

  return (
    <div className="flex h-full w-56 min-h-0 flex-col bg-[var(--t-surface)] border-r border-[var(--t-border)]">
      {/* New session button */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <button
          onClick={() => onCreate()}
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

      {/* Session list */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {/* Active sessions */}
          {activeSessions.map((session) => renderSession(session, false))}

          {/* History divider */}
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
              {historySessions.map((session) => renderSession(session, true))}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Branding */}
      <div className="shrink-0 h-12 flex items-center px-3 border-t border-[var(--t-border)]">
        <span className="text-xs font-medium text-[var(--t-muted)]">acapa</span>
      </div>
    </div>
  )
}
