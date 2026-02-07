import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { AcpClient } from "@/lib/acp-client"
import { Effect, Exit } from "effect"
import type { NextRequest } from "next/server"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { content } = body

  if (!content || typeof content !== "string") {
    return Response.json({ error: "content is required" }, { status: 400 })
  }

  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient

      // Auto-connect if agent isn't running
      const connected = yield* acp.isConnected(id)
      if (!connected) {
        const session = yield* repo.get(id)
        yield* acp.connect(id, session.cwd, session.agent_type)
      }

      // Create user turn with message block in DB
      const userTurn = yield* repo.addTurn(id, "user")
      yield* repo.addMessageBlock(userTurn.id, "text", content)
      yield* repo.completeTurn(userTurn.id, "end_turn")

      // Create assistant turn (will be completed when prompt finishes)
      const assistantTurn = yield* repo.addTurn(id, "assistant")

      // Start streaming prompt
      const sseStream = yield* acp.prompt(id, content)

      return { sseStream, assistantTurnId: assistantTurn.id }
    })
  )

  return Exit.match(exit, {
    onFailure: (cause) => {
      if (cause._tag === "Fail") {
        if (cause.error._tag === "SessionNotFoundError") {
          return Response.json({ error: "Session not found" }, { status: 404 })
        }
        if (cause.error._tag === "AcpConnectionError") {
          return Response.json({ error: cause.error.message }, { status: 502 })
        }
      }
      return Response.json({ error: "Internal error" }, { status: 500 })
    },
    onSuccess: ({ sseStream, assistantTurnId }) => {
      // Wrap the SSE stream to also persist message blocks to DB
      const encoder = new TextEncoder()
      let accumulatedText = ""

      const wrappedStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const reader = sseStream.getReader()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              controller.enqueue(encoder.encode(value))

              // Parse the SSE data to accumulate text for DB persistence
              const lines = value.split("\n")
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue
                try {
                  const data = JSON.parse(line.slice(6))
                  if (
                    data.sessionUpdate === "agent_message_chunk" &&
                    data.content?.type === "text"
                  ) {
                    accumulatedText += data.content.text
                  } else if (data.sessionUpdate === "done") {
                    // Persist accumulated text and complete turn
                    await AppRuntime.runPromise(
                      Effect.gen(function* () {
                        const repo = yield* SessionRepo
                        if (accumulatedText) {
                          yield* repo.addMessageBlock(assistantTurnId, "text", accumulatedText)
                        }
                        yield* repo.completeTurn(assistantTurnId, data.stopReason || "end_turn")
                      })
                    )
                  } else if (
                    data.sessionUpdate === "tool_call" ||
                    data.sessionUpdate === "tool_call_update"
                  ) {
                    // Persist tool calls as message blocks
                    await AppRuntime.runPromise(
                      Effect.flatMap(SessionRepo, (repo) =>
                        repo.addMessageBlock(
                          assistantTurnId,
                          data.sessionUpdate,
                          JSON.stringify(data)
                        )
                      )
                    )
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          } catch {
            // Stream ended or errored
          } finally {
            controller.close()
          }
        },
      })

      return new Response(wrappedStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      })
    },
  })
}
