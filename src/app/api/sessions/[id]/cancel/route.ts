import { AppRuntime } from "@/lib/runtime"
import { AcpClient } from "@/lib/acp-client"
import { Effect } from "effect"
import type { NextRequest } from "next/server"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await AppRuntime.runPromise(
    Effect.flatMap(AcpClient, (acp) => acp.cancel(id))
  )
  return new Response(null, { status: 204 })
}
