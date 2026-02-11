"use client"

import { useState, useReducer, useRef, useEffect } from "react"
import { Check, X, Loader2, Terminal, FileText, Search, Brain, Pencil } from "lucide-react"
import { Streamdown } from "streamdown"
import { code } from "@streamdown/code"
import { useQueryClient } from "@tanstack/react-query"
import { useConversationQuery, queryKeys } from "@/lib/queries"
import { api } from "@/lib/api"

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

export interface ConfigSelectOption { value: string; name: string; description?: string }
export interface ConfigSelectGroup { group: string; name: string; options: ConfigSelectOption[] }
export interface ConfigOption {
  id: string; name: string; description?: string
  category?: string; type: "select"
  currentValue: string
  options: (ConfigSelectOption | ConfigSelectGroup)[]
}

export interface AvailableCommand {
  name: string
  description: string
  input?: { hint: string } | null
}

interface ChatViewProps {
  sessionId: string
  connected: boolean
  lastSentPrompt: { text: string; ts: number } | null
  promptError: { message: string; ts: number } | null
  onPromptingChange?: (sessionId: string, prompting: boolean) => void
  onConnectionChange?: (sessionId: string, connected: boolean, config?: { cwd: string; agent_type: string }) => void
  onConfigOptionsChange?: (configOptions: ConfigOption[]) => void
  onAvailableCommandsChange?: (commands: AvailableCommand[]) => void
}

interface PermissionOption {
  optionId: string
  name: string
  kind: string // "allow_once" | "allow_always" | "reject_once" | "reject_always"
}

interface ToolCallState {
  toolCallId: string
  title: string
  kind?: string
  status?: string
  rawInput?: unknown
  rawOutput?: unknown
  permissionRequest?: { requestId: string; options: PermissionOption[] } | undefined
}

interface PlanEntry {
  content: string
  priority: "high" | "medium" | "low"
  status: "pending" | "in_progress" | "completed"
}

type StreamingBlock =
  | { type: "text"; content: string }
  | { type: "tool_call"; state: ToolCallState }
  | { type: "plan"; entries: PlanEntry[] }

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

// --- Diff computation for edit tool calls ---

interface DiffLine {
  type: "add" | "remove" | "same"
  content: string
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const m = oldLines.length
  const n = newLines.length

  // LCS dynamic programming
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack to build diff
  const stack: DiffLine[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: "same", content: oldLines[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "add", content: newLines[j - 1] })
      j--
    } else {
      stack.push({ type: "remove", content: oldLines[i - 1] })
      i--
    }
  }

  return stack.reverse()
}

interface FileChange {
  path: string
  type: string
  content: string
  oldContent?: string | undefined
}

function parseEditChanges(raw: unknown): FileChange[] | null {
  const input = typeof raw === "string" ? (() => { try { return JSON.parse(raw) } catch { return null } })() : raw
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>

  // ACP changes-based format: { changes: { "/path/to/file": { content, type, old_content? } } }
  if (obj.changes && typeof obj.changes === "object") {
    const result: FileChange[] = []
    for (const [path, value] of Object.entries(obj.changes as Record<string, unknown>)) {
      if (value && typeof value === "object") {
        const change = value as Record<string, unknown>
        result.push({
          path,
          content: typeof change.content === "string" ? change.content : "",
          type: typeof change.type === "string" ? change.type : "unknown",
          oldContent: typeof change.old_content === "string" ? change.old_content : undefined,
        })
      }
    }
    return result.length > 0 ? result : null
  }

  // Claude Code old_string/new_string format
  if (typeof obj.old_string === "string" || typeof obj.new_string === "string") {
    return [{
      path: typeof obj.file_path === "string" ? obj.file_path : "",
      type: obj.old_string ? "edit" : "add",
      content: typeof obj.new_string === "string" ? obj.new_string : "",
      oldContent: typeof obj.old_string === "string" ? obj.old_string : undefined,
    }]
  }

  return null
}

