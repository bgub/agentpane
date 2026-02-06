import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import * as Effect from "effect/Effect"

export async function GET() {
  const sessions = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      return yield* repo.list()
    })
  )
  return Response.json(sessions)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const session = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      return yield* repo.create(body.name)
    })
  )
  return Response.json(session, { status: 201 })
}
