import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { AcpClient } from "@/lib/acp-client"
import { Effect } from "effect"

export async function GET() {
  const result = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient
      const sessions = yield* repo.list()
      const connected = acp.connectedSessionIds()
      const prompting = acp.promptingSessionIds()
      return sessions.map((s) => ({
        ...s,
        connected: connected.has(s.id),
        prompting: prompting.has(s.id),
      }))
    })
  )
  return Response.json(result)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const result = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient
      const session = yield* repo.create(body.name, body.agent_type)
      // Auto-connect agent (ignore connection failures)
      yield* acp
        .connect(session.id, session.cwd, session.agent_type)
        .pipe(Effect.catchAll(() => Effect.void))
      const connected = yield* acp.isConnected(session.id)
      return { ...session, connected, prompting: false }
    })
  )
  return Response.json(result, { status: 201 })
}
