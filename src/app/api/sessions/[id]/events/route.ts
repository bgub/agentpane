import { AppRuntime } from "@/lib/runtime"
import { AcpClient } from "@/lib/acp-client"
import { Effect, Exit } from "effect"
import type { NextRequest } from "next/server"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const exit = await AppRuntime.runPromiseExit(
    Effect.flatMap(AcpClient, (acp) => acp.subscribe(id))
  )

  return Exit.match(exit, {
    onFailure: (cause) => {
      if (cause._tag === "Fail" && cause.error._tag === "AcpConnectionError") {
        return Response.json({ error: cause.error.message }, { status: 502 })
      }
      return Response.json({ error: "Internal error" }, { status: 500 })
    },
    onSuccess: ({ subscriberId, stream, prompting, assistantTurnId, accumulatedText }) => {
      const encoder = new TextEncoder()

      // Prepend a status event, then pipe broadcaster stream
      const outputStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          // Send initial status event for mid-stream catch-up
          const statusPayload = `data: ${JSON.stringify({
            sessionUpdate: "status",
            prompting,
            assistantTurnId,
            accumulatedText,
          })}\n\n`
          controller.enqueue(encoder.encode(statusPayload))

          // Pipe broadcaster events
          const reader = stream.getReader()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              controller.enqueue(encoder.encode(value))
            }
          } catch {
            // Stream ended
          } finally {
            controller.close()
          }
        },
        cancel() {
          // Unsubscribe when client disconnects
          AppRuntime.runPromise(
            Effect.flatMap(AcpClient, (acp) => acp.unsubscribe(id, subscriberId))
          ).catch(() => {})
        },
      })

      return new Response(outputStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      })
    },
  })
}
