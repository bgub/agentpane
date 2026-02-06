import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { Effect, Exit } from "effect"
import type { NextRequest } from "next/server"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const exit = await AppRuntime.runPromiseExit(
    Effect.flatMap(SessionRepo, (repo) => repo.get(id))
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
    Effect.flatMap(SessionRepo, (repo) => repo.remove(id))
  )
  return new Response(null, { status: 204 })
}
