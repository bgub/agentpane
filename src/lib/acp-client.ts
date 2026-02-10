import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import { Context, Effect, Layer, Runtime } from "effect"
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Client,
  type Agent,
} from "@agentclientprotocol/sdk"
import { nodeToWebWritable, nodeToWebReadable } from "@zed-industries/claude-code-acp"
import { SessionRepo } from "./session-repo"
import { AcpConnectionError } from "./schema"
import { EventBroadcaster } from "./event-broadcaster"
import { resolveProviderBin, PROVIDERS } from "./providers"

interface TerminalExitStatus {
  exitCode?: number | null
  signal?: string | null
}

interface TerminalState {
  process: ChildProcess
  output: string
  truncated: boolean
  outputByteLimit: number | null
  exitStatus: TerminalExitStatus | null
  exitPromise: Promise<TerminalExitStatus>
  resolveExit: (status: TerminalExitStatus) => void
}

interface AgentConnection {
  process: ChildProcess
  connection: ClientSideConnection
  agentSessionId: string
  broadcaster: EventBroadcaster
  prompting: boolean
  currentAssistantTurnId: string | null
  accumulatedText: string
  terminals: Map<string, TerminalState>
  cwd: string
  cleaned: boolean
}

interface SubscribeResult {
  subscriberId: string
  stream: ReadableStream<string>
  prompting: boolean
  assistantTurnId: string | null
  latestEventId: number
}

export class AcpClient extends Context.Tag("@acapa/AcpClient")<
  AcpClient,
  {
    readonly connect: (
      sessionId: string,
      cwd: string,
      agentType: string
    ) => Effect.Effect<{ agentSessionId: string }, AcpConnectionError>
    readonly prompt: (
      sessionId: string,
      content: string
    ) => Effect.Effect<{ userTurnId: string; assistantTurnId: string }, AcpConnectionError>
    readonly cancel: (sessionId: string) => Effect.Effect<void>
    readonly disconnect: (sessionId: string) => Effect.Effect<void>
    readonly isConnected: (sessionId: string) => Effect.Effect<boolean>
    readonly subscribe: (sessionId: string, afterEventId?: number) => Effect.Effect<SubscribeResult, AcpConnectionError>
    readonly unsubscribe: (sessionId: string, subscriberId: string) => Effect.Effect<void>
    readonly connectedSessionIds: () => ReadonlySet<string>
    readonly promptingSessionIds: () => ReadonlySet<string>
  }
