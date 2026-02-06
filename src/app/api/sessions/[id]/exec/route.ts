import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { CommandExecutor } from "@/lib/command-executor"
import { Effect, Exit } from "effect"
import type { NextRequest } from "next/server"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { command } = await request.json()

  if (!command || typeof command !== "string") {
    return Response.json({ error: "command is required" }, { status: 400 })
  }

  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const session = yield* repo.get(id)
      const executor = yield* CommandExecutor
      return yield* executor.exec(id, command, session.cwd)
    })
  )

  return Exit.match(exit, {
    onFailure: () => Response.json({ error: "Session not found" }, { status: 404 }),
    onSuccess: (stream) =>
      new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
        },
      }),
  })
}
