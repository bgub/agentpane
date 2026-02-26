import { spawn } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import { Context, Effect, Layer, Runtime } from "effect"
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk"

function nodeToWebWritable(nodeStream: Writable): WritableStream<Uint8Array> {
  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        nodeStream.write(Buffer.from(chunk), (err) => (err ? reject(err) : resolve()))
      })
    },
  })
}

function nodeToWebReadable(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      nodeStream.on("end", () => controller.close())
      nodeStream.on("error", (err: Error) => controller.error(err))
    },
  })
}
import { AcpConnectionError, AuthRequiredError } from "./schema.js"
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
      agentType: string,
      agentSessionId?: string | null,
      authMethodId?: string,
      mcpServers?: ReadonlyArray<Record<string, unknown>>
    ) => Effect.Effect<{ agentSessionId: string }, AcpConnectionError | AuthRequiredError>
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
    readonly getModes: (
      sessionId: string
    ) => Effect.Effect<Record<string, unknown> | null, AcpConnectionError>
    readonly setMode: (
      sessionId: string,
      modeId: string
    ) => Effect.Effect<Record<string, unknown> | null, AcpConnectionError>
    readonly listAgentSessions: (
      sessionId: string,
      cwd?: string
    ) => Effect.Effect<unknown, AcpConnectionError>
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
        updateSessionName: (sessionId, title) =>
          runPromise(
            writeQueue.enqueue({ _tag: "RenameSession", sessionId, name: title }).pipe(
              Effect.zipRight(writeQueue.flushSession(sessionId)),
              Effect.tapError((err) => Effect.logWarning(`Failed to rename session: ${err}`)),
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
          writeQueue.flushSession(sessionId).pipe(
            Effect.tapError((err) => Effect.logWarning(`Failed to flush writes for ${sessionId}: ${err}`)),
            Effect.ignore
          )
        )
      }

      const connect = Effect.fn("ConnectionManager.connect")(
        function* (
          sessionId: string,
          cwd: string,
          agentType: string,
          agentSessionId?: string | null,
          authMethodId?: string,
          mcpServers?: ReadonlyArray<Record<string, unknown>>
        ) {
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
          const rawReadableWeb = nodeToWebReadable(proc.stdout!)

          // Instrumented readable: logs stdout chunks when AGENTPANE_DEBUG_STREAM=1
          const debugStream = process.env.AGENTPANE_DEBUG_STREAM === "1"
          const readableWeb = debugStream
            ? rawReadableWeb.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  const now = performance.now().toFixed(1)
                  console.log(`[${now}ms] stdout data: ${chunk.byteLength} bytes (session ${sessionId.slice(0, 8)})`)
                  controller.enqueue(chunk)
                },
              }))
            : rawReadableWeb

          const stream = ndJsonStream(
            writableWeb as unknown as WritableStream<Uint8Array>,
            readableWeb as unknown as ReadableStream<Uint8Array>
          )

          const connRef: { current: AgentConnection | null } = { current: null }
          const clientConnection = new ClientSideConnection(
            makeClient(clientDeps, sessionId, connRef),
            stream
          )

          const initResponse = yield* Effect.tryPromise({
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

          // Extract capabilities from init response
          const agentCapabilities = (initResponse as Record<string, unknown>).agentCapabilities as
            | { loadSession?: boolean; sessionCapabilities?: { list?: unknown }; prompt?: Record<string, unknown>; mcp?: Record<string, unknown> } | undefined
          const supportsLoadSession = agentCapabilities?.loadSession === true
          const supportsSessionList = agentCapabilities?.sessionCapabilities?.list != null

          // Extract prompt and MCP capabilities
          const promptCapabilities: import("./acp-types.js").PromptCapabilities = {}
          if (agentCapabilities?.prompt) {
            const pc = agentCapabilities.prompt
            if (typeof pc.image === "boolean") promptCapabilities.image = pc.image
            if (typeof pc.resourceLinks === "boolean") promptCapabilities.resourceLinks = pc.resourceLinks
          }
          const mcpCapabilities: import("./acp-types.js").McpCapabilities = {}
          if (agentCapabilities?.mcp) {
            const mc = agentCapabilities.mcp
            if (typeof mc.supported === "boolean") mcpCapabilities.supported = mc.supported
          }

          // Capture auth methods for better error messages if newSession fails
          const authMethods = (initResponse as Record<string, unknown>).authMethods as
            | Array<{ id: string; name: string; description?: string }> | undefined

          if (authMethodId) {
            yield* Effect.tryPromise({
              try: () =>
                clientConnection.authenticate({
                  methodId: authMethodId,
                }),
              catch: (err) => {
                proc.kill()
                return new AcpConnectionError({
                  message: `Authentication failed for ${providerName}: ${err}`,
                })
              },
            })
          }

          // Try loadSession if agent supports it and we have a stored agentSessionId
          let resolvedAgentSessionId: string | null = null
          let sessionResponse: Record<string, unknown> | null = null

          if (supportsLoadSession && agentSessionId) {
            const loadResult = yield* Effect.tryPromise({
              try: () =>
                clientConnection.loadSession({
                  sessionId: agentSessionId,
                  cwd: effectiveCwd,
                  mcpServers: (mcpServers ?? []) as never,
                }),
              catch: () =>
                new AcpConnectionError({ message: "loadSession failed" }),
            }).pipe(Effect.option)
            if (loadResult._tag === "Some") {
              resolvedAgentSessionId = agentSessionId
              sessionResponse = loadResult.value as Record<string, unknown>
              yield* Effect.logInfo(`Resumed agent session ${agentSessionId.slice(0, 8)} via loadSession`)
            }
          }

          // Fall back to newSession if loadSession wasn't attempted or failed
          if (!resolvedAgentSessionId) {
            const newSessionResponse = yield* Effect.tryPromise({
              try: () =>
                clientConnection.newSession({
                  cwd: effectiveCwd,
                  mcpServers: (mcpServers ?? []) as never,
                }),
              catch: (err) => {
                proc.kill()
                const msg = err instanceof Error ? err.message : String(err)
                const isAuthError = msg.includes("Authentication required") ||
                  (err as { code?: number }).code === -32000
                if (isAuthError) {
                  const hint = authMethods?.[0]?.description
                  return new AuthRequiredError({
                    message: hint
                      ? `Authentication required for ${providerName} — ${hint}`
                      : `Authentication required for ${providerName}`,
                    provider: providerName,
                    authMethods: authMethods ?? [],
                  })
                }
                return new AcpConnectionError({
                  message: `Failed to create agent session: ${err}`,
                })
              },
            })
            resolvedAgentSessionId = newSessionResponse.sessionId
            sessionResponse = newSessionResponse as unknown as Record<string, unknown>
          }

          const agentConn: AgentConnection = {
            process: proc,
            connection: clientConnection,
            agentSessionId: resolvedAgentSessionId!,
            prompting: false,
            currentAssistantTurnId: null,
            accumulatedText: "",
            accumulatedThought: "",
            lastPlanContent: null,
            terminals: new Map(),
            pendingPermissions: new Map(),
            cwd: effectiveCwd,
            cleaned: false,
            configOptions: sessionResponse?.configOptions as Array<Record<string, unknown>> ?? [],
            availableCommands: sessionResponse?.availableCommands as Array<Record<string, unknown>> ?? [],
            modes: (sessionResponse?.modes && typeof sessionResponse.modes === "object")
              ? (sessionResponse.modes as Record<string, unknown>)
              : null,
            promptCapabilities,
            mcpCapabilities,
            supportsLoadSession,
            supportsSessionList,
          }
          connRef.current = agentConn
          connections.set(sessionId, agentConn)

          yield* writeQueue.enqueue({
            _tag: "UpdateAgentSessionId",
            sessionId,
            agentSessionId: resolvedAgentSessionId,
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
            modes: agentConn.modes,
            promptCapabilities: agentConn.promptCapabilities,
            mcpCapabilities: agentConn.mcpCapabilities,
          })

          return { agentSessionId: resolvedAgentSessionId! }
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
            conn.accumulatedThought = ""
            conn.lastPlanContent = null
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

      const getModes = Effect.fn("ConnectionManager.getModes")(
        function* (sessionId: string) {
          const conn = yield* requireConnection(connections, sessionId)
          return conn.modes
        }
      )

      const setMode = Effect.fn("ConnectionManager.setMode")(
        function* (sessionId: string, modeId: string) {
          const conn = yield* requireConnection(connections, sessionId)

          const setSessionMode = (conn.connection as unknown as Record<string, unknown>).setSessionMode
          if (typeof setSessionMode !== "function") {
            return yield* new AcpConnectionError({
              message: "Agent does not support mode switching",
            })
          }

          const response = yield* Effect.tryPromise({
            try: () =>
              (setSessionMode as (args: { sessionId: string; modeId: string }) => Promise<unknown>)({
                sessionId: conn.agentSessionId,
                modeId,
              }),
            catch: (err) =>
              new AcpConnectionError({
                message: `Failed to set mode: ${err}`,
              }),
          })

          const nextModes = (response as Record<string, unknown>).modes
          if (nextModes && typeof nextModes === "object") {
            conn.modes = nextModes as Record<string, unknown>
          } else {
            conn.modes = { ...(conn.modes ?? {}), currentModeId: modeId }
          }

          eventHub.broadcast(sessionId, {
            sessionUpdate: "current_mode_update",
            ...(conn.modes ?? {}),
          })

          return conn.modes
        }
      )

      const listAgentSessions = Effect.fn("ConnectionManager.listAgentSessions")(
        function* (sessionId: string, cwd?: string) {
          const conn = yield* requireConnection(connections, sessionId)
          if (!conn.supportsSessionList) {
            return yield* new AcpConnectionError({
              message: "Agent does not support listing sessions",
            })
          }
          return yield* Effect.tryPromise({
            try: () => conn.connection.unstable_listSessions({ cwd: cwd ?? null }),
            catch: (err) =>
              new AcpConnectionError({
                message: `Failed to list agent sessions: ${err}`,
              }),
          })
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
        getModes,
        setMode,
        listAgentSessions,
        stats,
      })
    })
  )
}
