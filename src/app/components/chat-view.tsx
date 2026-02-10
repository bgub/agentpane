"use client"

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react"
import { Square, Check, X, Loader2, Terminal, FileText, Search, Brain, Pencil, FolderOpen } from "lucide-react"
import { Streamdown } from "streamdown"
import { code } from "@streamdown/code"
import { PROVIDERS } from "./providers"

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
  agentType: string
  active: boolean
  connected: boolean
  onPromptingChange?: (sessionId: string, prompting: boolean) => void
  onConnectionChange?: (sessionId: string, connected: boolean, config?: { cwd: string; agent_type: string }) => void
}

interface ToolCallState {
  toolCallId: string
  title: string
  kind?: string
  status?: string
  rawInput?: unknown
  rawOutput?: unknown
}

type StreamingBlock =
  | { type: "text"; content: string }
  | { type: "tool_call"; state: ToolCallState }

const markdownPlugins = { code }

function kindIcon(kind?: string) {
  const cls = "size-3.5 shrink-0"
  switch (kind) {
    case "execute": return <Terminal className={cls} />
    case "read": return <FileText className={cls} />
    case "edit": return <Pencil className={cls} />
    case "search": return <Search className={cls} />
    case "think": return <Brain className={cls} />
    default: return <span className="text-xs shrink-0">&#9670;</span>
  }
}

function statusIndicator(status?: string) {
  if (status === "completed") return <Check className="size-3.5 shrink-0 text-[var(--t-green)]" />
  if (status === "failed") return <X className="size-3.5 shrink-0 text-[var(--t-red)]" />
  if (status === "in_progress" || status === "pending") return <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--t-amber)]" />
  return null
}

function formatOutput(raw: unknown): string {
  if (raw == null) return ""
  if (typeof raw === "string") return raw
  return JSON.stringify(raw, null, 2)
}

