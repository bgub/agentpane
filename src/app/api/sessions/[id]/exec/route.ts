import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { CommandExecutor } from "@/lib/command-executor"
import * as Effect from "effect/Effect"
import { NextRequest } from "next/server"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { command } = await request.json()

  if (!command || typeof command !== "string") {
    return Response.json({ error: "command is required" }, { status: 400 })
  }

  try {
    const stream = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const repo = yield* SessionRepo
        const session = yield* repo.get(id)
        const executor = yield* CommandExecutor
        return yield* executor.exec(id, command, session.cwd)
      })
    )

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      },
    })
  } catch {
    return Response.json({ error: "Session not found" }, { status: 404 })
  }
}
