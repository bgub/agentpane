import { Check, X, Loader2, Terminal, FileText, Search, Brain, Pencil } from "lucide-react"
import { createElement } from "react"
import { diffLines } from "diff"
import type { DiffLine, FileChange } from "./types"

export function kindIcon(kind?: string) {
  const cls = "size-3.5 shrink-0"
  switch (kind) {
    case "execute": return createElement(Terminal, { className: cls })
    case "read": return createElement(FileText, { className: cls })
    case "edit": return createElement(Pencil, { className: cls })
    case "search": return createElement(Search, { className: cls })
    case "think": return createElement(Brain, { className: cls })
    default: return createElement("span", { className: "text-xs shrink-0" }, "\u2666")
  }
}

export function statusIndicator(status?: string) {
  if (status === "completed") return createElement(Check, { className: "size-3.5 shrink-0 text-[var(--t-green)]" })
  if (status === "failed") return createElement(X, { className: "size-3.5 shrink-0 text-[var(--t-red)]" })
  if (status === "in_progress" || status === "pending") return createElement(Loader2, { className: "size-3.5 shrink-0 animate-spin text-[var(--t-amber)]" })
  return null
}

export function formatOutput(raw: unknown): string {
  if (raw == null) return ""
  if (typeof raw === "string") return raw
  return JSON.stringify(raw, null, 2)
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

export function asObject(raw: unknown): Record<string, unknown> | null {
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

export function parseToolCallBlock(block: { id: string; content: string; kind: string }) {
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

export function mergeToolCallUpdates(blocks: { id: string; kind: string; content: string }[]) {
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
