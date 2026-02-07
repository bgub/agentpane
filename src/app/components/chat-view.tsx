"use client"

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react"
import { Square } from "lucide-react"

interface TurnData {
  id: string
  session_id: string
  role: "user" | "assistant"
  stop_reason: string | null
  created_at: number
  blocks: BlockData[]
}

interface BlockData {
  id: string
  turn_id: string
  kind: string
  content: string
  created_at: number
}

interface ChatViewProps {
  sessionId: string
  cwd: string
  active: boolean
  connected: boolean
  onPromptingChange?: (sessionId: string, prompting: boolean) => void
  onConnectionChange?: (sessionId: string, connected: boolean) => void
}

function ToolCallBlock({ block }: { block: BlockData }) {
  const [expanded, setExpanded] = useState(false)
  let toolInfo: { toolName?: string; input?: Record<string, unknown> } = {}
  try {
    toolInfo = JSON.parse(block.content)
  } catch { /* ignore */ }

  const toolName = toolInfo.toolName || block.kind
  const hasInput = toolInfo.input && Object.keys(toolInfo.input).length > 0

  return (
    <div className="my-1.5">
      <button
        onClick={() => hasInput && setExpanded(!expanded)}
        className={`flex items-center gap-1.5 text-xs font-mono transition-colors ${hasInput ? "cursor-pointer hover:text-[var(--t-bright)]" : "cursor-default"}`}
        style={{ color: 'var(--t-blue)' }}
      >
        <span className="text-[var(--t-dim)]">{expanded ? "▾" : "▸"}</span>
        <span>{toolName}</span>
      </button>
      {expanded && hasInput && (
        <pre
          className="mt-1 ml-4 text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap text-[var(--t-muted)]"
        >
          {JSON.stringify(toolInfo.input, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function ChatView({
  sessionId,
  cwd,
  active,
  connected,
  onPromptingChange,
  onConnectionChange,
}: ChatViewProps) {
  const [turns, setTurns] = useState<TurnData[]>([])
  const [streamingText, setStreamingText] = useState("")
  const [input, setInput] = useState("")
  const [prompting, setPrompting] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const accumulatedRef = useRef("")

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, streamingText])

  // Focus textarea when active
  useEffect(() => {
    if (active && !prompting) textareaRef.current?.focus()
  }, [active, prompting])

  // Notify parent of prompting state
  useEffect(() => {
    onPromptingChange?.(sessionId, prompting)
  }, [prompting, sessionId, onPromptingChange])

  // Load conversation on mount
  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/conversation`)
      .then((res) => res.json())
      .then((data: TurnData[]) => {
        setTurns(data)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [sessionId])

  // Ensure agent is connected (auto-connect if not)
  const ensureConnected = useCallback(async (): Promise<string | true> => {
    if (connected) return true
    setConnecting(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/connect`, {
        method: "POST",
      })
      if (res.ok) {
        onConnectionChange?.(sessionId, true)
        return true
      }
      const body = await res.json().catch(() => ({ error: "Unknown error" }))
      return body.error || "Connection failed"
    } catch {
      return "Network error"
    } finally {
      setConnecting(false)
    }
  }, [connected, sessionId, onConnectionChange])

  const cancelPrompt = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
  }, [])

  const sendPrompt = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || prompting) return

      // Ensure agent is connected before prompting
      const connectResult = await ensureConnected()
      if (connectResult !== true) {
        setStreamingText(`Error: ${connectResult}`)
        return
      }

      setInput("")
      setPrompting(true)
      setStreamingText("")
      accumulatedRef.current = ""

      // Add user turn optimistically
      const userTurn: TurnData = {
        id: `temp-user-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        stop_reason: "end_turn",
        created_at: Date.now(),
        blocks: [
          {
            id: `temp-block-${Date.now()}`,
            turn_id: `temp-user-${Date.now()}`,
            kind: "text",
            content: trimmed,
            created_at: Date.now(),
          },
        ],
      }
      setTurns((prev) => [...prev, userTurn])

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(`/api/sessions/${sessionId}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmed }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }))
          setStreamingText(`Error: ${err.error}`)
          setPrompting(false)
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          setPrompting(false)
          return
        }

        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (
                data.sessionUpdate === "agent_message_chunk" &&
                data.content?.type === "text"
              ) {
                accumulatedRef.current += data.content.text
                setStreamingText(accumulatedRef.current)
              } else if (data.sessionUpdate === "done") {
                // Finalize: add assistant turn to turns array
                if (accumulatedRef.current) {
                  const assistantTurn: TurnData = {
                    id: `temp-assistant-${Date.now()}`,
                    session_id: sessionId,
                    role: "assistant",
                    stop_reason: data.stopReason || "end_turn",
                    created_at: Date.now(),
                    blocks: [
                      {
                        id: `temp-ablock-${Date.now()}`,
                        turn_id: `temp-assistant-${Date.now()}`,
                        kind: "text",
                        content: accumulatedRef.current,
                        created_at: Date.now(),
                      },
                    ],
                  }
                  setTurns((prev) => [...prev, assistantTurn])
                }
                setStreamingText("")
              } else if (data.sessionUpdate === "error") {
                setStreamingText(
                  (prev) => prev + `\n\nError: ${data.message}`
                )
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User cancelled
          if (accumulatedRef.current) {
            const assistantTurn: TurnData = {
              id: `temp-cancelled-${Date.now()}`,
              session_id: sessionId,
              role: "assistant",
              stop_reason: "cancelled",
              created_at: Date.now(),
              blocks: [
                {
                  id: `temp-cblock-${Date.now()}`,
                  turn_id: `temp-cancelled-${Date.now()}`,
                  kind: "text",
                  content: accumulatedRef.current + "\n\n[cancelled]",
                  created_at: Date.now(),
                },
              ],
            }
            setTurns((prev) => [...prev, assistantTurn])
          }
          setStreamingText("")
        }
      } finally {
        abortRef.current = null
        setPrompting(false)
      }
    },
    [prompting, sessionId, ensureConnected]
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendPrompt(input)
    }
    if (e.key === "Escape" && prompting) {
      cancelPrompt()
    }
  }

  // Auto-resize textarea
  const handleInputChange = (value: string) => {
    setInput(value)
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--t-bg)]">
      {/* Top status bar */}
      <div className="flex h-10 shrink-0 items-center justify-between px-4 bg-[var(--t-surface)] border-b border-[var(--t-border)]">
        <span className="text-xs font-semibold text-[var(--t-accent)] truncate min-w-0">{cwd.replace(/^\/home\/[^/]+/, '~')}</span>
        <div className="flex items-center gap-3 text-xs">
          {prompting && (
            <span className="flex items-center gap-1.5 text-[var(--t-amber)]">
              <span className="size-1.5 rounded-full bg-[var(--t-amber)] animate-pulse" />
              thinking
            </span>
          )}
          <span className={`flex items-center gap-1.5 ${
            connecting
              ? "text-[var(--t-amber)]"
              : connected
                ? "text-[var(--t-green)]"
                : "text-[var(--t-dim)]"
          }`}>
            <span className={`size-1.5 rounded-full ${
              connecting
                ? "bg-[var(--t-amber)] animate-pulse"
                : connected
                  ? "bg-[var(--t-green)]"
                  : "bg-[var(--t-dim)]"
            }`} />
            {connecting ? "connecting" : connected ? "connected" : "disconnected"}
          </span>
        </div>
      </div>

      {/* Message stream */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-1">
          {!loaded && (
            <div className="text-sm text-[var(--t-muted)] py-2">Loading...</div>
          )}

          {turns.map((turn) => (
            <div key={turn.id}>
              {turn.role === "user" ? (
                /* User prompt — highlighted block */
                <div className="mt-5 mb-3 -mx-3 px-3 py-2.5 rounded-lg bg-[var(--t-elevated)]">
                  <div className="flex items-start gap-2.5">
                    <span className="shrink-0 text-sm font-mono text-[var(--t-accent)] select-none leading-relaxed">&#10095;</span>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--t-white)]">
                      {turn.blocks
                        .filter((b) => b.kind === "text")
                        .map((b) => b.content)
                        .join("\n")}
                    </div>
                  </div>
                </div>
              ) : (
                /* Assistant response */
                <div className="py-1">
                  {turn.blocks
                    .filter((b) => b.kind === "text")
                    .map((b) => (
                      <div
                        key={b.id}
                        className="text-sm leading-[1.7] whitespace-pre-wrap text-[var(--t-text)] pl-5 border-l-2 border-[var(--t-border)]"
                      >
                        {b.content}
                      </div>
                    ))}
                  {turn.blocks
                    .filter(
                      (b) =>
                        b.kind === "tool_call" ||
                        b.kind === "tool_call_update"
                    )
                    .map((b) => (
                      <div key={b.id} className="pl-5 border-l-2 border-[var(--t-border)]">
                        <ToolCallBlock block={b} />
                      </div>
                    ))}
                  {turn.stop_reason && turn.stop_reason !== "end_turn" && (
                    <div className="pl-5 mt-1 text-[11px] font-mono text-[var(--t-dim)]">
                      [{turn.stop_reason}]
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Streaming assistant output */}
          {streamingText && (
            <div className="py-1">
              <div className="text-sm leading-[1.7] whitespace-pre-wrap text-[var(--t-text)] pl-5 border-l-2 border-[var(--t-accent)]">
                {streamingText}
                <span className="inline-block ml-0.5 animate-block-blink text-[var(--t-accent)]">&#9608;</span>
              </div>
            </div>
          )}

          {/* Waiting for response */}
          {prompting && !streamingText && (
            <div className="py-1">
              <div className="text-sm text-[var(--t-muted)] pl-5 border-l-2 border-[var(--t-accent)]">
                <span className="animate-pulse">...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-[var(--t-border)] bg-[var(--t-surface)] px-5 py-3">
        <div className="max-w-3xl mx-auto flex items-end gap-2.5">
          <span className={`shrink-0 text-sm font-mono select-none leading-[1.625rem] ${
            prompting ? "text-[var(--t-dim)]" : "text-[var(--t-accent)]"
          }`}>
            &#10095;
          </span>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={prompting || connecting}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-[var(--t-bright)] outline-none placeholder:text-[var(--t-dim)] disabled:opacity-40"
            style={{ caretColor: 'var(--t-accent)' }}
            placeholder={
              connecting
                ? "Connecting to agent..."
                : prompting
                  ? "Agent is thinking..."
                  : "Send a message..."
            }
            spellCheck={false}
          />
          {prompting ? (
            <button
              onClick={cancelPrompt}
              className="shrink-0 rounded-md bg-[var(--t-red)]/15 p-2 text-[var(--t-red)] hover:bg-[var(--t-red)]/25 transition-colors cursor-pointer"
              title="Stop (Esc)"
            >
              <Square className="size-3.5" />
            </button>
          ) : (
            <div className="shrink-0 text-[11px] text-[var(--t-muted)] leading-[1.625rem] select-none">
              enter &#8629;
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
