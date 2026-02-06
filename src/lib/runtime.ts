import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { SqliteLive } from "./db"
import { SessionRepoLive } from "./session-repo"
import { CommandExecutorLive } from "./command-executor"

const AppLayer = CommandExecutorLive.pipe(
  Layer.provideMerge(SessionRepoLive),
  Layer.provideMerge(SqliteLive)
)

export const AppRuntime = ManagedRuntime.make(AppLayer)
