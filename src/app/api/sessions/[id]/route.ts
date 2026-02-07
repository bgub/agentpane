import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { AcpClient } from "@/lib/acp-client"
import { Effect, Exit } from "effect"
import type { NextRequest } from "next/server"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient
      const session = yield* repo.get(id)
      const connected = yield* acp.isConnected(id)
      return { ...session, connected }
    })
  )
  return Exit.match(exit, {
    onFailure: (cause) => {
      const error = cause._tag === "Fail" && cause.error._tag === "SessionNotFoundError"
        ? { error: "Session not found" }
        : { error: "Internal error" }
      return Response.json(error, { status: 404 })
    },
    onSuccess: (session) => Response.json(session),
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const exit = await AppRuntime.runPromiseExit(
    Effect.flatMap(SessionRepo, (repo) => repo.rename(id, body.name))
  )
  return Exit.match(exit, {
    onFailure: () => Response.json({ error: "Session not found" }, { status: 404 }),
    onSuccess: (session) => Response.json(session),
  })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const acp = yield* AcpClient
      yield* acp.disconnect(id)
      const repo = yield* SessionRepo
      yield* repo.remove(id)
    })
  )
  return new Response(null, { status: 204 })
}
