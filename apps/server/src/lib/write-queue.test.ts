import { describe, expect, it } from "bun:test"
import { Cause, Effect, Layer } from "effect"
import { WriteQueue } from "./write-queue.js"
import { SessionRepo } from "./session-repo.js"

const sessionRepoTestLayer = Layer.succeed(
  SessionRepo,
  SessionRepo.of({
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
  })
)

describe("WriteQueue", () => {
  it("returns AcpConnectionError on queue overflow", async () => {
    const testLayer = WriteQueue.layer.pipe(Layer.provide(sessionRepoTestLayer))

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
})
