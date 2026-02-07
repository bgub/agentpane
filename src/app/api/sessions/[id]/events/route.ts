import { AppRuntime } from "@/lib/runtime"
import { AcpClient } from "@/lib/acp-client"
import { Effect, Exit } from "effect"
import type { NextRequest } from "next/server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // SSE standard: EventSource sends Last-Event-ID on auto-reconnect
  const lastEventIdHeader = request.headers.get("Last-Event-ID")
  const afterEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : undefined

  const exit = await AppRuntime.runPromiseExit(
    Effect.flatMap(AcpClient, (acp) => acp.subscribe(id, afterEventId))
  )

  return Exit.match(exit, {
    onFailure: (cause) => {
      if (cause._tag === "Fail" && cause.error._tag === "AcpConnectionError") {
        return Response.json({ error: cause.error.message }, { status: 502 })
      }
      return Response.json({ error: "Internal error" }, { status: 500 })
    },
    onSuccess: ({ subscriberId, stream, prompting, assistantTurnId, latestEventId }) => {
      const encoder = new TextEncoder()

      // Prepend a status event (id: 0 so it doesn't interfere with replay sequence)
      const outputStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const statusPayload = `id: 0\ndata: ${JSON.stringify({
            sessionUpdate: "status",
            prompting,
            assistantTurnId,
            latestEventId,
          })}\n\n`
          controller.enqueue(encoder.encode(statusPayload))

          // Pipe broadcaster events (includes replayed events from ring buffer)
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
