import { Layer, ManagedRuntime } from "effect"
import { SqliteLive } from "./db"
import { SessionRepo } from "./session-repo"
import { AcpClient } from "./acp-client"

const AppLayer = AcpClient.layer.pipe(
  Layer.provideMerge(SessionRepo.layer),
  Layer.provideMerge(SqliteLive)
)

export const AppRuntime = ManagedRuntime.make(AppLayer)
