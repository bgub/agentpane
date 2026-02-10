"use client"

import { useState, useRef, useEffect, type KeyboardEvent } from "react"
import { Square } from "lucide-react"

interface ChatFooterProps {
  sessionId: string | null
  active: boolean
  prompting: boolean
  connecting: boolean
  connected: boolean
  onSend: (text: string) => void
  onCancel: () => void
}

export function ChatFooter({ sessionId, active, prompting, connecting, connected, onSend, onCancel }: ChatFooterProps) {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Clear input when session changes
  useEffect(() => {
    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }, [sessionId])

  // Focus textarea when ready
  useEffect(() => {
    if (active && !prompting && !connecting) textareaRef.current?.focus()
  }, [active, prompting, connecting])

  // Global keydown to focus textarea
  useEffect(() => {
    if (!active) return
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
  }, [active])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
    <div className="shrink-0 h-12 border-t border-[var(--t-border)] bg-[var(--t-surface)] px-5 flex items-center">
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
