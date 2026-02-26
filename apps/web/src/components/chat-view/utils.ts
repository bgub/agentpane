import { Check, X, Loader2, Terminal, FileText, Search, Brain, Pencil, Globe, type LucideIcon } from "lucide-react"
import { createElement } from "react"
import { diffLines } from "diff"
import type { DiffLine, FileChange, PlanEntry, ToolCallState } from "./types"

export function safeParse<T = unknown>(json: string): T | null {
  try { return JSON.parse(json) as T } catch { return null }
}

const KIND_ICONS: Record<string, LucideIcon> = {
  // Claude Code kinds
  execute: Terminal, read: FileText, edit: Pencil, search: Search, think: Brain,
  // ACP spec ToolKind values
  command_execution: Terminal, file_operation: FileText, web_request: Globe, code_execution: Terminal,
}

export function kindIcon(kind?: string) {
  const Icon = kind ? KIND_ICONS[kind] : undefined
  if (Icon) return createElement(Icon, { className: "size-3.5 shrink-0" })
  return createElement("span", { className: "text-xs shrink-0" }, "\u2666")
}

const STATUS_INDICATORS: Record<string, [LucideIcon, string]> = {
  completed: [Check, "size-3.5 shrink-0 text-[var(--t-green)]"],
  failed: [X, "size-3.5 shrink-0 text-[var(--t-red)]"],
  in_progress: [Loader2, "size-3.5 shrink-0 animate-spin text-[var(--t-amber)]"],
  pending: [Loader2, "size-3.5 shrink-0 animate-spin text-[var(--t-amber)]"],
}

export function statusIndicator(status?: string) {
  const entry = status ? STATUS_INDICATORS[status] : undefined
  if (!entry) return null
  return createElement(entry[0], { className: entry[1] })
}

// Extract readable text from various agent output formats
export function extractOutputText(raw: unknown): string | null {
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
export function extractCommand(raw: unknown): string | null {
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
export function parseExitPlanMode(raw: unknown): string | null {
  const obj = asObject(raw)
  if (!obj) return null
  if (typeof obj.plan === "string" && Array.isArray(obj.allowedPrompts)) {
    return obj.plan
  }
  return null
}

// Detects Plan subagent Task tool: rawInput has { subagent_type: "Plan", ... }
export function isPlanSubagent(raw: unknown): boolean {
  return asObject(raw)?.subagent_type === "Plan"
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  return diffLines(oldText, newText).flatMap((part) =>
    part.value.replace(/\n$/, "").split("\n").map((line): DiffLine => ({
      type: part.added ? "add" : part.removed ? "remove" : "same",
      content: line,
    }))
  )
}

export function parseEditChanges(raw: unknown): FileChange[] | null {
  const input = typeof raw === "string" ? safeParse(raw) : raw
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

export function parsePlanBlock(content: string): PlanEntry[] {
  const data = safeParse<Record<string, unknown>>(content)
  if (data && Array.isArray(data.entries)) return data.entries as PlanEntry[]
  return []
}

export function parseToolCallBlock(block: { id: string; content: string; kind: string }): ToolCallState {
  const data = safeParse<Record<string, unknown>>(block.content)
  if (data) {
    const result: ToolCallState = {
      toolCallId: (data.toolCallId as string) || block.id,
      title: (data.title as string) || (data.toolName as string) || "Tool call",
    }
    if (typeof data.kind === "string") result.kind = data.kind
    if (typeof data.status === "string") result.status = data.status
    if (data.rawInput !== undefined) result.rawInput = data.rawInput
    if (data.rawOutput !== undefined) result.rawOutput = data.rawOutput
    return result
  }
  return { toolCallId: block.id, title: block.kind || "Tool call" }
}

const SAFE_URI_RE = /^(?:https?|file):\/\//i

export function parseResourceLinkBlock(block: { content: string }) {
  const data = safeParse<Record<string, unknown>>(block.content)
  if (!data) return null
  const uri = typeof data.uri === "string" ? data.uri : ""
  const name = typeof data.name === "string" ? data.name : ""
  if (!uri || !name || !SAFE_URI_RE.test(uri)) return null
  return {
    uri,
    name,
    description: typeof data.description === "string" ? data.description : null,
    title: typeof data.title === "string" ? data.title : null,
    mimeType: typeof data.mimeType === "string" ? data.mimeType : null,
  }
}

export function mergeToolCallUpdates(blocks: { id: string; kind: string; content: string }[]) {
  // Parse all tool_call/tool_call_update blocks once, merge by toolCallId
  const merged = new Map<string, Record<string, unknown>>()
  const parsed = new Map<typeof blocks[number], Record<string, unknown>>()

  for (const b of blocks) {
    if (b.kind !== "tool_call" && b.kind !== "tool_call_update") continue
    const data = safeParse<Record<string, unknown>>(b.content)
    if (!data) continue
    parsed.set(b, data)
    const id = data.toolCallId as string | undefined
    if (!id) continue
    const existing = merged.get(id)
    if (!existing) {
      merged.set(id, data)
    } else {
      if (data.title != null) existing.title = data.title
      if (data.kind != null) existing.kind = data.kind
      if (data.status != null) existing.status = data.status
      if (data.rawInput !== undefined) existing.rawInput = data.rawInput
      if (data.rawOutput !== undefined) existing.rawOutput = data.rawOutput
    }
  }

  const seenIds = new Set<string>()
  return blocks
    .filter((b) => {
      if (b.kind === "tool_call_update") return false
      if (b.kind === "tool_call") {
        const id = parsed.get(b)?.toolCallId as string | undefined
        if (id) {
          if (seenIds.has(id)) return false
          seenIds.add(id)
        }
      }
      return true
    })
    .map((b) => {
      if (b.kind === "tool_call") {
        const id = parsed.get(b)?.toolCallId as string | undefined
        const m = id ? merged.get(id) : undefined
        if (m) return { ...b, content: JSON.stringify(m) }
      }
      return b
    })
}
