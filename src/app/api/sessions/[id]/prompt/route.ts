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

      return yield* acp.prompt(id, content)
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
    onSuccess: (result) => Response.json(result),
  })
}
