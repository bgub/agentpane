import { Context, Effect, Layer } from "effect"
import { AcpConnectionError, AuthRequiredError } from "./schema.js"
import { EventBroadcaster } from "./event-broadcaster.js"
import { type SubscribeResult } from "./acp-types.js"
import { EventHub, type EventHubStats } from "./event-hub.js"
import { ConnectionManager, type ConnectionManagerStats } from "./connection-manager.js"
import { PromptEngine, type PromptInputBlock } from "./prompt-engine.js"
import { WriteQueue, type WriteQueueStats } from "./write-queue.js"

export class AcpClient extends Context.Tag("@agentpane/AcpClient")<
  AcpClient,
  {
    readonly connect: (
      sessionId: string,
      cwd: string,
      agentType: string,
      agentSessionId?: string | null,
      authMethodId?: string
    ) => Effect.Effect<{ agentSessionId: string }, AcpConnectionError | AuthRequiredError>
    readonly prompt: (
      sessionId: string,
      blocks: ReadonlyArray<PromptInputBlock>
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
    readonly ensureBroadcaster: (sessionId: string) => EventBroadcaster
    readonly removeBroadcaster: (sessionId: string) => void
    readonly stats: () => {
      connections: ConnectionManagerStats
      events: EventHubStats
      writes: WriteQueueStats
    }
  }
>() {
  static readonly layer = Layer.effect(
    AcpClient,
    Effect.gen(function* () {
      const events = yield* EventHub
      const connections = yield* ConnectionManager
      const prompts = yield* PromptEngine
      const writes = yield* WriteQueue

      const subscribe = Effect.fn("AcpClient.subscribe")(
        function* (sessionId: string, afterEventId?: number) {
          const { subscriberId, stream, latestEventId, replayGap } = yield* events.subscribe(sessionId, afterEventId)
          const promptState = connections.getPromptState(sessionId)
          return {
            subscriberId,
            stream,
            prompting: promptState.prompting,
            assistantTurnId: promptState.assistantTurnId,
            latestEventId,
            replayGap,
          }
        }
      )

      return AcpClient.of({
        connect: connections.connect,
        prompt: prompts.prompt,
        cancel: connections.cancel,
        disconnect: connections.disconnect,
        isConnected: connections.isConnected,
        subscribe,
        unsubscribe: events.unsubscribe,
        respondToPermission: connections.respondToPermission,
        connectedSessionIds: connections.connectedSessionIds,
        promptingSessionIds: connections.promptingSessionIds,
        getAvailableCommands: connections.getAvailableCommands,
        getConfigOptions: connections.getConfigOptions,
        setConfigOption: connections.setConfigOption,
        getModes: connections.getModes,
        setMode: connections.setMode,
        listAgentSessions: connections.listAgentSessions,
        ensureBroadcaster: events.ensure,
        removeBroadcaster: events.remove,
        stats: () => ({
          connections: connections.stats(),
          events: events.stats(),
          writes: writes.stats(),
        }),
      })
    })
  )
}