function EditDiffView({ rawInput }: { rawInput: unknown }) {
  const changes = parseEditChanges(rawInput)
  if (!changes) return null

  return (
    <div className="space-y-2">
      {changes.map((change, i) => {
        const lines: DiffLine[] = change.oldContent
          ? computeLineDiff(change.oldContent, change.content)
          : change.content.split("\n").map((l): DiffLine => ({ type: "add", content: l }))

        return (
          <div key={i}>
            {changes.length > 1 && (
              <div className="text-[10px] text-[var(--t-dim)] mb-1 truncate">{change.path}</div>
            )}
            <div className="text-xs font-mono leading-[1.6] overflow-x-auto max-h-60 overflow-y-auto">
              {lines.map((line, j) => (
                <div
                  key={j}
                  className={
                    line.type === "add"
                      ? "bg-[var(--t-green)]/10 text-[var(--t-green)]"
                      : line.type === "remove"
                        ? "bg-[var(--t-red)]/10 text-[var(--t-red)]"
                        : "text-[var(--t-dim)]"
                  }
                >
                  <span className="select-none inline-block w-4 text-center opacity-60">
                    {line.type === "add" ? "+" : line.type === "remove" ? "\u2212" : " "}
                  </span>
                  {line.content || " "}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Extract readable text from various agent output formats
function extractOutputText(raw: unknown): string | null {
  // ACP array format: [{type: "text", text: "..."}]
  if (Array.isArray(raw)) {
    const texts = raw
      .filter(
        (item): item is { type: string; text: string } =>
          item && typeof item === "object" && item.type === "text" && typeof item.text === "string"
      )
      .map((item) => item.text)
    if (texts.length > 0) return texts.join("\n")
  }
  // Object with stdout/stderr (Codex and similar)
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    const parts: string[] = []
    if (typeof obj.stdout === "string" && obj.stdout) parts.push(obj.stdout)
    if (typeof obj.stderr === "string" && obj.stderr) parts.push(obj.stderr)
    if (parts.length > 0) return parts.join("\n")
  }
  return null
}

// Extract command string from various input formats
function extractCommand(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  // Claude Code: { command: "ls -la ..." }
  if (typeof obj.command === "string") return obj.command
  // Codex: { command: ["zsh", "-lc", "ls"], parsed_cmd: [{cmd: "ls"}] }
  if (Array.isArray(obj.command)) {
    const args = obj.command as string[]
    // Find the actual command after shell -c/-lc flag
    const flagIdx = args.findIndex((a) => a === "-c" || a === "-lc")
    if (flagIdx >= 0 && args[flagIdx + 1]) return args[flagIdx + 1]
    return args[args.length - 1] ?? null
  }
  return null
}

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

// Detects ExitPlanMode: rawInput has { plan: string, allowedPrompts: array }
function parseExitPlanMode(raw: unknown): string | null {
  const obj = asObject(raw)
  if (!obj) return null
  if (typeof obj.plan === "string" && Array.isArray(obj.allowedPrompts)) {
    return obj.plan
  }
  return null
}

// Detects Plan subagent Task tool: rawInput has { subagent_type: "Plan", ... }
function isPlanSubagent(raw: unknown): boolean {
  return asObject(raw)?.subagent_type === "Plan"
}

function MarkdownDetailView({ content }: { content: string }) {
  return (
    <div className="text-sm leading-[1.7] text-[var(--t-text)] max-h-96 overflow-y-auto">
      <Streamdown plugins={markdownPlugins} mode="static">
        {content}
      </Streamdown>
    </div>
  )
}

function PermissionButtons({
  sessionId,
  requestId,
  options,
}: {
  sessionId: string
  requestId: string
  options: PermissionOption[]
}) {
  const [responding, setResponding] = useState(false)

  const handleClick = (optionId: string) => {
    setResponding(true)
    api.sessions.permission(sessionId, requestId, optionId).catch(() => {
      setResponding(false)
    })
  }

  if (responding) return null

  return (
    <div className="flex items-center gap-2 pt-1">
      {options.map((opt) => {
        const isReject = opt.kind.startsWith("reject")
        return (
          <button
            key={opt.optionId}
            onClick={() => handleClick(opt.optionId)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
              isReject
                ? "border-[var(--t-red)]/40 text-[var(--t-red)] hover:bg-[var(--t-red)]/10"
                : "border-[var(--t-green)]/40 text-[var(--t-green)] hover:bg-[var(--t-green)]/10"
            }`}
          >
            {opt.name}
          </button>
        )
      })}
    </div>
  )
}

function ToolCallBox({ state, sessionId }: { state: ToolCallState; sessionId?: string }) {
  const isEdit = state.kind === "edit" && !!parseEditChanges(state.rawInput)
  const planContent = parseExitPlanMode(state.rawInput)
  const hasPendingPermission = !!state.permissionRequest
  const [expanded, setExpanded] = useState(isEdit || !!planContent || hasPendingPermission)

  // Auto-expand when permission request arrives
  useEffect(() => {
    if (hasPendingPermission) setExpanded(true)
  }, [hasPendingPermission])

  // Hide Plan subagent — the plan is shown by ExitPlanMode below
  if (isPlanSubagent(state.rawInput)) return null

  const outputText = extractOutputText(state.rawOutput)
  const command = extractCommand(state.rawInput)
  const isExecute = !isEdit && (state.kind === "execute" || !!command)
  const rawOutput = formatOutput(state.rawOutput)
  const rawInput = formatOutput(state.rawInput)
  const hasDetails =
    isEdit ||
    !!planContent ||
    isExecute ||
    !!outputText ||
    (!!rawInput && rawInput !== "{}") ||
    (!!rawOutput && rawOutput !== "{}" && rawOutput !== "null" && rawOutput !== "")

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
        {planContent ? <Check className="size-3.5 shrink-0 text-[var(--t-green)]" /> : statusIndicator(state.status)}
        {hasDetails && (
          <span className="text-[var(--t-dim)] text-[10px]">{expanded ? "\u25BE" : "\u25B8"}</span>
        )}
      </button>
      {expanded && (hasDetails || hasPendingPermission) && (
        <div className="border-t border-[var(--t-border)] px-3 py-2 space-y-2">
          {isEdit ? (
            <EditDiffView rawInput={state.rawInput} />
          ) : planContent ? (
            <MarkdownDetailView content={planContent} />
          ) : isExecute ? (
            <ExecuteDetails command={command} outputText={outputText} />
          ) : state.kind === "read" ? (
            <pre className="text-xs leading-relaxed font-mono whitespace-pre overflow-x-auto text-[var(--t-text)] max-h-60 overflow-y-auto">
              {outputText || rawOutput}
            </pre>
          ) : (
            <GenericDetails rawInput={rawInput} outputText={outputText} rawOutput={rawOutput} />
          )}
          {hasPendingPermission && sessionId && (
            <PermissionButtons
              sessionId={sessionId}
              requestId={state.permissionRequest!.requestId}
              options={state.permissionRequest!.options}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ExecuteDetails({
  command,
  outputText,
}: {
  command: string | null
  outputText: string | null
}) {
  return (
    <div className="space-y-1.5">
      {command && (
        <div className="text-xs font-mono text-[var(--t-accent)]">
          <span className="text-[var(--t-dim)] select-none">$ </span>
          {command}
        </div>
      )}
      {outputText && (
        <pre className="text-xs leading-relaxed font-mono whitespace-pre overflow-x-auto text-[var(--t-muted)] max-h-60 overflow-y-auto">
          {outputText}
        </pre>
      )}
    </div>
  )
}

function GenericDetails({
  rawInput,
  outputText,
  rawOutput,
}: {
  rawInput: string
  outputText: string | null
  rawOutput: string
}) {
  const showInput = rawInput && rawInput !== "{}"
  const output = outputText || rawOutput
  const outputIsMarkdown = !!output && output.length > 200 && /^#{1,3}\s/m.test(output)

  return (
    <>
      {showInput && (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap text-[var(--t-muted)] max-h-40 overflow-y-auto">
          {rawInput}
        </pre>
      )}
      {outputIsMarkdown ? (
        <MarkdownDetailView content={output} />
      ) : output ? (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap text-[var(--t-text)] max-h-60 overflow-y-auto">
          {output}
        </pre>
      ) : null}
    </>
  )
}

function PlanView({ entries }: { entries: PlanEntry[] }) {
  return (
    <div className="my-1.5 rounded-md bg-[var(--t-surface)] border border-[var(--t-border)] px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--t-dim)] mb-1.5">Plan</div>
      <div className="space-y-0.5">
        {entries.map((entry, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-xs font-mono py-0.5"
            style={{ opacity: entry.priority === "low" ? 0.55 : entry.priority === "medium" ? 0.8 : 1 }}
          >
            {entry.status === "completed" ? (
              <Check className="size-3.5 shrink-0 text-[var(--t-green)]" />
            ) : entry.status === "in_progress" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--t-amber)]" />
            ) : (
              <span className="size-3.5 shrink-0 inline-flex items-center justify-center text-[var(--t-dim)]">&#9702;</span>
            )}
            <span className={entry.status === "completed" ? "text-[var(--t-dim)]" : "text-[var(--t-text)]"}>
              {entry.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

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

function applyEventToBlocks(
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

interface ChatState {
  streamingBlocks: StreamingBlock[]
  prompting: boolean
  optimisticTurn: TurnData | null
}

type ChatAction =
  | { type: 'SET_OPTIMISTIC_TURN'; turn: TurnData }
  | { type: 'SSE_PROMPT_STARTED' }
  | { type: 'SSE_DONE' }
  | { type: 'SSE_STATUS'; prompting: boolean }
  | { type: 'SSE_ERROR'; message: string }
  | { type: 'SSE_DISCONNECTED' }
  | { type: 'SSE_STREAMING'; data: Record<string, unknown> }
  | { type: 'APPEND_ERROR'; message: string }
  | { type: 'RESET' }

function appendError(blocks: StreamingBlock[], message: string): StreamingBlock[] {
  const last = blocks[blocks.length - 1]
  if (last?.type === "text") {
    return [...blocks.slice(0, -1), { type: "text", content: last.content + `\n\n${message}` }]
  }
  return [...blocks, { type: "text", content: message }]
}

const INITIAL_CHAT_STATE: ChatState = { streamingBlocks: [], prompting: false, optimisticTurn: null }

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_OPTIMISTIC_TURN':
      return { ...state, optimisticTurn: action.turn }
    case 'SSE_PROMPT_STARTED':
      return { ...state, prompting: true, streamingBlocks: [] }
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

export default function ChatView({
  sessionId,
  connected,
  lastSentPrompt,
  promptError,
  onPromptingChange,
  onConnectionChange,
  onConfigOptionsChange,
  onAvailableCommandsChange,
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

  // Synchronous reset on session switch (clears streaming state before paint)
  const [prevSessionId, setPrevSessionId] = useState(sessionId)
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId)
    dispatch({ type: 'RESET' })
    lastPromptTsRef.current = lastSentPrompt?.ts ?? 0
    lastErrorTsRef.current = promptError?.ts ?? 0
  }

  // Merge query turns + optimistic turn (if not yet in query data)
  const allTurns = optimisticTurn && !turns.some((t) => t.id === optimisticTurn.id)
    ? [...turns, optimisticTurn]
    : turns

  const hasStreamingContent = streamingBlocks.length > 0

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [allTurns, streamingBlocks])

  // Notify parent of prompting state
  useEffect(() => {
    onPromptingChange?.(sessionId, prompting)
  }, [prompting, sessionId, onPromptingChange])

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

  // EventSource for SSE events
  useEffect(() => {
    const es = new EventSource(api.eventsUrl(sessionId))

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>
        const eventType = data.sessionUpdate as string

        if (eventType === "status") {
          dispatch({ type: 'SSE_STATUS', prompting: data.prompting as boolean })
        } else if (eventType === "connected") {
          onConnectionChange?.(sessionId, true)
          onConfigOptionsChange?.((data.configOptions as ConfigOption[]) ?? [])
          onAvailableCommandsChange?.((data.availableCommands as AvailableCommand[]) ?? [])
        } else if (eventType === "config_option_update") {
          onConfigOptionsChange?.((data.configOptions as ConfigOption[]) ?? [])
        } else if (eventType === "available_commands_update") {
          onAvailableCommandsChange?.((data.availableCommands as AvailableCommand[]) ?? [])
        } else if (eventType === "prompt_started") {
          dispatch({ type: 'SSE_PROMPT_STARTED' })
        } else if (eventType === "done") {
          dispatch({ type: 'SSE_DONE' })
          queryClient.invalidateQueries({ queryKey: queryKeys.conversation(sessionId) })
        } else if (eventType === "error") {
          dispatch({ type: 'SSE_ERROR', message: `Error: ${data.message}` })
        } else if (eventType === "disconnected") {
          dispatch({ type: 'SSE_DISCONNECTED' })
          onConnectionChange?.(sessionId, false)
          onConfigOptionsChange?.([])
          onAvailableCommandsChange?.([])
        } else {
          dispatch({ type: 'SSE_STREAMING', data })
        }
      } catch {
        // Ignore parse errors
      }
    }

    es.onerror = () => {
      // EventSource auto-reconnects
    }

    return () => es.close()
  }, [sessionId, queryClient, onConnectionChange, onConfigOptionsChange, onAvailableCommandsChange])

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-5 py-6 space-y-1">
        {allTurns.map((turn) => (
          <div key={turn.id}>
            {turn.role === "user" ? (
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
                        <ToolCallBox state={parseToolCallBlock(b)} sessionId={sessionId} />
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
              ) : block.type === "plan" ? (
                <div key={`stream-${i}`} className="pl-5 border-l-2 border-[var(--t-accent)]">
                  <PlanView entries={block.entries} />
                </div>
              ) : (
                <div key={`stream-${i}`} className="pl-5 border-l-2 border-[var(--t-accent)]">
                  <ToolCallBox state={block.state} sessionId={sessionId} />
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
  )
}
