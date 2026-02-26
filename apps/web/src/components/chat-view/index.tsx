import { useReducer, useRef, useEffect } from "react"
import { Streamdown } from "streamdown"
import { useQueryClient } from "@tanstack/react-query"
import { useConversationQuery, queryKeys } from "@/lib/queries"
import { api } from "@/lib/api"
import type { Session, SessionMode, SessionModesState } from "@/lib/types"
import type { TurnData, ChatViewProps, ConfigOption, AvailableCommand } from "./types"
import { parseToolCallBlock, parseResourceLinkBlock, mergeToolCallUpdates } from "./utils"
import { chatReducer, INITIAL_CHAT_STATE } from "./streaming"
import { ToolCallBox } from "./tool-call-box"
import { PlanView } from "./plan-view"
import { markdownPlugins, markdownComponents } from "./markdown"

function ResourceLinkCard({ block }: { block: { id: string; content: string } }) {
  const link = parseResourceLinkBlock(block)
  if (!link) return null
  return (
    <a
      href={link.uri}
      target="_blank"
      rel="noreferrer"
      className="block rounded-md border border-[var(--t-border)] px-2.5 py-2 hover:border-[var(--t-accent)] transition-colors"
      title={link.description ?? link.uri}
    >
      <div className="text-xs text-[var(--t-accent)] truncate">{link.name}</div>
      <div className="text-[11px] text-[var(--t-muted)] truncate">{link.title ?? link.uri}</div>
    </a>
  )
}

