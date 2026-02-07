import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { AcpClient } from "@/lib/acp-client"
import { Effect, Exit } from "effect"
import type { NextRequest } from "next/server"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient
      const session = yield* repo.get(id)
      return yield* acp.connect(id, session.cwd)
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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await AppRuntime.runPromise(
    Effect.flatMap(AcpClient, (acp) => acp.disconnect(id))
  )
  return new Response(null, { status: 204 })
}
