import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import * as Effect from "effect/Effect"
import { NextRequest } from "next/server"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const entries = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      return yield* repo.getEntries(id)
    })
  )
  return Response.json(entries)
}
