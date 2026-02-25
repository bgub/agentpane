import type { StreamingBlock, ToolCallState, PlanEntry, PermissionOption } from "./types"

// --- Immutable streaming block helpers ---

function findToolCallIndex(blocks: StreamingBlock[], toolCallId: string): number {
  return blocks.findIndex((b) => b.type === "tool_call" && b.state.toolCallId === toolCallId)
}

function replaceBlock(blocks: StreamingBlock[], index: number, block: StreamingBlock): StreamingBlock[] {
  return blocks.map((b, i) => (i === index ? block : b))
}

function patchToolCallState(state: ToolCallState, data: Record<string, unknown>): ToolCallState {
  const next = { ...state }
  if (data.title != null) next.title = data.title as string
  if (data.kind != null) next.kind = data.kind as string
  if (data.status != null) next.status = data.status as string
  if (data.rawInput !== undefined) next.rawInput = data.rawInput
  if (data.rawOutput !== undefined) next.rawOutput = data.rawOutput
  return next
}

export function applyEventToBlocks(
  blocks: StreamingBlock[],
  data: Record<string, unknown>
): StreamingBlock[] {
  const eventType = data.sessionUpdate as string

  if (eventType === "agent_message_chunk" && (data.content as Record<string, unknown>)?.type === "text") {
    const text = (data.content as Record<string, unknown>).text as string
    const last = blocks[blocks.length - 1]
    if (last?.type === "text") {
      return [...blocks.slice(0, -1), { type: "text", content: last.content + text }]
    }
    return [...blocks, { type: "text", content: text }]
  }

  if (eventType === "tool_call" || eventType === "tool_call_update") {
    const toolCallId = data.toolCallId as string
    const idx = findToolCallIndex(blocks, toolCallId)
    if (idx >= 0) {
      const existing = (blocks[idx] as { type: "tool_call"; state: ToolCallState }).state
      return replaceBlock(blocks, idx, { type: "tool_call", state: patchToolCallState(existing, data) })
    }
    if (eventType === "tool_call") {
      const state: ToolCallState = {
        toolCallId,
        title: (data.title as string) || "Tool call",
        status: (data.status as string) || "in_progress",
      }
      if (data.kind != null) state.kind = data.kind as string
      if (data.rawInput !== undefined) state.rawInput = data.rawInput
      if (data.rawOutput !== undefined) state.rawOutput = data.rawOutput
      return [...blocks, { type: "tool_call", state }]
    }
    return blocks
  }

  if (eventType === "permission_request") {
    const toolCall = data.toolCall as Record<string, unknown> | undefined
    const toolCallId = toolCall?.toolCallId as string | undefined
    const requestId = data.requestId as string
    const options = data.options as PermissionOption[]
    if (toolCallId) {
      const idx = findToolCallIndex(blocks, toolCallId)
      if (idx >= 0) {
        const existing = (blocks[idx] as { type: "tool_call"; state: ToolCallState }).state
        return replaceBlock(blocks, idx, {
          type: "tool_call",
          state: { ...existing, permissionRequest: { requestId, options } },
        })
      }
      const state: ToolCallState = {
        toolCallId,
        title: (toolCall?.title as string) || "Tool call",
        status: (toolCall?.status as string) || "pending",
        permissionRequest: { requestId, options },
      }
      if (toolCall?.kind != null) state.kind = toolCall.kind as string
      if (toolCall?.rawInput !== undefined) state.rawInput = toolCall.rawInput
      return [...blocks, { type: "tool_call", state }]
    }
    return blocks
  }

  if (eventType === "plan") {
    const entries = data.entries as PlanEntry[]
    const idx = blocks.findIndex((b) => b.type === "plan")
    if (idx >= 0) return replaceBlock(blocks, idx, { type: "plan", entries })
    return [...blocks, { type: "plan", entries }]
  }

  if (eventType === "permission_resolved") {
    const requestId = data.requestId as string
    const idx = blocks.findIndex(
      (b) => b.type === "tool_call" && b.state.permissionRequest?.requestId === requestId
    )
    if (idx >= 0) {
      const existing = (blocks[idx] as { type: "tool_call"; state: ToolCallState }).state
      return replaceBlock(blocks, idx, {
        type: "tool_call",
        state: { ...existing, permissionRequest: undefined },
      })
    }
    return blocks
  }

  return blocks
}

// --- Chat state reducer (streaming-only) ---

export interface ChatState {
  streamingBlocks: StreamingBlock[]
  prompting: boolean
  optimisticTurn: import("./types").TurnData | null
}

type ChatAction =
  | { type: 'SET_OPTIMISTIC_TURN'; turn: import("./types").TurnData }
  | { type: 'SSE_PROMPT_STARTED' }
  | { type: 'SSE_PROMPT_FINISHED' }
  | { type: 'SSE_DONE' }
  | { type: 'SSE_STATUS'; prompting: boolean }
  | { type: 'SSE_ERROR'; message: string }
  | { type: 'SSE_DISCONNECTED' }
  | { type: 'SSE_STREAMING'; data: Record<string, unknown> }
  | { type: 'APPEND_ERROR'; message: string }
  | { type: 'RESET' }

export type { ChatAction }

export function appendError(blocks: StreamingBlock[], message: string): StreamingBlock[] {
  const last = blocks[blocks.length - 1]
  if (last?.type === "text") {
    return [...blocks.slice(0, -1), { type: "text", content: last.content + `\n\n${message}` }]
  }
  return [...blocks, { type: "text", content: message }]
}

export const INITIAL_CHAT_STATE: ChatState = { streamingBlocks: [], prompting: false, optimisticTurn: null }

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_OPTIMISTIC_TURN':
      return { ...state, optimisticTurn: action.turn }
    case 'SSE_PROMPT_STARTED':
      return { ...state, prompting: true, streamingBlocks: [] }
    case 'SSE_PROMPT_FINISHED':
      return { ...state, prompting: false }
    case 'SSE_DONE':
      return { ...state, prompting: false, optimisticTurn: null, streamingBlocks: [] }
    case 'SSE_STATUS':
      return state.prompting === action.prompting ? state : { ...state, prompting: action.prompting }
    case 'SSE_ERROR':
      return { ...state, prompting: false, streamingBlocks: appendError(state.streamingBlocks, action.message) }
    case 'SSE_DISCONNECTED':
      return { ...state, prompting: false }
    case 'SSE_STREAMING':
      return { ...state, streamingBlocks: applyEventToBlocks(state.streamingBlocks, action.data) }
    case 'APPEND_ERROR':
      return { ...state, streamingBlocks: appendError(state.streamingBlocks, action.message) }
    case 'RESET':
      return INITIAL_CHAT_STATE
  }
}
