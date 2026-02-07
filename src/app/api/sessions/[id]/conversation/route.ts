import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { Effect } from "effect"
import type { NextRequest } from "next/server"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const conversation = await AppRuntime.runPromise(
    Effect.flatMap(SessionRepo, (repo) => repo.getConversation(id))
  )
  return Response.json(conversation)
}
