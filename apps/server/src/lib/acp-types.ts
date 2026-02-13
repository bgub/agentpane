import type { ChildProcess } from "node:child_process"
import { Effect } from "effect"
import { RequestError, type ClientSideConnection, type RequestPermissionOutcome } from "@agentclientprotocol/sdk"
import { AcpConnectionError, type Turn, type MessageBlock } from "./schema.js"

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TerminalExitStatus {
  exitCode?: number | null
  signal?: string | null
}

export interface TerminalState {
  process: ChildProcess
  output: string
  truncated: boolean
  outputByteLimit: number | null
  exitStatus: TerminalExitStatus | null
  exitPromise: Promise<TerminalExitStatus>
  resolveExit: (status: TerminalExitStatus) => void
}

export interface AgentConnection {
  process: ChildProcess
  connection: ClientSideConnection
  agentSessionId: string
  prompting: boolean
  currentAssistantTurnId: string | null
  accumulatedText: string
  terminals: Map<string, TerminalState>
  pendingPermissions: Map<string, { resolve: (outcome: RequestPermissionOutcome) => void }>
  cwd: string
  cleaned: boolean
  configOptions: Array<Record<string, unknown>>
  availableCommands: Array<Record<string, unknown>>
}

export interface SubscribeResult {
  subscriberId: string
  stream: ReadableStream<string>
  prompting: boolean
  assistantTurnId: string | null
  latestEventId: number
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export const appendOutput = (terminal: TerminalState, chunk: string) => {
  terminal.output += chunk
  if (
    terminal.outputByteLimit !== null &&
    Buffer.byteLength(terminal.output, "utf-8") > terminal.outputByteLimit
  ) {
    const buf = Buffer.from(terminal.output, "utf-8")
    let start = buf.length - terminal.outputByteLimit
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
      start++
    }
    terminal.output = buf.subarray(start).toString("utf-8")
    terminal.truncated = true
  }
}

export const estimateTokenCount = (text: string): number => {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export const getTerminal = (
  conn: AgentConnection,
  terminalId: string
): TerminalState => {
  const terminal = conn.terminals.get(terminalId)
  if (!terminal) {
    throw RequestError.resourceNotFound(terminalId)
  }
  return terminal
}

/**
 * Workaround: claude-code-acp doesn't maintain history between prompt() calls,
 * so we prepend it ourselves. See https://github.com/zed-industries/claude-code-acp/issues/80
 */
export const formatHistory = (
  turns: ReadonlyArray<Turn & { blocks: ReadonlyArray<MessageBlock> }>
): string => {
  const lines = turns.flatMap((t) => {
    const text = t.blocks.filter((b) => b.kind === "text").map((b) => b.content).join("\n")
    return text ? [`${t.role === "user" ? "Human" : "Assistant"}: ${text}`] : []
  })
  return lines.length ? `<conversation_history>\n${lines.join("\n\n")}\n</conversation_history>\n\n` : ""
}

/**
 * Look up a connection or yield an AcpConnectionError.
 * Replaces 5 duplicate "get conn or error" patterns.
 */
export const requireConnection = (
  connections: Map<string, AgentConnection>,
  sessionId: string
): Effect.Effect<AgentConnection, AcpConnectionError> =>
  Effect.gen(function* () {
    const conn = connections.get(sessionId)
    if (!conn) {
      return yield* new AcpConnectionError({
        message: "Agent not connected for this session",
      })
    }
    return conn
  })
