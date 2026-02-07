"use client"

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react"
import { Send, Square } from "lucide-react"

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
  active: boolean
  connected: boolean
  onPromptingChange?: (sessionId: string, prompting: boolean) => void
  onConnectionChange?: (sessionId: string, connected: boolean) => void
}

export default function ChatView({
  sessionId,
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
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <div className="flex h-10 shrink-0 items-center border-b border-zinc-800 px-4">
        <span className="text-zinc-400 text-xs">acapa</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
          {!loaded && (
            <div className="text-zinc-600 text-sm">Loading conversation...</div>
          )}

          {turns.map((turn) => (
            <div key={turn.id}>
              {turn.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
                    {turn.blocks
                      .filter((b) => b.kind === "text")
                      .map((b) => b.content)
                      .join("\n")}
                  </div>
                </div>
              ) : (
                <div className="flex justify-start">
                  <div className="max-w-[80%] space-y-2">
                    {turn.blocks
                      .filter((b) => b.kind === "text")
                      .map((b) => (
                        <div
                          key={b.id}
                          className="rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-2.5 text-sm text-zinc-200 whitespace-pre-wrap"
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
                      .map((b) => {
                        let toolInfo: { toolName?: string } = {}
                        try {
                          toolInfo = JSON.parse(b.content)
                        } catch { /* ignore */ }
                        return (
                          <div
                            key={b.id}
                            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-400"
                          >
                            Tool: {toolInfo.toolName || b.kind}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Streaming assistant message */}
          {streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-2.5 text-sm text-zinc-200 whitespace-pre-wrap">
                {streamingText}
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-zinc-400 animate-pulse align-text-bottom" />
              </div>
            </div>
          )}

          {/* Prompting but no text yet */}
          {prompting && !streamingText && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-2.5 text-sm text-zinc-500">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-800 px-4 py-3">
        <div className="mx-auto max-w-3xl flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={prompting || connecting}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
            placeholder={connecting ? "Connecting to agent..." : prompting ? "Agent is thinking..." : "Send a message..."}
            spellCheck={false}
          />
          {prompting ? (
            <button
              onClick={cancelPrompt}
              className="shrink-0 rounded-xl bg-red-600 p-2.5 text-white hover:bg-red-500 transition-colors"
              title="Stop"
            >
              <Square className="size-4" />
            </button>
          ) : (
            <button
              onClick={() => sendPrompt(input)}
              disabled={!input.trim()}
              className="shrink-0 rounded-xl bg-blue-600 p-2.5 text-white hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 transition-colors"
              title="Send"
            >
              <Send className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