function ToolCallBox({ state }: { state: ToolCallState }) {
  const [expanded, setExpanded] = useState(false)
  const output = formatOutput(state.rawOutput)
  const input = formatOutput(state.rawInput)
  const hasDetails = !!(output || input)

  return (
    <div className="my-1.5 rounded-md bg-[var(--t-surface)] border border-[var(--t-border)]">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs font-mono transition-colors ${
          hasDetails ? "cursor-pointer hover:bg-[var(--t-elevated)]" : "cursor-default"
        }`}
        style={{ color: "var(--t-text)" }}
      >
        <span className="text-[var(--t-blue)]">{kindIcon(state.kind)}</span>
        <span className="flex-1 text-left truncate">{state.title}</span>
        {statusIndicator(state.status)}
        {hasDetails && (
          <span className="text-[var(--t-dim)] text-[10px]">{expanded ? "▾" : "▸"}</span>
        )}
      </button>
      {expanded && hasDetails && (
        <div className="border-t border-[var(--t-border)] px-3 py-2 space-y-2">
          {input && (
            <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap text-[var(--t-muted)] max-h-40 overflow-y-auto">
              {input}
            </pre>
          )}
          {output && (
            <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap text-[var(--t-text)] max-h-60 overflow-y-auto">
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/** Parse a persisted tool_call block into ToolCallState */
function parseToolCallBlock(block: BlockData): ToolCallState {
  try {
    const data = JSON.parse(block.content)
    return {
      toolCallId: data.toolCallId || block.id,
      title: data.title || data.toolName || "Tool call",
      kind: data.kind,
      status: data.status,
      rawInput: data.rawInput,
      rawOutput: data.rawOutput,
    }
  } catch {
    return { toolCallId: block.id, title: block.kind || "Tool call" }
  }
}

/**
 * Merge tool_call_update blocks (and duplicate tool_call blocks) into the
 * first tool_call block per toolCallId.
 * Returns blocks with only "text" and "tool_call" kinds, in original order.
 */
function mergeToolCallUpdates(blocks: BlockData[]): BlockData[] {
  const toolCalls = new Map<string, Record<string, unknown>>()
  const seenIds = new Set<string>()

  for (const b of blocks) {
    if (b.kind !== "tool_call" && b.kind !== "tool_call_update") continue
    try {
      const data = JSON.parse(b.content)
      const id = data.toolCallId
      if (!id) continue
      const existing = toolCalls.get(id)
      if (!existing) {
        toolCalls.set(id, data)
      } else {
        if (data.title != null) existing.title = data.title
        if (data.kind != null) existing.kind = data.kind
        if (data.status != null) existing.status = data.status
        if (data.rawInput !== undefined) existing.rawInput = data.rawInput
        if (data.rawOutput !== undefined) existing.rawOutput = data.rawOutput
      }
    } catch { /* ignore */ }
  }

  return blocks
    .filter((b) => {
      if (b.kind === "tool_call_update") return false
      if (b.kind === "tool_call") {
        try {
          const data = JSON.parse(b.content)
          if (data.toolCallId) {
            if (seenIds.has(data.toolCallId)) return false
            seenIds.add(data.toolCallId)
          }
        } catch { /* ignore */ }
      }
      return true
    })
    .map((b) => {
      if (b.kind === "tool_call") {
        try {
          const data = JSON.parse(b.content)
          const merged = data.toolCallId ? toolCalls.get(data.toolCallId) : undefined
          if (merged) return { ...b, content: JSON.stringify(merged) }
        } catch { /* ignore */ }
      }
      return b
    })
}

/** Apply a server event to streaming blocks (mutates blocksRef, returns new array for setState) */
function applyEventToBlocks(
  blocks: StreamingBlock[],
  data: Record<string, unknown>
): StreamingBlock[] {
  const eventType = data.sessionUpdate as string

  if (eventType === "agent_message_chunk" && (data.content as Record<string, unknown>)?.type === "text") {
    const text = (data.content as Record<string, unknown>).text as string
    const last = blocks[blocks.length - 1]
    if (last && last.type === "text") {
      last.content += text
    } else {
      blocks.push({ type: "text", content: text })
    }
  } else if (eventType === "tool_call") {
    const existing = blocks.find(
      (b): b is StreamingBlock & { type: "tool_call" } =>
        b.type === "tool_call" && b.state.toolCallId === data.toolCallId
    )
    if (existing) {
      if (data.title != null) existing.state.title = data.title as string
      if (data.kind != null) existing.state.kind = data.kind as string
      if (data.status != null) existing.state.status = data.status as string
      if (data.rawInput !== undefined) existing.state.rawInput = data.rawInput
      if (data.rawOutput !== undefined) existing.state.rawOutput = data.rawOutput
    } else {
      const state: ToolCallState = {
        toolCallId: data.toolCallId as string,
        title: (data.title as string) || "Tool call",
        status: (data.status as string) || "in_progress",
      }
      if (data.kind != null) state.kind = data.kind as string
      if (data.rawInput !== undefined) state.rawInput = data.rawInput
      if (data.rawOutput !== undefined) state.rawOutput = data.rawOutput
      blocks.push({ type: "tool_call", state })
    }
  } else if (eventType === "tool_call_update") {
    const tc = blocks.find(
      (b): b is StreamingBlock & { type: "tool_call" } =>
        b.type === "tool_call" && b.state.toolCallId === data.toolCallId
    )
    if (tc) {
      if (data.title != null) tc.state.title = data.title as string
      if (data.kind != null) tc.state.kind = data.kind as string
      if (data.status != null) tc.state.status = data.status as string
      if (data.rawInput !== undefined) tc.state.rawInput = data.rawInput
      if (data.rawOutput !== undefined) tc.state.rawOutput = data.rawOutput
    }
  }

  return [...blocks]
}

function SessionSetup({
  defaultCwd,
  active,
  onStart,
}: {
  defaultCwd: string
  active: boolean
  onStart: (agentType: string, cwd: string) => void
}) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [cwdValue, setCwdValue] = useState(defaultCwd)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the cwd input when active
  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  const handleStart = () => {
    if (!selectedProvider) return
    onStart(selectedProvider, cwdValue.trim() || defaultCwd)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && selectedProvider) {
      e.preventDefault()
      handleStart()
    }
  }

  return (
    <div className="flex h-full flex-col bg-[var(--t-bg)]">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md px-6 space-y-6">
          {/* Provider cards */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-[var(--t-muted)] uppercase tracking-wider">Agent</div>
            <div className="grid grid-cols-2 gap-3">
              {PROVIDERS.map((p) => {
                const selected = selectedProvider === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    className={`group relative text-left rounded-lg border px-4 py-3.5 transition-all cursor-pointer ${
                      selected
                        ? "border-[var(--t-accent)] bg-[var(--t-accent)]/8"
                        : "border-[var(--t-border)] bg-[var(--t-surface)] hover:border-[var(--t-dim)] hover:bg-[var(--t-elevated)]"
                    }`}
                  >
                    <div className={`text-sm font-medium ${selected ? "text-[var(--t-accent)]" : "text-[var(--t-bright)]"}`}>
                      {p.name}
                    </div>
                    <div className="text-[11px] text-[var(--t-muted)] mt-0.5 leading-snug">
                      {p.description}
                    </div>
                    {selected && (
                      <div className="absolute top-2.5 right-2.5 size-2 rounded-full bg-[var(--t-accent)]" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Working directory */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-[var(--t-muted)] uppercase tracking-wider">Working directory</div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-3 py-2 focus-within:border-[var(--t-dim)]">
              <FolderOpen className="size-3.5 shrink-0 text-[var(--t-muted)]" />
              <input
                ref={inputRef}
                value={cwdValue}
                onChange={(e) => setCwdValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent text-sm text-[var(--t-bright)] outline-none placeholder:text-[var(--t-dim)] font-mono"
                placeholder="~/projects/my-app"
                spellCheck={false}
              />
            </div>
          </div>

          {/* Start button */}
          <button
            onClick={handleStart}
            disabled={!selectedProvider}
            className={`w-full rounded-lg py-2.5 text-sm font-medium transition-all ${
              selectedProvider
                ? "bg-[var(--t-accent)] text-[var(--t-bg)] hover:brightness-110 cursor-pointer"
                : "bg-[var(--t-border)] text-[var(--t-dim)] cursor-not-allowed"
            }`}
          >
            Start session
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChatView({
  sessionId,
  cwd,
  agentType,
  active,
  connected,
  onPromptingChange,
  onConnectionChange,
}: ChatViewProps) {
  const [turns, setTurns] = useState<TurnData[]>([])
  const [streamingBlocks, setStreamingBlocks] = useState<StreamingBlock[]>([])
  const [input, setInput] = useState("")
  const [prompting, setPrompting] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const blocksRef = useRef<StreamingBlock[]>([])

  const hasStreamingContent = streamingBlocks.length > 0

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, streamingBlocks])

  // Focus textarea when active and capture keyboard input
  useEffect(() => {
    if (active && !prompting && agentType) textareaRef.current?.focus()
  }, [active, prompting, agentType])

  useEffect(() => {
    if (!active || !agentType) return

    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // Ignore if already focused on an input/textarea, or if modifier keys are held
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.metaKey || e.ctrlKey || e.altKey
      ) return
      // Only capture printable characters
      if (e.key.length === 1) {
        textareaRef.current?.focus()
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [active, agentType])

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

  // Re-fetch conversation from DB (used after prompt completion)
  const refreshConversation = useCallback(() => {
    fetch(`/api/sessions/${sessionId}/conversation`)
      .then((res) => res.json())
      .then((data: TurnData[]) => {
        setTurns(data)
        blocksRef.current = []
        setStreamingBlocks([])
      })
      .catch(() => {})
  }, [sessionId])

  // Persistent EventSource connection for SSE events
  useEffect(() => {
    if (!connected) return

    const es = new EventSource(`/api/sessions/${sessionId}/events`)

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>
        const eventType = data.sessionUpdate as string

        if (eventType === "status") {
          // Initial status on connect — replay events rebuild streaming state
          const isPrompting = data.prompting as boolean
          setPrompting(isPrompting)
        } else if (eventType === "prompt_started") {
          setPrompting(true)
          blocksRef.current = []
          setStreamingBlocks([])
        } else if (eventType === "done") {
          setPrompting(false)
          // Re-fetch from DB — guaranteed up-to-date by Effect-native prompt lifecycle
          // Keep streaming blocks visible until fetch returns to prevent flicker
          refreshConversation()
        } else if (eventType === "error") {
          const blocks = blocksRef.current
          const last = blocks[blocks.length - 1]
          if (last && last.type === "text") {
            last.content += `\n\nError: ${data.message}`
          } else {
            blocks.push({ type: "text", content: `Error: ${data.message}` })
          }
          blocksRef.current = blocks
          setStreamingBlocks([...blocks])
          setPrompting(false)
        } else if (eventType === "disconnected") {
          setPrompting(false)
          onConnectionChange?.(sessionId, false)
        } else {
          // agent_message_chunk, tool_call, tool_call_update
          const updated = applyEventToBlocks(blocksRef.current, data)
          blocksRef.current = updated
          setStreamingBlocks(updated)
        }
      } catch {
        // Ignore parse errors
      }
    }

    es.onerror = () => {
      // EventSource auto-reconnects; nothing special needed
    }

    return () => {
      es.close()
      // Clear streaming state so replayed events rebuild from scratch on new EventSource
      blocksRef.current = []
      setStreamingBlocks([])
    }
  }, [connected, sessionId, refreshConversation, onConnectionChange])

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

  const handleSetupStart = useCallback(
    async (selectedAgentType: string, selectedCwd: string) => {
      setConnecting(true)
      try {
        const res = await fetch(`/api/sessions/${sessionId}/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_type: selectedAgentType, cwd: selectedCwd }),
        })
        if (res.ok) {
          onConnectionChange?.(sessionId, true, { cwd: selectedCwd, agent_type: selectedAgentType })
        }
      } catch {
        // Connection failed — will show as disconnected
      } finally {
        setConnecting(false)
      }
    },
    [sessionId, onConnectionChange]
  )

  const cancelPrompt = useCallback(() => {
    fetch(`/api/sessions/${sessionId}/cancel`, { method: "POST" }).catch(() => {})
  }, [sessionId])

  const sendPrompt = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || prompting) return

      // Ensure agent is connected before prompting
      const connectResult = await ensureConnected()
      if (connectResult !== true) {
        setStreamingBlocks([{ type: "text", content: `Error: ${connectResult}` }])
        return
      }

      setInput("")

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

      try {
        const res = await fetch(`/api/sessions/${sessionId}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmed }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }))
          setStreamingBlocks([{ type: "text", content: `Error: ${err.error}` }])
        }
        // On success, prompt_started and streaming events arrive via EventSource
      } catch {
        setStreamingBlocks([{ type: "text", content: "Error: Network error" }])
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

  // Show setup screen for unconfigured sessions
  if (!agentType) {
    if (connecting) {
      return (
        <div className="flex h-full items-center justify-center bg-[var(--t-bg)]">
          <div className="flex items-center gap-2.5 text-sm text-[var(--t-muted)]">
            <Loader2 className="size-4 animate-spin text-[var(--t-accent)]" />
            Connecting to agent...
          </div>
        </div>
      )
    }
    return <SessionSetup defaultCwd={cwd} active={active} onStart={handleSetupStart} />
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
                /* Assistant response — interleave blocks in order */
                <div className="py-1">
                  {mergeToolCallUpdates(turn.blocks)
                    .filter((b) => b.kind === "text" || b.kind === "tool_call")
                    .map((b) =>
                      b.kind === "text" ? (
                        <div
                          key={b.id}
                          className="text-sm leading-[1.7] text-[var(--t-text)] pl-5 border-l-2 border-[var(--t-border)]"
                        >
                          <Streamdown plugins={markdownPlugins} mode="static">
                            {b.content}
                          </Streamdown>
                        </div>
                      ) : (
                        <div key={b.id} className="pl-5 border-l-2 border-[var(--t-border)]">
                          <ToolCallBox state={parseToolCallBlock(b)} />
                        </div>
                      )
                    )}
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
          {hasStreamingContent && (
            <div className="py-1">
              {streamingBlocks.map((block, i) =>
                block.type === "text" ? (
                  <div
                    key={`stream-${i}`}
                    className="text-sm leading-[1.7] text-[var(--t-text)] pl-5 border-l-2 border-[var(--t-accent)]"
                  >
                    <Streamdown plugins={markdownPlugins} isAnimating={i === streamingBlocks.length - 1}>
                      {block.content}
                    </Streamdown>
                  </div>
                ) : (
                  <div key={`stream-${i}`} className="pl-5 border-l-2 border-[var(--t-accent)]">
                    <ToolCallBox state={block.state} />
                  </div>
                )
              )}
            </div>
          )}

          {/* Waiting for response */}
          {prompting && !hasStreamingContent && (
            <div className="py-1">
              <div className="text-sm text-[var(--t-muted)] pl-5 border-l-2 border-[var(--t-accent)]">
                <span className="animate-pulse">...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 h-12 border-t border-[var(--t-border)] bg-[var(--t-surface)] px-5 flex items-center">
        <div className="max-w-3xl mx-auto w-full flex items-center gap-2.5">
          <span className={`shrink-0 text-sm font-mono select-none ${
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
            <span className="shrink-0 text-xs text-[var(--t-muted)] select-none">
              enter &#8629;
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
