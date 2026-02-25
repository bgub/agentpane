export interface TurnTokenUsage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  tokenSource: string | null
}

export type WriteOp =
  | {
    readonly _tag: "CreateTurn"
    readonly sessionId: string
    readonly turnId: string
    readonly role: "user" | "assistant"
    readonly createdAt: number
  }
  | {
    readonly _tag: "AddMessageBlock"
    readonly sessionId: string
    readonly turnId: string
    readonly kind: string
    readonly content: string
    readonly id?: string
    readonly createdAt?: number
  }
  | {
    readonly _tag: "CompleteTurn"
    readonly sessionId: string
    readonly turnId: string
    readonly stopReason: string
    readonly tokenUsage?: TurnTokenUsage
  }
  | {
    readonly _tag: "RenameSession"
    readonly sessionId: string
    readonly name: string
  }
  | {
    readonly _tag: "UpdateAgentSessionId"
    readonly sessionId: string
    readonly agentSessionId: string | null
  }

export interface QueuedWriteOp {
  readonly queueId: string
  readonly op: WriteOp
}
