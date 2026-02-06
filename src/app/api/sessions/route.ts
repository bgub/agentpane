import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { Effect } from "effect"

export async function GET() {
  const sessions = await AppRuntime.runPromise(
    Effect.flatMap(SessionRepo, (repo) => repo.list())
  )
  return Response.json(sessions)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const session = await AppRuntime.runPromise(
    Effect.flatMap(SessionRepo, (repo) => repo.create(body.name))
  )
  return Response.json(session, { status: 201 })
}