export default function ChatView({
  sessionId,
  lastSentPrompt,
  promptError,
  onConfigOptionsChange,
  onAvailableCommandsChange,
  onModesChange,
}: ChatViewProps) {
  const queryClient = useQueryClient()
  const { data: queriedTurns = [] } = useConversationQuery(sessionId)
  const turns = queriedTurns as TurnData[]

  const [{ streamingBlocks, prompting, optimisticTurn }, dispatch] = useReducer(
    chatReducer,
    INITIAL_CHAT_STATE,
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const lastPromptTsRef = useRef(0)
  const lastErrorTsRef = useRef(0)
  const latestEventIdRef = useRef<number | undefined>(undefined)

  // Merge query turns + optimistic turn (if not yet in query data)
  const allTurns = optimisticTurn && !turns.some((t) => t.id === optimisticTurn.id)
    ? [...turns, optimisticTurn]
    : turns

  const hasStreamingContent = streamingBlocks.length > 0

  // Auto-scroll to bottom (in column-reverse, scrollTop 0 = visual bottom).
  // Only trigger on new turns or when streaming starts — not on every chunk,
  // since flex-col-reverse already keeps the scroll anchored to the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = 0
  }, [allTurns, hasStreamingContent])

  // Handle optimistic user turn from parent
  useEffect(() => {
    if (lastSentPrompt && lastSentPrompt.ts !== lastPromptTsRef.current) {
      lastPromptTsRef.current = lastSentPrompt.ts
      dispatch({
        type: 'SET_OPTIMISTIC_TURN',
        turn: {
          id: `temp-user-${lastSentPrompt.ts}`,
          session_id: sessionId,
          role: "user",
          stop_reason: "end_turn",
          created_at: lastSentPrompt.ts,
          blocks: [{
            id: `temp-block-${lastSentPrompt.ts}`,
            turn_id: `temp-user-${lastSentPrompt.ts}`,
            kind: "text",
            content: lastSentPrompt.text,
            created_at: lastSentPrompt.ts,
          }],
        },
      })
    }
  }, [lastSentPrompt, sessionId])

  // Handle errors from parent
  useEffect(() => {
    if (promptError && promptError.ts !== lastErrorTsRef.current) {
      lastErrorTsRef.current = promptError.ts
      dispatch({ type: 'APPEND_ERROR', message: promptError.message })
    }
  }, [promptError])

  // EventSource for SSE events — updates TQ sessions cache directly for connected/prompting
  useEffect(() => {
    const patchSession = (patch: Partial<Session>) => {
      queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
        old?.map((s) => s.id === sessionId ? { ...s, ...patch } : s)
      )
    }

    const es = new EventSource(api.eventsUrl(sessionId))

    es.onmessage = (event) => {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        return
      }

      const eventType = data.sessionUpdate as string
      const lastEventId = event.lastEventId
      const eventId = lastEventId ? parseInt(lastEventId, 10) : undefined

      if (eventType === "status") {
        const latestId = data.latestEventId
        latestEventIdRef.current = typeof latestId === "number" ? latestId : undefined
        dispatch({ type: 'SSE_STATUS', prompting: data.prompting as boolean })
        patchSession({ prompting: data.prompting as boolean })
        if (data.replayGap === true) {
          queryClient.invalidateQueries({ queryKey: queryKeys.conversation(sessionId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.tokenUsage(sessionId) })
        }
        return
      }

      if (eventId != null && latestEventIdRef.current != null && eventId <= latestEventIdRef.current) return

      if (eventType === "connected") {
        patchSession({ connected: true })
        const configOpts = (data.configOptions as ConfigOption[]) ?? []
        const availCmds = (data.availableCommands as AvailableCommand[]) ?? []
        const modes = (data.modes as SessionModesState | null) ?? null
        onConfigOptionsChange?.(configOpts)
        onAvailableCommandsChange?.(availCmds)
        onModesChange?.(modes)
      } else if (eventType === "config_option_update") {
        onConfigOptionsChange?.((data.configOptions as ConfigOption[]) ?? [])
      } else if (eventType === "available_commands_update") {
        onAvailableCommandsChange?.((data.availableCommands as AvailableCommand[]) ?? [])
      } else if (eventType === "current_mode_update") {
        const { currentModeId, modes: modesList } = data as Record<string, unknown>
        const modesState: SessionModesState = {}
        if (typeof currentModeId === "string") modesState.currentModeId = currentModeId
        if (Array.isArray(modesList)) modesState.modes = modesList as SessionMode[]
        onModesChange?.(modesState)
      } else if (eventType === "prompt_started") {
        dispatch({ type: 'SSE_PROMPT_STARTED' })
        patchSession({ prompting: true })
      } else if (eventType === "done") {
        dispatch({ type: 'SSE_PROMPT_FINISHED' })
        patchSession({ prompting: false })
        Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.conversation(sessionId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.tokenUsage(sessionId) }),
        ]).then(() => dispatch({ type: 'SSE_DONE' }))
      } else if (eventType === "error") {
        dispatch({ type: 'SSE_ERROR', message: `Error: ${data.message}` })
        patchSession({ prompting: false })
        queryClient.invalidateQueries({ queryKey: queryKeys.tokenUsage(sessionId) })
      } else if (eventType === "session_info_update") {
        if (typeof data.title === "string") {
          patchSession({ name: data.title })
        }
      } else if (eventType === "disconnected") {
        dispatch({ type: 'SSE_DISCONNECTED' })
        patchSession({ connected: false, prompting: false })
        onConfigOptionsChange?.([])
        onAvailableCommandsChange?.([])
        onModesChange?.(null)
      } else {
        dispatch({ type: 'SSE_STREAMING', data })
      }
    }

    es.onerror = () => {}

    return () => es.close()
  }, [sessionId, queryClient, onConfigOptionsChange, onAvailableCommandsChange, onModesChange])

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto flex flex-col-reverse">
      <div className="max-w-3xl w-full mx-auto px-5 py-6 space-y-1">
        {allTurns.map((turn) => (
          <div key={turn.id}>
            {turn.role === "user" ? (
              <div className="mt-5 mb-3 -mx-3 px-3 py-2.5 rounded-lg bg-[var(--t-elevated)]">
                <div className="flex items-start gap-2.5">
                  <span className="shrink-0 text-sm font-mono text-[var(--t-accent)] select-none leading-relaxed">&#10095;</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    {(() => {
                      const text = turn.blocks.filter((b) => b.kind === "text").map((b) => b.content).join("\n")
                      return text && (
                        <div className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--t-white)]">
                          {text}
                        </div>
                      )
                    })()}
                    {turn.blocks
                      .filter((b) => b.kind === "resource_link")
                      .map((b) => <ResourceLinkCard key={b.id} block={b} />)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-1">
                {mergeToolCallUpdates(turn.blocks)
                  .filter((b) => b.kind === "text" || b.kind === "tool_call" || b.kind === "resource_link")
                  .map((b) =>
                    b.kind === "text" ? (
                      <div
                        key={b.id}
                        className="text-sm leading-[1.7] text-[var(--t-text)] pl-5 border-l-2 border-[var(--t-border)]"
                      >
                        <Streamdown plugins={markdownPlugins} components={markdownComponents} mode="static">
                          {b.content}
                        </Streamdown>
                      </div>
                    ) : b.kind === "tool_call" ? (
                      <div key={b.id} className="pl-5 border-l-2 border-[var(--t-border)]">
                        <ToolCallBox state={parseToolCallBlock(b)} sessionId={sessionId} />
                      </div>
                    ) : (
                      <div key={b.id} className="pl-5 border-l-2 border-[var(--t-border)]">
                        <ResourceLinkCard block={b} />
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
            {streamingBlocks.map((block, idx) => {
              const isLast = idx === streamingBlocks.length - 1
              const key = block.type === "text" ? block.id
                : block.type === "plan" ? "plan"
                : block.state.toolCallId
              return block.type === "text" ? (
                <div
                  key={key}
                  className="text-sm leading-[1.7] text-[var(--t-text)] pl-5 border-l-2 border-[var(--t-accent)]"
                >
                  <Streamdown plugins={markdownPlugins} components={markdownComponents} mode={isLast ? "streaming" : "static"} isAnimating={isLast}>
                    {block.content}
                  </Streamdown>
                </div>
              ) : block.type === "plan" ? (
                <div key={key} className="pl-5 border-l-2 border-[var(--t-accent)]">
                  <PlanView entries={block.entries} />
                </div>
              ) : (
                <div key={key} className="pl-5 border-l-2 border-[var(--t-accent)]">
                  <ToolCallBox state={block.state} sessionId={sessionId} />
                </div>
              )
            })}
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
  )
}
