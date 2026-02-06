import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import * as Effect from "effect/Effect"
import { NextRequest } from "next/server"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const session = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const repo = yield* SessionRepo
        return yield* repo.get(id)
      })
    )
    return Response.json(session)
  } catch {
    return Response.json({ error: "Session not found" }, { status: 404 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  try {
    const session = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const repo = yield* SessionRepo
        return yield* repo.rename(id, body.name)
      })
    )
    return Response.json(session)
  } catch {
    return Response.json({ error: "Session not found" }, { status: 404 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      return yield* repo.remove(id)
    })
  )
  return new Response(null, { status: 204 })
}
