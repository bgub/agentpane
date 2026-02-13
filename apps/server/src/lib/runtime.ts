import { Layer, ManagedRuntime } from "effect"
import { SqliteLive } from "./db.js"
import { SessionRepo } from "./session-repo.js"
import { AcpClient } from "./acp-client.js"
import { WriteQueue } from "./write-queue.js"
import { EventHub } from "./event-hub.js"
import { ConnectionManager } from "./connection-manager.js"
import { PromptEngine } from "./prompt-engine.js"

const AppLayer = AcpClient.layer.pipe(
  Layer.provideMerge(PromptEngine.layer),
  Layer.provideMerge(ConnectionManager.layer),
  Layer.provideMerge(EventHub.layer),
  Layer.provideMerge(WriteQueue.layer),
  Layer.provideMerge(SessionRepo.layer),
  Layer.provideMerge(SqliteLive)
)

export const AppRuntime = ManagedRuntime.make(AppLayer)
