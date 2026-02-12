import { spawn } from "node:child_process"
import { Context, Effect, Layer, Runtime } from "effect"
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk"
import { nodeToWebWritable, nodeToWebReadable } from "@zed-industries/claude-code-acp"
import { SessionRepo } from "./session-repo.js"
import { AcpConnectionError } from "./schema.js"
import { EventBroadcaster } from "./event-broadcaster.js"
import { resolveProviderBin, PROVIDERS } from "./providers.js"
import {
  type AgentConnection,
  type SubscribeResult,
  formatHistory,
  requireConnection,
} from "./acp-types.js"
import { makeClient, type ClientDeps } from "./acp-client-callbacks.js"

export class AcpClient extends Context.Tag("@agentpane/AcpClient")<
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
    readonly subscribe: (sessionId: string, afterEventId?: number) => Effect.Effect<SubscribeResult>
    readonly unsubscribe: (sessionId: string, subscriberId: string) => Effect.Effect<void>
    readonly respondToPermission: (
      sessionId: string,
      requestId: string,
      optionId: string
    ) => Effect.Effect<void, AcpConnectionError>
    readonly connectedSessionIds: () => ReadonlySet<string>
    readonly promptingSessionIds: () => ReadonlySet<string>
    readonly getAvailableCommands: (
      sessionId: string
    ) => Effect.Effect<Array<Record<string, unknown>>, AcpConnectionError>
    readonly getConfigOptions: (
      sessionId: string
    ) => Effect.Effect<Array<Record<string, unknown>>, AcpConnectionError>
    readonly setConfigOption: (
      sessionId: string,
      configId: string,
      value: string
    ) => Effect.Effect<Array<Record<string, unknown>>, AcpConnectionError>
    readonly ensureBroadcaster: (sessionId: string) => EventBroadcaster
    readonly removeBroadcaster: (sessionId: string) => void
  }
