import { AppRuntime } from "@/lib/runtime"
import { AcpClient } from "@/lib/acp-client"
import { Effect } from "effect"

export async function GET() {
  const { connected, prompting } = await AppRuntime.runPromise(
    Effect.map(AcpClient, (acp) => ({
      connected: [...acp.connectedSessionIds()],
      prompting: [...acp.promptingSessionIds()],
    }))
  )

  return Response.json({ connected, prompting })
}
