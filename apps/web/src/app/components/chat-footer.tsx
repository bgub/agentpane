"use client"

import { useState, useRef, useEffect, type KeyboardEvent } from "react"
import { Square } from "lucide-react"
import type { AvailableCommand } from "./chat-view/types"

interface ChatFooterProps {
  sessionId: string | null
  active: boolean
  prompting: boolean
  connecting: boolean
  connected: boolean
  availableCommands: AvailableCommand[]
  onSend: (text: string) => void
  onCancel: () => void
  autoFocus?: boolean
}

export function ChatFooter({ sessionId, active, prompting, connecting, connected, availableCommands, onSend, onCancel, autoFocus = true }: ChatFooterProps) {
  const [input, setInput] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Compute filtered commands based on current input
  const filteredCommands = (() => {
    if (!input.startsWith("/") || availableCommands.length === 0) return []
    const prefix = input.slice(1).toLowerCase()
    // Only show autocomplete when typing the command (no space yet)
    if (input.includes(" ")) return []
    return availableCommands.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(prefix)
    )
  })()

  const showAutocomplete = filteredCommands.length > 0 && !prompting && !connecting

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [input])

  // Clear input when session changes
  useEffect(() => {
    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }, [sessionId])

  // Focus textarea when ready (only in focused pane)
  useEffect(() => {
    if (autoFocus && active && !prompting && !connecting) textareaRef.current?.focus()
  }, [autoFocus, active, prompting, connecting])

  // Global keydown to focus textarea (only in focused pane)
  useEffect(() => {
    if (!autoFocus || !active) return
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.metaKey || e.ctrlKey || e.altKey
      ) return
      if (e.key.length === 1) textareaRef.current?.focus()
    }
    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [autoFocus, active])

  const selectCommand = (cmd: AvailableCommand) => {
    setInput(`/${cmd.name} `)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showAutocomplete) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault()
        const cmd = filteredCommands[selectedIndex]
        if (cmd) selectCommand(cmd)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setInput("")
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const trimmed = input.trim()
      if (trimmed && !prompting) {
        setInput("")
        if (textareaRef.current) textareaRef.current.style.height = "auto"
        onSend(trimmed)
      }
    }
    if (e.key === "Escape" && prompting) {
      onCancel()
    }
  }

  const handleInputChange = (value: string) => {
    setInput(value)
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }

  return (
    <div className="shrink-0 h-12 border-t border-[var(--t-border)] bg-[var(--t-surface)] px-5 flex items-center relative">
      {/* Autocomplete dropdown */}
      {showAutocomplete && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-0 right-0 px-5 pb-1"
        >
          <div className="max-w-3xl mx-auto rounded-md border border-[var(--t-border)] bg-[var(--t-surface)] shadow-lg overflow-hidden">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.name}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectCommand(cmd)
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors cursor-pointer ${
                  i === selectedIndex
                    ? "bg-[var(--t-elevated)]"
                    : "hover:bg-[var(--t-elevated)]/50"
                }`}
              >
                <span className="font-mono text-[var(--t-accent)] shrink-0">/{cmd.name}</span>
                <span className="text-[var(--t-muted)] truncate text-xs">{cmd.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto w-full flex items-center gap-2.5">
        <span className={`shrink-0 text-sm font-mono select-none ${
          !active || prompting || connecting ? "text-[var(--t-dim)]" : "text-[var(--t-accent)]"
        }`}>
          &#10095;
        </span>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!active || prompting || connecting}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-[var(--t-bright)] outline-none placeholder:text-[var(--t-dim)] disabled:opacity-40"
          style={{ caretColor: 'var(--t-accent)' }}
          placeholder={
            !active
              ? ""
              : connecting
                ? "Connecting agent..."
                : prompting
                  ? "Agent is thinking..."
                  : !connected
                    ? "Send a message to reconnect..."
                    : "Send a message..."
          }
          spellCheck={false}
        />
        {active && prompting ? (
          <button
            onClick={onCancel}
            className="shrink-0 rounded-md bg-[var(--t-red)]/15 p-2 text-[var(--t-red)] hover:bg-[var(--t-red)]/25 transition-colors cursor-pointer"
            title="Stop (Esc)"
          >
            <Square className="size-3.5" />
          </button>
        ) : active ? (
          <span className="shrink-0 text-xs text-[var(--t-muted)] select-none">
            enter &#8629;
          </span>
        ) : null}
      </div>
    </div>
  )
}
