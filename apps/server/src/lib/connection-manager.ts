import { spawn } from "node:child_process"
import { Context, Effect, Layer, Runtime } from "effect"
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk"
import { nodeToWebWritable, nodeToWebReadable } from "@zed-industries/claude-code-acp"
import { AcpConnectionError } from "./schema.js"
import { resolveProviderBin, PROVIDERS } from "./providers.js"
import {
  type AgentConnection,
  requireConnection,
} from "./acp-types.js"
import { makeClient, type ClientDeps } from "./acp-client-callbacks.js"
import { EventHub } from "./event-hub.js"
import { WriteQueue } from "./write-queue.js"

export interface ConnectionManagerStats {
  connectedSessions: number
  promptingSessions: number
  terminals: number
  pendingPermissions: number
  bySession: ReadonlyArray<{
    sessionId: string
    prompting: boolean
    currentAssistantTurnId: string | null
    terminals: number
    pendingPermissions: number
  }>
}

export class ConnectionManager extends Context.Tag("@agentpane/ConnectionManager")<
  ConnectionManager,
  {
    readonly connect: (
      sessionId: string,
      cwd: string,
      agentType: string
    ) => Effect.Effect<{ agentSessionId: string }, AcpConnectionError>
    readonly disconnect: (sessionId: string) => Effect.Effect<void>
    readonly cancel: (sessionId: string) => Effect.Effect<void>
    readonly get: (sessionId: string) => Effect.Effect<AgentConnection, AcpConnectionError>
    readonly isConnected: (sessionId: string) => Effect.Effect<boolean>
    readonly connectedSessionIds: () => ReadonlySet<string>
    readonly promptingSessionIds: () => ReadonlySet<string>
    readonly getPromptState: (sessionId: string) => { prompting: boolean; assistantTurnId: string | null }
    readonly setPromptState: (
      sessionId: string,
      prompting: boolean,
      assistantTurnId: string | null,
      expectedAgentSessionId?: string
    ) => Effect.Effect<void>
    readonly respondToPermission: (
      sessionId: string,
      requestId: string,
      optionId: string
    ) => Effect.Effect<void, AcpConnectionError>
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
    readonly stats: () => ConnectionManagerStats
  }
