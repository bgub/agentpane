import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { CommandExecutor } from "@/lib/command-executor"
import { Effect } from "effect"

export async function GET() {
  const result = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const executor = yield* CommandExecutor
      const sessions = yield* repo.list()
      const running = executor.runningSessionIds()
      return sessions.map((s) => ({ ...s, running: running.has(s.id) }))
    })
  )
  return Response.json(result)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const session = await AppRuntime.runPromise(
    Effect.flatMap(SessionRepo, (repo) => repo.create(body.name))
  )
  return Response.json(session, { status: 201 })
}
