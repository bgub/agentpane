import { Context, Effect, Layer } from "effect"
import { EventBroadcaster } from "./event-broadcaster.js"

export interface EventHubSubscription {
  readonly subscriberId: string
  readonly stream: ReadableStream<string>
  readonly latestEventId: number
  readonly replayGap: boolean
}

export interface EventHubSessionStats {
  readonly sessionId: string
  readonly connected: boolean
  readonly subscribers: number
  readonly replayBytes: number
  readonly replayEvents: number
  readonly latestEventId: number
  readonly oldestEventId: number | null
}

export interface EventHubStats {
  readonly sessions: number
  readonly connectedSessions: number
  readonly subscribers: number
  readonly replayBytes: number
  readonly replayEvents: number
  readonly bySession: ReadonlyArray<EventHubSessionStats>
}

const BROADCASTER_IDLE_MS = 5 * 60 * 1000

export class EventHub extends Context.Tag("@agentpane/EventHub")<
  EventHub,
  {
    readonly ensure: (sessionId: string) => EventBroadcaster
    readonly remove: (sessionId: string) => void
    readonly subscribe: (
      sessionId: string,
      afterEventId?: number
    ) => Effect.Effect<EventHubSubscription>
    readonly unsubscribe: (sessionId: string, subscriberId: string) => Effect.Effect<void>
    readonly broadcast: (sessionId: string, event: unknown) => void
    readonly markConnected: (sessionId: string) => void
    readonly markDisconnected: (sessionId: string) => void
    readonly stats: () => EventHubStats
  }
>() {
  static readonly layer = Layer.sync(
    EventHub,
    () => {
      const broadcasters = new Map<string, EventBroadcaster>()
      const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
      const connectedSessions = new Set<string>()

      const cancelIdleCleanup = (sessionId: string): void => {
        const timer = idleTimers.get(sessionId)
        if (!timer) return
        clearTimeout(timer)
        idleTimers.delete(sessionId)
      }

      const scheduleIdleCleanup = (sessionId: string): void => {
        if (connectedSessions.has(sessionId)) return
        if (idleTimers.has(sessionId)) return
        const broadcaster = broadcasters.get(sessionId)
        if (!broadcaster || broadcaster.subscriberCount > 0) return

        const timer = setTimeout(() => {
          idleTimers.delete(sessionId)
          const current = broadcasters.get(sessionId)
          if (!current || connectedSessions.has(sessionId) || current.subscriberCount > 0) return
          current.close()
          broadcasters.delete(sessionId)
        }, BROADCASTER_IDLE_MS)
        idleTimers.set(sessionId, timer)
      }

      const ensure = (sessionId: string): EventBroadcaster => {
        cancelIdleCleanup(sessionId)
        let broadcaster = broadcasters.get(sessionId)
        if (!broadcaster) {
          broadcaster = new EventBroadcaster()
          broadcasters.set(sessionId, broadcaster)
        }
        return broadcaster
      }

      const remove = (sessionId: string): void => {
        cancelIdleCleanup(sessionId)
        connectedSessions.delete(sessionId)
        const broadcaster = broadcasters.get(sessionId)
        if (!broadcaster) return
        broadcaster.close()
        broadcasters.delete(sessionId)
      }

      const subscribe = (
        sessionId: string,
        afterEventId?: number
      ): Effect.Effect<EventHubSubscription> =>
        Effect.sync(() => {
          const broadcaster = ensure(sessionId)
          const { subscriberId, stream, latestEventId, replayGap } = broadcaster.subscribe(afterEventId)
          return { subscriberId, stream, latestEventId, replayGap }
        })

      const unsubscribe = (sessionId: string, subscriberId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const broadcaster = broadcasters.get(sessionId)
          if (!broadcaster) return
          broadcaster.unsubscribe(subscriberId)
          scheduleIdleCleanup(sessionId)
        })

      const broadcast = (sessionId: string, event: unknown): void => {
        ensure(sessionId).broadcast(event)
      }

      const markConnected = (sessionId: string): void => {
        connectedSessions.add(sessionId)
        cancelIdleCleanup(sessionId)
      }

      const markDisconnected = (sessionId: string): void => {
        connectedSessions.delete(sessionId)
        scheduleIdleCleanup(sessionId)
      }

      const stats = (): EventHubStats => {
        let subscribers = 0
        let replayBytes = 0
        let replayEvents = 0
        const bySession: Array<EventHubSessionStats> = []

        for (const [sessionId, broadcaster] of broadcasters.entries()) {
          const connected = connectedSessions.has(sessionId)
          const sessionSubscribers = broadcaster.subscriberCount
          const sessionReplayBytes = broadcaster.replayBytes
          const sessionReplayEvents = broadcaster.replaySize

          subscribers += sessionSubscribers
          replayBytes += sessionReplayBytes
          replayEvents += sessionReplayEvents

          bySession.push({
            sessionId,
            connected,
            subscribers: sessionSubscribers,
            replayBytes: sessionReplayBytes,
            replayEvents: sessionReplayEvents,
            latestEventId: broadcaster.latestEventId,
            oldestEventId: broadcaster.oldestEventId,
          })
        }

        return {
          sessions: broadcasters.size,
          connectedSessions: connectedSessions.size,
          subscribers,
          replayBytes,
          replayEvents,
          bySession,
        }
      }

      return EventHub.of({
        ensure,
        remove,
        subscribe,
        unsubscribe,
        broadcast,
        markConnected,
        markDisconnected,
        stats,
      })
    }
  )
}