>() {
  static readonly layer = Layer.effect(
    ConnectionManager,
    Effect.gen(function* () {
      const eventHub = yield* EventHub
      const writeQueue = yield* WriteQueue
      const runtime = yield* Effect.runtime<never>()
      const runPromise = Runtime.runPromise(runtime)

      const connections = new Map<string, AgentConnection>()
      const promptingSessions = new Set<string>()

      const clientDeps: ClientDeps = {
        enqueueMessageBlock: (sessionId, turnId, kind, content) =>
          runPromise(
            writeQueue.enqueue({
              _tag: "AddMessageBlock",
              sessionId,
              turnId,
              kind,
              content,
            }).pipe(
              Effect.tapError((err) => Effect.logWarning(`Failed to enqueue ${kind} block: ${err}`)),
              Effect.ignore
            )
          ),
        broadcast: (sessionId, event) => eventHub.broadcast(sessionId, event),
      }

      const cleanupConnection = (sessionId: string, conn: AgentConnection) => {
        if (conn.cleaned) return
        conn.cleaned = true

        for (const pending of conn.pendingPermissions.values()) {
          pending.resolve({ outcome: "cancelled" })
        }
        conn.pendingPermissions.clear()

        connections.delete(sessionId)
        promptingSessions.delete(sessionId)

        eventHub.broadcast(sessionId, { sessionUpdate: "disconnected" })
        eventHub.markDisconnected(sessionId)

        for (const terminal of conn.terminals.values()) {
          if (!terminal.process.killed) {
            terminal.process.kill()
          }
        }
        conn.terminals.clear()

        runPromise(
          writeQueue
            .enqueue({
              _tag: "UpdateAgentSessionId",
              sessionId,
              agentSessionId: null,
            })
            .pipe(
              Effect.zipRight(writeQueue.flushSession(sessionId)),
              Effect.tapError((err) => Effect.logWarning(`Failed to clear agent session id for ${sessionId}: ${err}`)),
              Effect.ignore
            )
        )
      }

      const connect = Effect.fn("ConnectionManager.connect")(
        function* (sessionId: string, cwd: string, agentType: string) {
          if (connections.has(sessionId)) {
            yield* disconnect(sessionId)
          }

          eventHub.ensure(sessionId)

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

          let spawnError: Error | null = null
          proc.on("error", (err) => {
            spawnError = err
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

          yield* writeQueue.enqueue({
            _tag: "UpdateAgentSessionId",
            sessionId,
            agentSessionId,
          })
          yield* writeQueue.flushSession(sessionId)

          clientConnection.closed.then(() => {
            cleanupConnection(sessionId, agentConn)
          })

          proc.on("exit", () => {
            cleanupConnection(sessionId, agentConn)
          })

          eventHub.markConnected(sessionId)
          eventHub.broadcast(sessionId, {
            sessionUpdate: "connected",
            configOptions: agentConn.configOptions,
            availableCommands: agentConn.availableCommands,
          })

          return { agentSessionId }
        }
      )

      const cancel = (sessionId: string): Effect.Effect<void> => {
        const conn = connections.get(sessionId)
        if (!conn) return Effect.void

        for (const pending of conn.pendingPermissions.values()) {
          pending.resolve({ outcome: "cancelled" })
        }
        conn.pendingPermissions.clear()

        return Effect.promise(() =>
          conn.connection.cancel({ sessionId: conn.agentSessionId })
        )
      }

      const disconnect = (sessionId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const conn = connections.get(sessionId)
          if (!conn) return
          if (!conn.process.killed) {
            conn.process.kill()
          }
          cleanupConnection(sessionId, conn)
        })

      const setPromptState = (
        sessionId: string,
        prompting: boolean,
        assistantTurnId: string | null,
        expectedAgentSessionId?: string
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          const conn = connections.get(sessionId)
          if (!conn) return
          if (expectedAgentSessionId && conn.agentSessionId !== expectedAgentSessionId) return
          conn.prompting = prompting
          conn.currentAssistantTurnId = assistantTurnId
          if (!prompting) {
            conn.accumulatedText = ""
            promptingSessions.delete(sessionId)
          } else {
            promptingSessions.add(sessionId)
          }
        })

      const respondToPermission = Effect.fn("ConnectionManager.respondToPermission")(
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
          eventHub.broadcast(sessionId, {
            sessionUpdate: "permission_resolved",
            requestId,
          })
        }
      )

      const getAvailableCommands = Effect.fn("ConnectionManager.getAvailableCommands")(
        function* (sessionId: string) {
          const conn = yield* requireConnection(connections, sessionId)
          return conn.availableCommands
        }
      )

      const getConfigOptions = Effect.fn("ConnectionManager.getConfigOptions")(
        function* (sessionId: string) {
          const conn = yield* requireConnection(connections, sessionId)
          return conn.configOptions
        }
      )

      const setConfigOption = Effect.fn("ConnectionManager.setConfigOption")(
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
          eventHub.broadcast(sessionId, {
            sessionUpdate: "config_option_update",
            configOptions: updated,
          })
          return updated
        }
      )

      const stats = () => {
        let terminals = 0
        let pendingPermissions = 0
        const bySession = [...connections.entries()].map(([sessionId, conn]) => {
          const terminalCount = conn.terminals.size
          const pendingPermissionCount = conn.pendingPermissions.size
          terminals += terminalCount
          pendingPermissions += pendingPermissionCount
          return {
            sessionId,
            prompting: conn.prompting,
            currentAssistantTurnId: conn.currentAssistantTurnId,
            terminals: terminalCount,
            pendingPermissions: pendingPermissionCount,
          }
        })

        return {
          connectedSessions: connections.size,
          promptingSessions: promptingSessions.size,
          terminals,
          pendingPermissions,
          bySession,
        }
      }

      return ConnectionManager.of({
        connect,
        disconnect,
        cancel,
        get: (sessionId: string) => requireConnection(connections, sessionId),
        isConnected: (sessionId: string) => Effect.succeed(connections.has(sessionId)),
        connectedSessionIds: () => new Set(connections.keys()) as ReadonlySet<string>,
        promptingSessionIds: () => promptingSessions as ReadonlySet<string>,
        getPromptState: (sessionId: string) => {
          const conn = connections.get(sessionId)
          return {
            prompting: conn?.prompting ?? false,
            assistantTurnId: conn?.currentAssistantTurnId ?? null,
          }
        },
        setPromptState,
        respondToPermission,
        getAvailableCommands,
        getConfigOptions,
        setConfigOption,
        stats,
      })
    })
  )
}
