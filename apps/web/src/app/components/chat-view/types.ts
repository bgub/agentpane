export interface TurnData {
  id: string
  session_id: string
  role: "user" | "assistant"
  stop_reason: string | null
  created_at: number
  blocks: BlockData[]
}

export interface BlockData {
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

export interface ChatViewProps {
  sessionId: string
  lastSentPrompt: { text: string; ts: number } | null
  promptError: { message: string; ts: number } | null
  onConfigOptionsChange?: (configOptions: ConfigOption[]) => void
  onAvailableCommandsChange?: (commands: AvailableCommand[]) => void
}

export interface PermissionOption {
  optionId: string
  name: string
  kind: string
}

export interface ToolCallState {
  toolCallId: string
  title: string
  kind?: string
  status?: string
  rawInput?: unknown
  rawOutput?: unknown
  permissionRequest?: { requestId: string; options: PermissionOption[] } | undefined
}

export interface PlanEntry {
  content: string
  priority: "high" | "medium" | "low"
  status: "pending" | "in_progress" | "completed"
}

export type StreamingBlock =
  | { type: "text"; content: string }
  | { type: "tool_call"; state: ToolCallState }
  | { type: "plan"; entries: PlanEntry[] }

export interface DiffLine {
  type: "add" | "remove" | "same"
  content: string
}

export interface FileChange {
  path: string
  type: string
  content: string
  oldContent?: string | undefined
}