>() {
  static readonly layer = Layer.effect(
    AcpClient,
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const runtime = yield* Effect.runtime<never>()
      const runPromise = Runtime.runPromise(runtime)

      const connections = new Map<string, AgentConnection>()

      const appendOutput = (terminal: TerminalState, chunk: string) => {
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

      const getTerminal = (
        conn: AgentConnection,
        terminalId: string
      ): TerminalState => {
        const terminal = conn.terminals.get(terminalId)
        if (!terminal) {
          throw RequestError.resourceNotFound(terminalId)
        }
        return terminal
      }

      const cleanupConnection = (sessionId: string, conn: AgentConnection) => {
        if (conn.cleaned) return
        conn.cleaned = true

        // Broadcast disconnected event (goes into ring buffer for client catch-up)
        conn.broadcaster.broadcast({ sessionUpdate: "disconnected" })

        connections.delete(sessionId)

        // Kill all terminal subprocesses
        for (const terminal of conn.terminals.values()) {
          if (!terminal.process.killed) {
            terminal.process.kill()
          }
        }
        conn.terminals.clear()

        // Update DB
        runPromise(
          repo.updateAgentSessionId(sessionId, null).pipe(Effect.orDie)
        ).catch(() => {})

        // Close broadcaster after microtask to let disconnect event be delivered
        setTimeout(() => conn.broadcaster.close(), 0)
      }

      const makeClient = (
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
              runPromise(
                repo.addMessageBlock(
                  conn.currentAssistantTurnId,
                  eventType,
                  JSON.stringify(update)
                )
              ).catch(() => {})
            }

            // Broadcast to all subscribers
            conn.broadcaster.broadcast(update)
          },

          requestPermission: async (params) => {
            const firstOption = params.options[0]
            if (firstOption) {
              return {
                outcome: {
                  outcome: "selected",
                  optionId: firstOption.optionId,
                },
              }
            }
            return { outcome: { outcome: "cancelled" } }
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
              outputByteLimit: params.outputByteLimit ?? null,
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

      const connect = Effect.fn("AcpClient.connect")(
        function* (sessionId: string, cwd: string, agentType: string) {
          // If already connected, disconnect first
          if (connections.has(sessionId)) {
            yield* disconnect(sessionId)
          }

          const effectiveCwd = cwd === "~" ? process.env.HOME || "/" : cwd
          const providerName = PROVIDERS[agentType]?.name ?? agentType
          const binPath = yield* Effect.try({
            try: () => resolveProviderBin(agentType),
            catch: (err) =>
              new AcpConnectionError({
                message: `${providerName}: ${err instanceof Error ? err.message : String(err)}`,
              }),
          })

          const proc = yield* Effect.try({
            try: () =>
              spawn(binPath, [], {
                cwd: effectiveCwd,
                stdio: ["pipe", "pipe", "inherit"],
                env: { ...process.env },
              }),
            catch: (err) =>
              new AcpConnectionError({
                message: `Failed to spawn ${providerName}: ${err}`,
              }),
          })

          if (!proc.stdin || !proc.stdout) {
            proc.kill()
            return yield* new AcpConnectionError({
              message: "Failed to get stdio streams from agent process",
            })
          }

          const writableWeb = nodeToWebWritable(proc.stdin!)
          const readableWeb = nodeToWebReadable(proc.stdout!)
          const stream = ndJsonStream(
            writableWeb as unknown as WritableStream<Uint8Array>,
            readableWeb as unknown as ReadableStream<Uint8Array>
          )

          const connRef: { current: AgentConnection | null } = { current: null }
          const clientConnection = new ClientSideConnection(
            makeClient(connRef),
            stream
          )

          yield* Effect.tryPromise({
            try: () =>
              clientConnection.initialize({
                protocolVersion: PROTOCOL_VERSION,
                clientCapabilities: {
                  fs: { readTextFile: true, writeTextFile: true },
                  terminal: true,
                },
                clientInfo: { name: "acapa", version: "0.1.0" },
              }),
            catch: (err) => {
              proc.kill()
              return new AcpConnectionError({
                message: `ACP initialization failed: ${err}`,
              })
            },
          })

          const sessionResponse = yield* Effect.tryPromise({
            try: () =>
              clientConnection.newSession({
                cwd: effectiveCwd,
                mcpServers: [],
              }),
            catch: (err) => {
              proc.kill()
              return new AcpConnectionError({
                message: `Failed to create agent session: ${err}`,
              })
            },
          })

          const agentSessionId = sessionResponse.sessionId

          const agentConn: AgentConnection = {
            process: proc,
            connection: clientConnection,
            agentSessionId,
            broadcaster: new EventBroadcaster(),
            prompting: false,
            currentAssistantTurnId: null,
            accumulatedText: "",
            terminals: new Map(),
            cwd: effectiveCwd,
            cleaned: false,
          }
          connRef.current = agentConn
          connections.set(sessionId, agentConn)

          // Update session in DB
          yield* repo
            .updateAgentSessionId(sessionId, agentSessionId)
            .pipe(Effect.orDie)

          // Consolidated cleanup for both connection close and process exit
          clientConnection.closed.then(() => {
            cleanupConnection(sessionId, agentConn)
          })

          proc.on("exit", () => {
            cleanupConnection(sessionId, agentConn)
          })

          return { agentSessionId }
        }
      )

      const prompt = Effect.fn("AcpClient.prompt")(
        function* (sessionId: string, content: string) {
          const conn = connections.get(sessionId)
          if (!conn) {
            return yield* new AcpConnectionError({
              message: "Agent not connected for this session",
            })
          }

          if (conn.prompting) {
            return yield* new AcpConnectionError({
              message: "A prompt is already in progress for this session",
            })
          }

          // Create user turn + block in DB
          const userTurn = yield* repo.addTurn(sessionId, "user").pipe(Effect.orDie)
          yield* repo.addMessageBlock(userTurn.id, "text", content).pipe(Effect.orDie)
          yield* repo.completeTurn(userTurn.id, "end_turn").pipe(Effect.orDie)

          // Create assistant turn
          const assistantTurn = yield* repo.addTurn(sessionId, "assistant").pipe(Effect.orDie)

          // Set prompting state
          conn.prompting = true
          conn.currentAssistantTurnId = assistantTurn.id
          conn.accumulatedText = ""

          // Broadcast prompt_started
          conn.broadcaster.broadcast({
            sessionUpdate: "prompt_started",
            userTurnId: userTurn.id,
            assistantTurnId: assistantTurn.id,
          })

          // Fire prompt asynchronously — use runPromise from the layer-level
          // runtime so DB operations have access to SqlClient
          const persistCompletion = (stopReason: string) =>
            Effect.gen(function* () {
              if (conn.accumulatedText) {
                yield* repo
                  .addMessageBlock(assistantTurn.id, "text", conn.accumulatedText)
                  .pipe(Effect.orDie)
              }
              yield* repo
                .completeTurn(assistantTurn.id, stopReason)
                .pipe(Effect.orDie)
            })

          conn.connection
            .prompt({
              sessionId: conn.agentSessionId,
              prompt: [{ type: "text", text: content }],
            })
            .then(async (response) => {
              const reason = response.stopReason || "end_turn"
              await runPromise(persistCompletion(reason))
              conn.broadcaster.broadcast({
                sessionUpdate: "done",
                stopReason: reason,
              })
            })
            .catch(async (err) => {
              await runPromise(persistCompletion("error")).catch(() => {})
              conn.broadcaster.broadcast({
                sessionUpdate: "error",
                message: String(err),
              })
            })
            .finally(() => {
              conn.prompting = false
              conn.currentAssistantTurnId = null
              conn.accumulatedText = ""
            })

          return { userTurnId: userTurn.id, assistantTurnId: assistantTurn.id }
        }
      )

      const cancel = Effect.fn("AcpClient.cancel")(
        function* (sessionId: string) {
          const conn = connections.get(sessionId)
          if (conn) {
            yield* Effect.promise(() =>
              conn.connection.cancel({ sessionId: conn.agentSessionId })
            )
          }
        }
      )

      const subscribe = Effect.fn("AcpClient.subscribe")(
        function* (sessionId: string, afterEventId?: number) {
          const conn = connections.get(sessionId)
          if (!conn) {
            return yield* new AcpConnectionError({
              message: "Agent not connected for this session",
            })
          }

          const { subscriberId, stream, latestEventId } =
            conn.broadcaster.subscribe(afterEventId)

          return {
            subscriberId,
            stream,
            prompting: conn.prompting,
            assistantTurnId: conn.currentAssistantTurnId,
            latestEventId,
          }
        }
      )

      const unsubscribe = Effect.fn("AcpClient.unsubscribe")(
        function* (sessionId: string, subscriberId: string) {
          const conn = connections.get(sessionId)
          if (conn) {
            conn.broadcaster.unsubscribe(subscriberId)
          }
        }
      )

      const disconnect = Effect.fn("AcpClient.disconnect")(
        function* (sessionId: string) {
          const conn = connections.get(sessionId)
          if (conn) {
            // Mark as cleaned to prevent the async cleanup handlers from
            // running after we've already cleaned up
            conn.cleaned = true
            connections.delete(sessionId)
            // Kill all terminal subprocesses
            for (const terminal of conn.terminals.values()) {
              if (!terminal.process.killed) {
                terminal.process.kill()
              }
            }
            conn.terminals.clear()
            if (!conn.process.killed) {
              conn.process.kill()
            }
            conn.broadcaster.close()
          }
        }
      )

      const isConnected = Effect.fn("AcpClient.isConnected")(
        function* (sessionId: string) {
          return connections.has(sessionId)
        }
      )

      return AcpClient.of({
        connect,
        prompt,
        cancel,
        disconnect,
        isConnected,
        subscribe,
        unsubscribe,
        connectedSessionIds: () =>
          new Set(connections.keys()) as ReadonlySet<string>,
        promptingSessionIds: () =>
          new Set(
            [...connections.entries()]
              .filter(([, c]) => c.prompting)
              .map(([id]) => id)
          ) as ReadonlySet<string>,
      })
    })
  )
}
