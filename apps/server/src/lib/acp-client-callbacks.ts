import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import { type Client, type Agent, type RequestPermissionOutcome } from "@agentclientprotocol/sdk"
import {
  appendOutput,
  getTerminal,
  type AgentConnection,
  type TerminalExitStatus,
  type TerminalState,
} from "./acp-types.js"

// ---------------------------------------------------------------------------
// Dependencies required by the client callbacks
// ---------------------------------------------------------------------------

export interface ClientDeps {
  readonly enqueueMessageBlock: (
    sessionId: string,
    turnId: string,
    kind: string,
    content: string
  ) => Promise<void>
  readonly broadcast: (sessionId: string, event: unknown) => void
}

// ---------------------------------------------------------------------------
// makeClient — ACP protocol callback factory
// ---------------------------------------------------------------------------

export const makeClient = (
  deps: ClientDeps,
  sessionId: string,
  connRef: { current: AgentConnection | null }
): ((agent: Agent) => Client) => {
  return (_agent: Agent): Client => ({
    sessionUpdate: async (params) => {
      const conn = connRef.current
      if (!conn) return

      const update = params.update as Record<string, unknown>
      const eventType = update.sessionUpdate as string | undefined

      // Accumulate text for DB persistence
      if (
        eventType === "agent_message_chunk" &&
        (update.content as Record<string, unknown>)?.type === "text"
      ) {
        conn.accumulatedText += (update.content as Record<string, unknown>).text as string
      }

      // Persist tool calls immediately
      if (
        conn.currentAssistantTurnId &&
        (eventType === "tool_call" || eventType === "tool_call_update")
      ) {
        deps.enqueueMessageBlock(
          sessionId,
          conn.currentAssistantTurnId,
          eventType,
          JSON.stringify(update)
        )
      }

      // Keep stored configOptions in sync when agent pushes updates
      if (eventType === "config_option_update" && conn) {
        conn.configOptions = (update.configOptions as Array<Record<string, unknown>>) ?? []
      }

      // Keep stored availableCommands in sync when agent pushes updates
      if (eventType === "available_commands_update" && conn) {
        conn.availableCommands = (update.availableCommands as Array<Record<string, unknown>>) ?? []
      }

      // Broadcast to all subscribers via session-level broadcaster
      deps.broadcast(sessionId, update)
    },

    requestPermission: async (params) => {
      const conn = connRef.current
      if (!conn) return { outcome: { outcome: "cancelled" } }

      const requestId = crypto.randomUUID()
      deps.broadcast(sessionId, {
        sessionUpdate: "permission_request",
        requestId,
        toolCall: params.toolCall,
        options: params.options,
      })

      const outcome = await new Promise<RequestPermissionOutcome>((resolve) => {
        conn.pendingPermissions.set(requestId, { resolve })
      })
      conn.pendingPermissions.delete(requestId)
      return { outcome }
    },

    readTextFile: async (params) => {
      const content = await fs.readFile(params.path, "utf-8")
      return { content }
    },

    writeTextFile: async (params) => {
      await fs.writeFile(params.path, params.content, "utf-8")
      return {}
    },

    createTerminal: async (params) => {
      const conn = connRef.current!
      const terminalId = crypto.randomUUID()

      const env = { ...process.env }
      if (params.env) {
        for (const v of params.env) {
          env[v.name] = v.value
        }
      }

      let resolveExit!: (status: TerminalExitStatus) => void
      const exitPromise = new Promise<TerminalExitStatus>((resolve) => {
        resolveExit = resolve
      })

      const termProc = spawn(params.command, params.args ?? [], {
        cwd: params.cwd ?? conn.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      })

      const terminal: TerminalState = {
        process: termProc,
        output: "",
        truncated: false,
        outputByteLimit: params.outputByteLimit ?? 256 * 1024,
        exitStatus: null,
        exitPromise,
        resolveExit,
      }

      termProc.stdout?.on("data", (chunk: Buffer) => {
        appendOutput(terminal, chunk.toString("utf-8"))
      })
      termProc.stderr?.on("data", (chunk: Buffer) => {
        appendOutput(terminal, chunk.toString("utf-8"))
      })
      termProc.on("exit", (code, signal) => {
        const status: TerminalExitStatus = {
          exitCode: code,
          signal: signal ?? null,
        }
        terminal.exitStatus = status
        resolveExit(status)

        if (conn.currentAssistantTurnId && terminal.output.length > 0) {
          void deps.enqueueMessageBlock(
            sessionId,
            conn.currentAssistantTurnId,
            "terminal_output",
            terminal.output
          )
        }
      })
      termProc.on("error", (err) => {
        appendOutput(terminal, `\nProcess error: ${err.message}\n`)
        if (!terminal.exitStatus) {
          const status: TerminalExitStatus = { exitCode: 1 }
          terminal.exitStatus = status
          resolveExit(status)
        }
      })

      conn.terminals.set(terminalId, terminal)
      return { terminalId }
    },

    terminalOutput: async (params) => {
      const conn = connRef.current!
      const terminal = getTerminal(conn, params.terminalId)
      return {
        output: terminal.output,
        truncated: terminal.truncated,
        exitStatus: terminal.exitStatus,
      }
    },

    waitForTerminalExit: async (params) => {
      const conn = connRef.current!
      const terminal = getTerminal(conn, params.terminalId)
      const status = await terminal.exitPromise
      const result: { exitCode?: number | null; signal?: string | null } = {}
      if (status.exitCode !== undefined) result.exitCode = status.exitCode
      if (status.signal !== undefined) result.signal = status.signal
      return result
    },

    killTerminal: async (params) => {
      const conn = connRef.current!
      const terminal = getTerminal(conn, params.terminalId)
      if (!terminal.process.killed) {
        terminal.process.kill()
      }
      return {}
    },

    releaseTerminal: async (params) => {
      const conn = connRef.current!
      const terminal = getTerminal(conn, params.terminalId)
      if (!terminal.process.killed) {
        terminal.process.kill()
      }
      conn.terminals.delete(params.terminalId)
      return {}
    },
  })
}
