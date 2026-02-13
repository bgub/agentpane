import { Context, Effect, Layer, Runtime } from "effect"
import { ConnectionManager } from "./connection-manager.js"
import { EventHub } from "./event-hub.js"
import { SessionRepo } from "./session-repo.js"
import { AcpConnectionError } from "./schema.js"
import { estimateTokenCount, formatHistory } from "./acp-types.js"
import { WriteQueue } from "./write-queue.js"

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
      const repo = yield* SessionRepo
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

          const priorTurns = yield* repo.getConversation(sessionId).pipe(Effect.orDie)

          const userTurn = yield* repo.addTurn(sessionId, "user").pipe(Effect.orDie)
          yield* repo.addMessageBlock(userTurn.id, "text", content).pipe(Effect.orDie)
          const userTokens = estimateTokenCount(content)
          yield* repo.completeTurn(userTurn.id, "end_turn", {
            promptTokens: userTokens,
            completionTokens: 0,
            totalTokens: userTokens,
            tokenSource: "estimated",
          }).pipe(Effect.orDie)

          const assistantTurn = yield* repo.addTurn(sessionId, "assistant").pipe(Effect.orDie)
          const fullPrompt = formatHistory(priorTurns) + content

          conn.prompting = true
          conn.currentAssistantTurnId = assistantTurn.id
          conn.accumulatedText = ""
          yield* connections.setPromptState(sessionId, true, assistantTurn.id, conn.agentSessionId)

          eventHub.broadcast(sessionId, {
            sessionUpdate: "prompt_started",
            userTurnId: userTurn.id,
            assistantTurnId: assistantTurn.id,
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
              const ops = [] as Array<
                | {
                  _tag: "AddMessageBlock"
                  sessionId: string
                  turnId: string
                  kind: string
                  content: string
                }
                | {
                  _tag: "CompleteTurn"
                  sessionId: string
                  turnId: string
                  stopReason: string
                  tokenUsage: {
                    promptTokens: number
                    completionTokens: number
                    totalTokens: number
                    tokenSource: "provider" | "estimated"
                  }
                }
              >

              if (conn.accumulatedText) {
                ops.push({
                  _tag: "AddMessageBlock",
                  sessionId,
                  turnId: assistantTurn.id,
                  kind: "text",
                  content: conn.accumulatedText,
                })
              }

              ops.push({
                _tag: "CompleteTurn",
                sessionId,
                turnId: assistantTurn.id,
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
              prompt: [{ type: "text", text: fullPrompt }],
            })
            .then(async (response) => {
              const reason = response.stopReason || "end_turn"
              const usage = response.usage
              const promptTokens = usage?.inputTokens ?? estimateTokenCount(fullPrompt)
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
              const promptTokens = estimateTokenCount(fullPrompt)
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

          return { userTurnId: userTurn.id, assistantTurnId: assistantTurn.id }
        }
      )

      return PromptEngine.of({ prompt })
    })
  )
}
