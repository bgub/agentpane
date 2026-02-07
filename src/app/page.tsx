import { Effect } from "effect"
import { AppRuntime } from "@/lib/runtime"
import { SessionRepo } from "@/lib/session-repo"
import { AcpClient } from "@/lib/acp-client"
import SessionLayout from "./components/session-layout"

export const dynamic = "force-dynamic"

export default async function Home() {
  const sessions = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient
      const list = yield* repo.list()
      const connected = acp.connectedSessionIds()
      const prompting = acp.promptingSessionIds()
      return list.map((s) => ({
        ...s,
        connected: connected.has(s.id),
        prompting: prompting.has(s.id),
      }))
    })
  )

  return <SessionLayout initialSessions={sessions} />
}
