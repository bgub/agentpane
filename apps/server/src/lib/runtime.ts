import { Layer, ManagedRuntime } from "effect"
import { SqliteLive } from "./db.js"
import { SessionRepo } from "./session-repo.js"
import { AcpClient } from "./acp-client.js"

const AppLayer = AcpClient.layer.pipe(
  Layer.provideMerge(SessionRepo.layer),
  Layer.provideMerge(SqliteLive)
)

export const AppRuntime = ManagedRuntime.make(AppLayer)
