import { Context, Effect, Layer, Runtime } from "effect"
import { AcpConnectionError } from "./schema.js"
import { SessionRepo } from "./session-repo.js"
import type { WriteOp, QueuedWriteOp } from "./write-ops.js"

interface SessionQueueState {
  readonly ops: Array<QueuedWriteOp>
  bytes: number
  flushing: boolean
}

export interface WriteQueueStats {
  readonly sessions: number
  readonly queuedOps: number
  readonly queuedBytes: number
  readonly bySession: ReadonlyArray<{
    sessionId: string
    queuedOps: number
    queuedBytes: number
    flushing: boolean
  }>
}

const FLUSH_DELAY_MS = 50
const MAX_SESSION_OPS = 5000
const MAX_SESSION_BYTES = 2 * 1024 * 1024

export class WriteQueue extends Context.Tag("@agentpane/WriteQueue")<
  WriteQueue,
  {
    readonly enqueue: (op: WriteOp) => Effect.Effect<void, AcpConnectionError>
    readonly enqueueMany: (ops: ReadonlyArray<WriteOp>) => Effect.Effect<void, AcpConnectionError>
    readonly flushSession: (sessionId: string) => Effect.Effect<void>
    readonly flushAll: (timeoutMs?: number) => Effect.Effect<void>
    readonly pendingSize: (sessionId: string) => number
    readonly stats: () => WriteQueueStats
  }
>() {
  static readonly layer = Layer.effect(
    WriteQueue,
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const runtime = yield* Effect.runtime<never>()
      const runPromise = Runtime.runPromise(runtime)

      const queues = new Map<string, SessionQueueState>()
      const timers = new Map<string, ReturnType<typeof setTimeout>>()

      const opBytes = (op: WriteOp): number => {
        if (op._tag === "AddMessageBlock") {
          return Buffer.byteLength(op.content, "utf-8") + Buffer.byteLength(op.kind, "utf-8") + 128
        }
        return 128
      }

      const getQueue = (sessionId: string): SessionQueueState => {
        const existing = queues.get(sessionId)
        if (existing) return existing
        const created: SessionQueueState = { ops: [], bytes: 0, flushing: false }
        queues.set(sessionId, created)
        return created
      }

      const scheduleFlush = (sessionId: string): void => {
        if (timers.has(sessionId)) return
        const timer = setTimeout(() => {
          timers.delete(sessionId)
          runPromise(flushSession(sessionId)).catch(() => {})
        }, FLUSH_DELAY_MS)
        timers.set(sessionId, timer)
      }

      const clearTimer = (sessionId: string): void => {
        const timer = timers.get(sessionId)
        if (!timer) return
        clearTimeout(timer)
        timers.delete(sessionId)
      }

      const flushSession = Effect.fn("WriteQueue.flushSession")(function* (sessionId: string) {
        clearTimer(sessionId)
        const queue = queues.get(sessionId)
        if (!queue || queue.flushing || queue.ops.length === 0) return

        queue.flushing = true
        const batch = queue.ops.splice(0, queue.ops.length)
        let batchBytes = 0
        for (const queued of batch) batchBytes += opBytes(queued.op)
        queue.bytes = Math.max(0, queue.bytes - batchBytes)

        const result = yield* repo.persistQueuedOps(batch).pipe(Effect.exit)
        queue.flushing = false

        if (result._tag === "Failure") {
          queue.ops.unshift(...batch)
          queue.bytes += batchBytes
          yield* Effect.logWarning(
            `WriteQueue flush failed for session ${sessionId}; retrying shortly`
          )
          const timer = setTimeout(() => {
            timers.delete(sessionId)
            runPromise(flushSession(sessionId)).catch(() => {})
          }, 250)
          timers.set(sessionId, timer)
          return
        }

        if (queue.ops.length === 0) {
          queues.delete(sessionId)
        } else {
          scheduleFlush(sessionId)
        }
      })

      const enqueue = Effect.fn("WriteQueue.enqueue")(function* (op: WriteOp) {
        const queue = getQueue(op.sessionId)
        const nextBytes = queue.bytes + opBytes(op)
        if (queue.ops.length + 1 > MAX_SESSION_OPS || nextBytes > MAX_SESSION_BYTES) {
          return yield* new AcpConnectionError({
            message: "Session write queue is full; please retry",
          })
        }

        const queued = yield* repo.enqueueWriteOp(op).pipe(
          Effect.mapError((err) =>
            new AcpConnectionError({
              message: `Failed to enqueue write operation: ${String(err)}`,
            })
          )
        )

        queue.ops.push(queued)
        queue.bytes = nextBytes
        scheduleFlush(op.sessionId)
      })

      const enqueueMany = Effect.fn("WriteQueue.enqueueMany")(function* (ops: ReadonlyArray<WriteOp>) {
        for (const op of ops) {
          yield* enqueue(op)
        }
      })

      const flushAll = Effect.fn("WriteQueue.flushAll")(function* (timeoutMs = 2000) {
        const sessionIds = [...queues.keys()]
        for (const sessionId of sessionIds) {
          yield* flushSession(sessionId).pipe(Effect.timeout(`${timeoutMs} millis`), Effect.ignore)
        }
      })

      const pendingSize = (sessionId: string): number => queues.get(sessionId)?.ops.length ?? 0

      const recoverPendingWrites = Effect.fn("WriteQueue.recoverPendingWrites")(function* () {
        const queuedOps = yield* repo.loadQueuedWriteOps().pipe(
          Effect.mapError((err) =>
            new AcpConnectionError({
              message: `Failed to load queued write operations: ${String(err)}`,
            })
          )
        )

        for (const queued of queuedOps) {
          const queue = getQueue(queued.op.sessionId)
          queue.ops.push(queued)
          queue.bytes += opBytes(queued.op)
        }

        for (const sessionId of queues.keys()) {
          scheduleFlush(sessionId)
        }
      })

      const stats = (): WriteQueueStats => {
        let queuedOps = 0
        let queuedBytes = 0
        const bySession: Array<{
          sessionId: string
          queuedOps: number
          queuedBytes: number
          flushing: boolean
        }> = []

        for (const [sessionId, queue] of queues.entries()) {
          queuedOps += queue.ops.length
          queuedBytes += queue.bytes
          bySession.push({
            sessionId,
            queuedOps: queue.ops.length,
            queuedBytes: queue.bytes,
            flushing: queue.flushing,
          })
        }
        return {
          sessions: queues.size,
          queuedOps,
          queuedBytes,
          bySession,
        }
      }

      yield* recoverPendingWrites()

      return WriteQueue.of({
        enqueue,
        enqueueMany,
        flushSession,
        flushAll,
        pendingSize,
        stats,
      })
    })
  )
}
