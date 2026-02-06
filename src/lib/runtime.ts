import { Layer, ManagedRuntime } from "effect"
import { SqliteLive } from "./db"
import { SessionRepo } from "./session-repo"
import { CommandExecutor } from "./command-executor"

const AppLayer = CommandExecutor.layer.pipe(
  Layer.provideMerge(SessionRepo.layer),
  Layer.provideMerge(SqliteLive)
)

export const AppRuntime = ManagedRuntime.make(AppLayer)
