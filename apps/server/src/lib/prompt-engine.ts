import crypto from "node:crypto"
import { Context, Effect, Layer, Runtime } from "effect"
import { ConnectionManager } from "./connection-manager.js"
import { EventHub } from "./event-hub.js"
import { AcpConnectionError } from "./schema.js"
import { estimateTokenCount } from "./acp-types.js"
import { WriteQueue } from "./write-queue.js"
import type { WriteOp } from "./write-ops.js"

export class PromptEngine extends Context.Tag("@agentpane/PromptEngine")<
  PromptEngine,
  {
    readonly prompt: (
      sessionId: string,
      content: string
    ) => Effect.Effect<{ userTurnId: string; assistantTurnId: string }, AcpConnectionError>
  }
>() {
  static readonly layer = Layer.effect(
    PromptEngine,
    Effect.gen(function* () {
      const connections = yield* ConnectionManager
      const eventHub = yield* EventHub
      const writeQueue = yield* WriteQueue
      const runtime = yield* Effect.runtime<never>()
      const runPromise = Runtime.runPromise(runtime)

      const prompt = Effect.fn("PromptEngine.prompt")(
        function* (sessionId: string, content: string) {
          const conn = yield* connections.get(sessionId)

          if (conn.prompting) {
            return yield* new AcpConnectionError({
              message: "A prompt is already in progress for this session",
            })
          }

          const now = Date.now()
          const userTurnId = crypto.randomUUID()
          const assistantTurnId = crypto.randomUUID()
          const userTokens = estimateTokenCount(content)

          const initialOps: ReadonlyArray<WriteOp> = [
            {
              _tag: "CreateTurn",
              sessionId,
              turnId: userTurnId,
              role: "user",
              createdAt: now,
            },
            {
              _tag: "CreateTurn",
              sessionId,
              turnId: assistantTurnId,
              role: "assistant",
              createdAt: now + 1,
            },
            {
              _tag: "AddMessageBlock",
              sessionId,
              turnId: userTurnId,
              kind: "text",
              content,
            },
            {
              _tag: "CompleteTurn",
              sessionId,
              turnId: userTurnId,
              stopReason: "end_turn",
              tokenUsage: {
                promptTokens: userTokens,
                completionTokens: 0,
                totalTokens: userTokens,
                tokenSource: "estimated",
              },
            },
          ]

          yield* writeQueue.enqueueMany(initialOps)
          yield* writeQueue.flushSession(sessionId)

          conn.prompting = true
          conn.currentAssistantTurnId = assistantTurnId
          conn.accumulatedText = ""
          yield* connections.setPromptState(sessionId, true, assistantTurnId, conn.agentSessionId)

          eventHub.broadcast(sessionId, {
            sessionUpdate: "prompt_started",
            userTurnId,
            assistantTurnId,
          })

          const persistCompletion = (
            stopReason: string,
            tokenUsage: {
              promptTokens: number
              completionTokens: number
              totalTokens: number
              tokenSource: "provider" | "estimated"
            }
          ) =>
            Effect.gen(function* () {
              const ops: Array<WriteOp> = []

              if (conn.accumulatedText) {
                ops.push({
                  _tag: "AddMessageBlock",
                  sessionId,
                  turnId: assistantTurnId,
                  kind: "text",
                  content: conn.accumulatedText,
                })
              }

              ops.push({
                _tag: "CompleteTurn",
                sessionId,
                turnId: assistantTurnId,
                stopReason,
                tokenUsage,
              })

              yield* writeQueue.enqueueMany(ops)
              yield* writeQueue.flushSession(sessionId)
            }).pipe(
              Effect.tapError((err) =>
                Effect.logWarning(`Failed to persist completion for session ${sessionId}: ${err}`)
              ),
              Effect.ignore
            )

          conn.connection
            .prompt({
              sessionId: conn.agentSessionId,
              prompt: [{ type: "text", text: content }],
            })
            .then(async (response) => {
              const reason = response.stopReason || "end_turn"
              const usage = response.usage
              const promptTokens = usage?.inputTokens ?? estimateTokenCount(content)
              const completionTokens = usage?.outputTokens ?? estimateTokenCount(conn.accumulatedText)
              const totalTokens = usage?.totalTokens ?? promptTokens + completionTokens
              await runPromise(
                persistCompletion(reason, {
                  promptTokens,
                  completionTokens,
                  totalTokens,
                  tokenSource: usage ? "provider" : "estimated",
                })
              )
              eventHub.broadcast(sessionId, { sessionUpdate: "done", stopReason: reason })
            })
            .catch(async (err) => {
              const promptTokens = estimateTokenCount(content)
              const completionTokens = estimateTokenCount(conn.accumulatedText)
              await runPromise(
                persistCompletion("error", {
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens,
                  tokenSource: "estimated",
                })
              )
              eventHub.broadcast(sessionId, { sessionUpdate: "error", message: String(err) })
            })
            .finally(() => {
              conn.prompting = false
              conn.currentAssistantTurnId = null
              conn.accumulatedText = ""
              runPromise(connections.setPromptState(sessionId, false, null, conn.agentSessionId)).catch(() => {})
            })

          return { userTurnId, assistantTurnId }
        }
      )

      return PromptEngine.of({ prompt })
    })
  )
}
