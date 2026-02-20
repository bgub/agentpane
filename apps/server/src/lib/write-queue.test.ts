import { describe, expect, it } from "vitest"
import { Cause, Effect, Layer } from "effect"
import crypto from "node:crypto"
import { WriteQueue } from "./write-queue.js"
import { SessionRepo } from "./session-repo.js"
import type { QueuedWriteOp, WriteOp } from "./write-ops.js"

interface RepoHarness {
  readonly layer: Layer.Layer<SessionRepo>
  readonly appliedBatches: Array<Array<QueuedWriteOp>>
  readonly queuedRows: Array<QueuedWriteOp>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const makeRepoHarness = (seedQueued: Array<QueuedWriteOp> = []): RepoHarness => {
  const appliedBatches: Array<Array<QueuedWriteOp>> = []
  const queuedRows = [...seedQueued]

  const repo = SessionRepo.of({
    list: () => Effect.succeed([]),
    get: () => Effect.die("unused") as never,
    create: () => Effect.die("unused") as never,
    remove: () => Effect.void,
    rename: () => Effect.die("unused") as never,
    updateCwd: () => Effect.void,
    updateConfig: () => Effect.die("unused") as never,
    updateAgentSessionId: () => Effect.void,
    addTurn: () => Effect.die("unused") as never,
    completeTurn: () => Effect.void,
    addMessageBlock: () => Effect.die("unused") as never,
    getConversation: () => Effect.succeed([]),
    getSetting: () => Effect.succeed(null),
    setSetting: () => Effect.void,
    getSessionTokenUsage: () =>
      Effect.succeed({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        provider_turns: 0,
        estimated_turns: 0,
        tokenized_turns: 0,
      }),
    persistOps: () => Effect.void,
    enqueueWriteOp: (op: WriteOp) =>
      Effect.sync(() => {
        const row: QueuedWriteOp = {
          queueId: `q-${crypto.randomUUID()}`,
          op,
        }
        queuedRows.push(row)
        return row
      }),
    loadQueuedWriteOps: () => Effect.succeed([...queuedRows]),
    persistQueuedOps: (ops: ReadonlyArray<QueuedWriteOp>) =>
      Effect.sync(() => {
        appliedBatches.push([...ops])
        const ids = new Set(ops.map((op) => op.queueId))
        for (let i = queuedRows.length - 1; i >= 0; i--) {
          if (ids.has(queuedRows[i]!.queueId)) queuedRows.splice(i, 1)
        }
      }),
  })

  return {
    layer: Layer.succeed(SessionRepo, repo),
    appliedBatches,
    queuedRows,
  }
}

describe("WriteQueue", () => {
  it("returns AcpConnectionError on queue overflow", async () => {
    const harness = makeRepoHarness()
    const testLayer = WriteQueue.layer.pipe(Layer.provide(harness.layer))

    const program = Effect.gen(function* () {
      const queue = yield* WriteQueue
      const exit = yield* queue.enqueue({
        _tag: "AddMessageBlock",
        sessionId: "s1",
        turnId: "t1",
        kind: "terminal_output",
        content: "x".repeat(2 * 1024 * 1024 + 32),
      }).pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      if (exit._tag !== "Failure") return
      const failure = Cause.failureOption(exit.cause)
      expect(failure._tag).toBe("Some")
      if (failure._tag !== "Some") return
      expect((failure.value as { message?: string }).message).toContain("write queue is full")
    }).pipe(Effect.provide(testLayer))

    await Effect.runPromise(program)
  })

  it("recovers queued writes from durable storage on startup", async () => {
    const seed: Array<QueuedWriteOp> = [
      {
        queueId: "q-seed-1",
        op: {
          _tag: "AddMessageBlock",
          sessionId: "seed-session",
          turnId: "turn-1",
          kind: "text",
          content: "recover me",
        },
      },
    ]
    const harness = makeRepoHarness(seed)
    const testLayer = WriteQueue.layer.pipe(Layer.provide(harness.layer))

    await Effect.runPromise(Effect.gen(function* () {
      yield* WriteQueue
    }).pipe(Effect.provide(testLayer)))

    await sleep(120)

    expect(harness.appliedBatches.length).toBe(1)
    expect(harness.appliedBatches[0]?.[0]?.queueId).toBe("q-seed-1")
    expect(harness.queuedRows.length).toBe(0)
  })

  it("flushes a session only once when called concurrently", async () => {
    const harness = makeRepoHarness()
    const testLayer = WriteQueue.layer.pipe(Layer.provide(harness.layer))

    await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* WriteQueue
        yield* queue.enqueue({
          _tag: "AddMessageBlock",
          sessionId: "s-race",
          turnId: "t-race",
          kind: "text",
          content: "race",
        })

        yield* Effect.all([
          queue.flushSession("s-race"),
          queue.flushSession("s-race"),
        ], { discard: true })
      }).pipe(Effect.provide(testLayer))
    )

    expect(harness.appliedBatches.length).toBe(1)
    expect(harness.appliedBatches[0]?.length).toBe(1)
    expect(harness.queuedRows.length).toBe(0)
  })
})
