import crypto from "node:crypto"
import { Context, Effect, Layer, Runtime } from "effect"
import { ConnectionManager } from "./connection-manager.js"
import { EventHub } from "./event-hub.js"
import { AcpConnectionError } from "./schema.js"
import { estimateTokenCount } from "./acp-types.js"
import { WriteQueue } from "./write-queue.js"
import type { WriteOp } from "./write-ops.js"

export interface PromptTextBlock {
  readonly type: "text"
  readonly text: string
}

export interface PromptResourceLinkBlock {
  readonly type: "resource_link"
  readonly uri: string
  readonly name: string
  readonly description?: string | null
  readonly mimeType?: string | null
  readonly title?: string | null
}

export interface PromptImageBlock {
  readonly type: "image"
  readonly data: string
  readonly mimeType: string
}

export type PromptInputBlock = PromptTextBlock | PromptResourceLinkBlock | PromptImageBlock

export class PromptEngine extends Context.Tag("@agentpane/PromptEngine")<
  PromptEngine,
  {
    readonly prompt: (
      sessionId: string,
      blocks: ReadonlyArray<PromptInputBlock>
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
        function* (sessionId: string, blocks: ReadonlyArray<PromptInputBlock>) {
          const conn = yield* connections.get(sessionId)

          if (conn.prompting) {
            return yield* new AcpConnectionError({
              message: "A prompt is already in progress for this session",
            })
          }

          if (blocks.length === 0) {
            return yield* new AcpConnectionError({
              message: "Prompt content is required",
            })
          }

          const now = Date.now()
          const userTurnId = crypto.randomUUID()
          const assistantTurnId = crypto.randomUUID()
          const textBlocks = blocks.filter((block): block is PromptTextBlock => block.type === "text")
          const promptText = textBlocks.map((block) => block.text).join("\n")
          const serializedPrompt = JSON.stringify(blocks)
          const userTokens = estimateTokenCount(promptText || serializedPrompt)

          const userBlockOps: Array<WriteOp> = blocks.map((block) => {
            if (block.type === "text") {
              return {
                _tag: "AddMessageBlock",
                sessionId,
                turnId: userTurnId,
                kind: "text",
                content: block.text,
              }
            }
            if (block.type === "image") {
              return {
                _tag: "AddMessageBlock",
                sessionId,
                turnId: userTurnId,
                kind: "image",
                content: JSON.stringify({ data: block.data, mimeType: block.mimeType }),
              }
            }
            return {
              _tag: "AddMessageBlock",
              sessionId,
              turnId: userTurnId,
              kind: "resource_link",
              content: JSON.stringify(block),
            }
          })

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
            ...userBlockOps,
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

              if (conn.accumulatedThought) {
                ops.push({
                  _tag: "AddMessageBlock",
                  sessionId,
                  turnId: assistantTurnId,
                  kind: "thought",
                  content: conn.accumulatedThought,
                })
              }

              if (conn.accumulatedText) {
                ops.push({
                  _tag: "AddMessageBlock",
                  sessionId,
                  turnId: assistantTurnId,
                  kind: "text",
                  content: conn.accumulatedText,
                })
              }

              if (conn.lastPlanContent) {
                ops.push({
                  _tag: "AddMessageBlock",
                  sessionId,
                  turnId: assistantTurnId,
                  kind: "plan",
                  content: conn.lastPlanContent,
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
              prompt: [...blocks],
            })
            .then(async (response) => {
              const reason = response.stopReason || "end_turn"
              const usage = response.usage
              const promptTokens = usage?.inputTokens ?? estimateTokenCount(promptText || serializedPrompt)
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
              const promptTokens = estimateTokenCount(promptText || serializedPrompt)
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
              conn.accumulatedThought = ""
              conn.lastPlanContent = null
              runPromise(connections.setPromptState(sessionId, false, null, conn.agentSessionId)).catch(() => {})
            })

          return { userTurnId, assistantTurnId }
        }
      )

      return PromptEngine.of({ prompt })
    })
  )
}