>() {
  static readonly layer = Layer.effect(
    AcpClient,
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const runtime = yield* Effect.runtime<never>()
      const runPromise = Runtime.runPromise(runtime)

      const connections = new Map<string, AgentConnection>()
      const promptingSessions = new Set<string>()
      // Session-level broadcasters — separate from connections so they survive disconnects
      const broadcasters = new Map<string, EventBroadcaster>()
      // Pending idle cleanup timers for broadcasters
      const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
      const BROADCASTER_IDLE_MS = 5 * 60 * 1000 // 5 minutes

      // Client deps for makeClient — constructed once, shared across all connections
      const clientDeps: ClientDeps = {
        addMessageBlock: (turnId, kind, content) =>
          runPromise(
            repo.addMessageBlock(turnId, kind, content).pipe(
              Effect.tapError((err) => Effect.logWarning(`Failed to persist ${kind} block: ${err}`)),
              Effect.ignore
            )
          ),
        broadcasters,
      }

      const scheduleIdleCleanup = (sessionId: string): void => {
        // Don't schedule if connected or already scheduled
        if (connections.has(sessionId) || idleTimers.has(sessionId)) return
        const timer = setTimeout(() => {
          idleTimers.delete(sessionId)
          const broadcaster = broadcasters.get(sessionId)
          // Only remove if still disconnected and no subscribers
          if (broadcaster && !connections.has(sessionId) && broadcaster.subscriberCount === 0) {
            broadcaster.close()
            broadcasters.delete(sessionId)
          }
        }, BROADCASTER_IDLE_MS)
        idleTimers.set(sessionId, timer)
      }

      const cancelIdleCleanup = (sessionId: string): void => {
        const timer = idleTimers.get(sessionId)
        if (timer) {
          clearTimeout(timer)
          idleTimers.delete(sessionId)
        }
      }

      const ensureBroadcaster = (sessionId: string): EventBroadcaster => {
        cancelIdleCleanup(sessionId)
        let broadcaster = broadcasters.get(sessionId)
        if (!broadcaster) {
          broadcaster = new EventBroadcaster()
          broadcasters.set(sessionId, broadcaster)
        }
        return broadcaster
      }

      const removeBroadcaster = (sessionId: string): void => {
        cancelIdleCleanup(sessionId)
        const broadcaster = broadcasters.get(sessionId)
        if (broadcaster) {
          broadcaster.close()
          broadcasters.delete(sessionId)
        }
      }

      const cleanupConnection = (sessionId: string, conn: AgentConnection) => {
        if (conn.cleaned) return
        conn.cleaned = true

        // Resolve any pending permission requests as cancelled
        for (const pending of conn.pendingPermissions.values()) {
          pending.resolve({ outcome: "cancelled" })
        }
        conn.pendingPermissions.clear()

        // Broadcast disconnected event via session-level broadcaster
        const broadcaster = broadcasters.get(sessionId)
        if (broadcaster) {
          broadcaster.broadcast({ sessionUpdate: "disconnected" })
        }

        connections.delete(sessionId)
        promptingSessions.delete(sessionId)

        // Kill all terminal subprocesses
        for (const terminal of conn.terminals.values()) {
          if (!terminal.process.killed) {
            terminal.process.kill()
          }
        }
        conn.terminals.clear()

        // Update DB
        runPromise(
          repo.updateAgentSessionId(sessionId, null).pipe(
            Effect.tapError((err) => Effect.logWarning(`Failed to clear agent_session_id for session ${sessionId}: ${err}`)),
            Effect.ignore
          )
        )

        // Broadcaster survives disconnects but schedule idle cleanup
        scheduleIdleCleanup(sessionId)
      }

      const connect = Effect.fn("AcpClient.connect")(
        function* (sessionId: string, cwd: string, agentType: string) {
          // If already connected, disconnect first
          if (connections.has(sessionId)) {
            yield* disconnect(sessionId)
          }

          // Ensure broadcaster exists before connecting
          ensureBroadcaster(sessionId)

          const home = process.env.HOME || "/"
          const effectiveCwd = cwd === "~" ? home : cwd.startsWith("~/") ? home + cwd.slice(1) : cwd
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

          // Capture spawn errors (async ENOENT etc.) so they don't crash the server
          // and can provide a better message if initialize() fails
          let spawnError: Error | null = null
          proc.on("error", (err) => { spawnError = err })

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
            makeClient(clientDeps, sessionId, connRef),
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
                clientInfo: { name: "agentpane", version: "0.1.0" },
              }),
            catch: (err) => {
              proc.kill()
              return new AcpConnectionError({
                message: spawnError
                  ? `Failed to start ${providerName}: ${spawnError.message}`
                  : `ACP initialization failed: ${err}`,
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
            prompting: false,
            currentAssistantTurnId: null,
            accumulatedText: "",
            terminals: new Map(),
            pendingPermissions: new Map(),
            cwd: effectiveCwd,
            cleaned: false,
            configOptions: (sessionResponse as Record<string, unknown>).configOptions as Array<Record<string, unknown>> ?? [],
            availableCommands: (sessionResponse as Record<string, unknown>).availableCommands as Array<Record<string, unknown>> ?? [],
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

          // Broadcast connected event (include configOptions so frontend gets initial state)
          const broadcaster = broadcasters.get(sessionId)
          if (broadcaster) {
            broadcaster.broadcast({
              sessionUpdate: "connected",
              configOptions: agentConn.configOptions,
              availableCommands: agentConn.availableCommands,
            })
          }

          return { agentSessionId }
        }
      )

      const prompt = Effect.fn("AcpClient.prompt")(
        function* (sessionId: string, content: string) {
          const conn = yield* requireConnection(connections, sessionId)

          if (conn.prompting) {
            return yield* new AcpConnectionError({
              message: "A prompt is already in progress for this session",
            })
          }

          // Fetch existing conversation history BEFORE creating new turns
          const priorTurns = yield* repo.getConversation(sessionId).pipe(Effect.orDie)

          // Create user turn + block in DB
          const userTurn = yield* repo.addTurn(sessionId, "user").pipe(Effect.orDie)
          yield* repo.addMessageBlock(userTurn.id, "text", content).pipe(Effect.orDie)
          yield* repo.completeTurn(userTurn.id, "end_turn").pipe(Effect.orDie)

          // Create assistant turn
          const assistantTurn = yield* repo.addTurn(sessionId, "assistant").pipe(Effect.orDie)

          // Build prompt with conversation history prefix
          const fullPrompt = formatHistory(priorTurns) + content

          // Set prompting state
          conn.prompting = true
          promptingSessions.add(sessionId)
          conn.currentAssistantTurnId = assistantTurn.id
          conn.accumulatedText = ""

          // Broadcast prompt_started via session-level broadcaster
          const broadcaster = broadcasters.get(sessionId)
          if (broadcaster) {
            broadcaster.broadcast({
              sessionUpdate: "prompt_started",
              userTurnId: userTurn.id,
              assistantTurnId: assistantTurn.id,
            })
          }

          // Fire prompt asynchronously
          const persistCompletion = (stopReason: string) =>
            Effect.gen(function* () {
              if (conn.accumulatedText) {
                yield* repo.addMessageBlock(assistantTurn.id, "text", conn.accumulatedText)
              }
              yield* repo.completeTurn(assistantTurn.id, stopReason)
            }).pipe(
              Effect.tapError((err) => Effect.logWarning(`Failed to persist completion for session ${sessionId}: ${err}`)),
              Effect.ignore
            )

          conn.connection
            .prompt({
              sessionId: conn.agentSessionId,
              prompt: [{ type: "text", text: fullPrompt }],
            })
            .then(async (response) => {
              const reason = response.stopReason || "end_turn"
              await runPromise(persistCompletion(reason))
              const b = broadcasters.get(sessionId)
              if (b) {
                b.broadcast({ sessionUpdate: "done", stopReason: reason })
              }
            })
            .catch(async (err) => {
              await runPromise(persistCompletion("error"))
              const b = broadcasters.get(sessionId)
              if (b) {
                b.broadcast({ sessionUpdate: "error", message: String(err) })
              }
            })
            .finally(() => {
              conn.prompting = false
              conn.currentAssistantTurnId = null
              conn.accumulatedText = ""
              // Only clean up the global set if this connection is still the active one —
              // a reconnect may have already replaced it with a new connection.
              if (connections.get(sessionId) === conn) {
                promptingSessions.delete(sessionId)
              }
            })

          return { userTurnId: userTurn.id, assistantTurnId: assistantTurn.id }
        }
      )

      const cancel = (sessionId: string): Effect.Effect<void> => {
        const conn = connections.get(sessionId)
        if (!conn) return Effect.void

        // Resolve any pending permission requests as cancelled
        for (const pending of conn.pendingPermissions.values()) {
          pending.resolve({ outcome: "cancelled" })
        }
        conn.pendingPermissions.clear()

        return Effect.promise(() =>
          conn.connection.cancel({ sessionId: conn.agentSessionId })
        )
      }

      const subscribe = (sessionId: string, afterEventId?: number): Effect.Effect<SubscribeResult> =>
        Effect.sync(() => {
          const broadcaster = ensureBroadcaster(sessionId)
          const { subscriberId, stream, latestEventId } =
            broadcaster.subscribe(afterEventId)
          const conn = connections.get(sessionId)
          return {
            subscriberId,
            stream,
            prompting: conn?.prompting ?? false,
            assistantTurnId: conn?.currentAssistantTurnId ?? null,
            latestEventId,
          }
        })

      const unsubscribe = (sessionId: string, subscriberId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const broadcaster = broadcasters.get(sessionId)
          if (broadcaster) {
            broadcaster.unsubscribe(subscriberId)
            // If disconnected and no subscribers remain, schedule idle cleanup
            if (!connections.has(sessionId) && broadcaster.subscriberCount === 0) {
              scheduleIdleCleanup(sessionId)
            }
          }
        })

      const disconnect = (sessionId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const conn = connections.get(sessionId)
          if (!conn) return
          // Kill the main process (triggers cleanupConnection via exit/close handlers,
          // but we call it directly to ensure synchronous cleanup)
          if (!conn.process.killed) {
            conn.process.kill()
          }
          cleanupConnection(sessionId, conn)
        })

      const respondToPermission = Effect.fn("AcpClient.respondToPermission")(
        function* (sessionId: string, requestId: string, optionId: string) {
          const conn = yield* requireConnection(connections, sessionId)

          const pending = conn.pendingPermissions.get(requestId)
          if (!pending) {
            return yield* new AcpConnectionError({
              message: "No pending permission request with this ID",
            })
          }

          pending.resolve({ outcome: "selected", optionId })
          conn.pendingPermissions.delete(requestId)

          const broadcaster = broadcasters.get(sessionId)
          if (broadcaster) {
            broadcaster.broadcast({
              sessionUpdate: "permission_resolved",
              requestId,
            })
          }
        }
      )

      const getAvailableCommands = Effect.fn("AcpClient.getAvailableCommands")(
        function* (sessionId: string) {
          const conn = yield* requireConnection(connections, sessionId)
          return conn.availableCommands
        }
      )

      const getConfigOptions = Effect.fn("AcpClient.getConfigOptions")(
        function* (sessionId: string) {
          const conn = yield* requireConnection(connections, sessionId)
          return conn.configOptions
        }
      )

      const setConfigOption = Effect.fn("AcpClient.setConfigOption")(
        function* (sessionId: string, configId: string, value: string) {
          const conn = yield* requireConnection(connections, sessionId)

          const response = yield* Effect.tryPromise({
            try: () =>
              conn.connection.setSessionConfigOption({
                sessionId: conn.agentSessionId,
                configId,
                value,
              }),
            catch: (err) =>
              new AcpConnectionError({
                message: `Failed to set config option: ${err}`,
              }),
          })

          const updated = (response as Record<string, unknown>).configOptions as Array<Record<string, unknown>> ?? []
          conn.configOptions = updated

          // Broadcast so all connected clients see the update
          const broadcaster = broadcasters.get(sessionId)
          if (broadcaster) {
            broadcaster.broadcast({
              sessionUpdate: "config_option_update",
              configOptions: updated,
            })
          }

          return updated
        }
      )

      const isConnected = (sessionId: string): Effect.Effect<boolean> =>
        Effect.succeed(connections.has(sessionId))

      return AcpClient.of({
        connect,
        prompt,
        cancel,
        disconnect,
        respondToPermission,
        isConnected,
        subscribe,
        unsubscribe,
        getAvailableCommands,
        getConfigOptions,
        setConfigOption,
        connectedSessionIds: () =>
          new Set(connections.keys()) as ReadonlySet<string>,
        promptingSessionIds: () => promptingSessions as ReadonlySet<string>,
        ensureBroadcaster,
        removeBroadcaster,
      })
    })
  )
}
