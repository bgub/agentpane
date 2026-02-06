"use client"

import { useState, useRef, useEffect, KeyboardEvent } from "react"

interface Session {
  id: string
  name: string
  cwd: string
  created_at: number
}

interface SidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
}

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [contextMenuId, setContextMenuId] = useState<string | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingId])

  useEffect(() => {
    const handleClick = () => setContextMenuId(null)
    document.addEventListener("click", handleClick)
    return () => document.removeEventListener("click", handleClick)
  }, [])

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenuId(id)
    setContextMenuPos({ x: e.clientX, y: e.clientY })
  }

  const startRename = (id: string, currentName: string) => {
    setEditingId(id)
    setEditValue(currentName)
    setContextMenuId(null)
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

  return (
    <div className="flex h-full w-60 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs text-zinc-400 font-medium">Sessions</span>
        <button
          onClick={onCreate}
          className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 text-lg leading-none"
          title="New session"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSelect(session.id)}
            onContextMenu={(e) => handleContextMenu(e, session.id)}
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
                <span className="flex-1 truncate">{session.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleContextMenu(e, session.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 text-xs px-1"
                >
                  ...
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {contextMenuId && (
        <div
          className="fixed z-50 rounded border border-zinc-700 bg-zinc-900 py-1 shadow-lg text-sm"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <button
            onClick={() => {
              const s = sessions.find((s) => s.id === contextMenuId)
              if (s) startRename(s.id, s.name)
            }}
            className="block w-full px-3 py-1 text-left text-zinc-300 hover:bg-zinc-800"
          >
            Rename
          </button>
          <button
            onClick={() => {
              onDelete(contextMenuId)
              setContextMenuId(null)
            }}
            className="block w-full px-3 py-1 text-left text-red-400 hover:bg-zinc-800"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
