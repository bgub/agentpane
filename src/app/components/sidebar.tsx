"use client"

import { useState, useRef, useEffect, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Ellipsis, Plus } from "lucide-react"

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
  onSelect: (id: string) => void
  onCreate: (agentType?: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
}

export default function Sidebar({
  sessions,
  activeSessionId,
  connectedSessionIds,
  promptingSessionIds,
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

  const statusDot = (sessionId: string) => {
    if (promptingSessionIds.has(sessionId)) {
      // Amber pulsing: agent processing a prompt
      return <span className="shrink-0 size-1.5 rounded-full bg-amber-400 animate-pulse" />
    }
    if (connectedSessionIds.has(sessionId)) {
      // Green: agent connected, idle
      return <span className="shrink-0 size-1.5 rounded-full bg-green-400" />
    }
    // Gray: not connected
    return <span className="shrink-0 size-1.5 rounded-full bg-zinc-600" />
  }

  return (
    <div className="flex h-full w-60 min-h-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
        <span className="text-xs text-zinc-400 font-medium">Sessions</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 text-lg leading-none"
              title="New session"
            >
              <Plus className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="min-w-36">
            <DropdownMenuItem onClick={() => onCreate("claude-code")}>
              Claude Code
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCreate("codex")}>
              Codex
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => onSelect(session.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${
                session.id === activeSessionId
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {editingId === session.id ? (
                <input
                  ref={editInputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  onBlur={commitRename}
                  className="flex-1 bg-zinc-900 text-zinc-100 text-sm outline-none border border-zinc-700 rounded px-1"
                  spellCheck={false}
                />
              ) : (
                <>
                  {statusDot(session.id)}
                  <span className="flex-1 truncate">{session.name}</span>
                  <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 leading-none">
                    {session.agent_type === "claude-code" ? "claude" : session.agent_type}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => e.stopPropagation()}
                        className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 size-6 cursor-pointer text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 data-[state=open]:bg-zinc-700 data-[state=open]:text-zinc-300"
                      >
                        <Ellipsis className="size-3.5" />
                      </Button>
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
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
