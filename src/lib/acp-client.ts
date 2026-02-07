import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Readable, Writable } from "node:stream"
import { Context, Effect, Layer, Runtime } from "effect"
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type Agent,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type KillTerminalCommandRequest,
  type KillTerminalCommandResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
} from "@agentclientprotocol/sdk"
import { nodeToWebWritable, nodeToWebReadable } from "@zed-industries/claude-code-acp"
import { SessionRepo } from "./session-repo"
import { AcpConnectionError } from "./schema"

interface AgentConnection {
  process: ChildProcess
  connection: ClientSideConnection
  agentSessionId: string
  /** Controller to push SSE events during a prompt */
  sseController: ReadableStreamDefaultController<string> | null
  prompting: boolean
}

export class AcpClient extends Context.Tag("@acapa/AcpClient")<
  AcpClient,
  {
    readonly connect: (
      sessionId: string,
      cwd: string
    ) => Effect.Effect<{ agentSessionId: string }, AcpConnectionError>
    readonly prompt: (
      sessionId: string,
      content: string
    ) => Effect.Effect<ReadableStream<string>, AcpConnectionError>
    readonly cancel: (sessionId: string) => Effect.Effect<void>
    readonly disconnect: (sessionId: string) => Effect.Effect<void>
    readonly isConnected: (sessionId: string) => Effect.Effect<boolean>
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

      const makeClient = (
        connRef: { current: AgentConnection | null }
      ): ((agent: Agent) => Client) => {
        return (_agent: Agent): Client => ({
          sessionUpdate: async (params: SessionNotification) => {
            const conn = connRef.current
            if (conn?.sseController) {
              const event = `data: ${JSON.stringify(params.update)}\n\n`
              conn.sseController.enqueue(event)
            }
          },

          requestPermission: async (
            params: RequestPermissionRequest
          ): Promise<RequestPermissionResponse> => {
            // Phase 1: auto-allow first option
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

          readTextFile: async (
            params: ReadTextFileRequest
          ): Promise<ReadTextFileResponse> => {
            const content = await fs.readFile(params.path, "utf-8")
            return { content }
          },

          writeTextFile: async (
            params: WriteTextFileRequest
          ): Promise<WriteTextFileResponse> => {
            await fs.writeFile(params.path, params.content, "utf-8")
            return {}
          },

          createTerminal: async (
            _params: CreateTerminalRequest
          ): Promise<CreateTerminalResponse> => {
            console.warn("[acapa] TODO: createTerminal not yet implemented")
            return { terminalId: `stub-${Date.now()}` }
          },

          terminalOutput: async (
            _params: TerminalOutputRequest
          ): Promise<TerminalOutputResponse> => {
            console.warn("[acapa] TODO: terminalOutput not yet implemented")
            return { output: "", truncated: false }
          },

          waitForTerminalExit: async (
            _params: WaitForTerminalExitRequest
          ): Promise<WaitForTerminalExitResponse> => {
            console.warn("[acapa] TODO: waitForTerminalExit not yet implemented")
            return { exitCode: 0 }
          },

          killTerminal: async (
            _params: KillTerminalCommandRequest
          ): Promise<KillTerminalCommandResponse> => {
            console.warn("[acapa] TODO: killTerminal not yet implemented")
            return {}
          },

          releaseTerminal: async (
            _params: ReleaseTerminalRequest
          ): Promise<ReleaseTerminalResponse> => {
            console.warn("[acapa] TODO: releaseTerminal not yet implemented")
            return {}
          },
        })
      }

      const connect = Effect.fn("AcpClient.connect")(
        function* (sessionId: string, cwd: string) {
          // If already connected, disconnect first
          if (connections.has(sessionId)) {
            yield* disconnect(sessionId)
          }

          const effectiveCwd = cwd === "~" ? process.env.HOME || "/" : cwd
          const binPath = path.resolve(
            process.cwd(),
            "node_modules/.bin/claude-code-acp"
          )

          const proc = yield* Effect.try({
            try: () =>
              spawn(binPath, [], {
                cwd: effectiveCwd,
                stdio: ["pipe", "pipe", "inherit"],
                env: { ...process.env },
              }),
            catch: (err) =>
              new AcpConnectionError({
                message: `Failed to spawn claude-code-acp: ${err}`,
              }),
          })

          if (!proc.stdin || !proc.stdout) {
            proc.kill()
            return yield* new AcpConnectionError({
              message: "Failed to get stdio streams from agent process",
            })
          }

          const writableWeb = nodeToWebWritable(proc.stdin as Writable)
          const readableWeb = nodeToWebReadable(proc.stdout as Readable)
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
            sseController: null,
            prompting: false,
          }
          connRef.current = agentConn
          connections.set(sessionId, agentConn)

          // Update session in DB
          yield* repo
            .updateAgentSessionId(sessionId, agentSessionId)
            .pipe(Effect.orDie)

          // Clean up when connection closes
          clientConnection.closed.then(() => {
            connections.delete(sessionId)
            runPromise(
              repo.updateAgentSessionId(sessionId, null).pipe(Effect.orDie)
            ).catch(() => {})
          })

          proc.on("exit", () => {
            connections.delete(sessionId)
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

          conn.prompting = true

          const sseStream = new ReadableStream<string>({
            start(controller) {
              conn.sseController = controller
            },
            cancel() {
              conn.sseController = null
              conn.prompting = false
            },
          })

          // Start the prompt asynchronously — it resolves when the agent is done
          conn.connection
            .prompt({
              sessionId: conn.agentSessionId,
              prompt: [{ type: "text", text: content }],
            })
            .then((response) => {
              if (conn.sseController) {
                const doneEvent = `data: ${JSON.stringify({ sessionUpdate: "done", stopReason: response.stopReason })}\n\n`
                conn.sseController.enqueue(doneEvent)
                conn.sseController.close()
              }
              conn.sseController = null
              conn.prompting = false
            })
            .catch((err) => {
              if (conn.sseController) {
                const errorEvent = `data: ${JSON.stringify({ sessionUpdate: "error", message: String(err) })}\n\n`
                conn.sseController.enqueue(errorEvent)
                conn.sseController.close()
              }
              conn.sseController = null
              conn.prompting = false
            })

          return sseStream
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

      const disconnect = Effect.fn("AcpClient.disconnect")(
        function* (sessionId: string) {
          const conn = connections.get(sessionId)
          if (conn) {
            connections.delete(sessionId)
            if (!conn.process.killed) {
              conn.process.kill()
            }
            if (conn.sseController) {
              conn.sseController.close()
              conn.sseController = null
            }
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
