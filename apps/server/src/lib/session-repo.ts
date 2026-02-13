import { SqlClient } from "@effect/sql/SqlClient"
import type { SqlError } from "@effect/sql/SqlError"
import { Context, Effect, Layer } from "effect"
import * as crypto from "node:crypto"
import { Session, Turn, MessageBlock, SessionNotFoundError } from "./schema.js"
import type { TurnTokenUsage, WriteOp, QueuedWriteOp } from "./write-ops.js"

interface SessionTokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  provider_turns: number
  estimated_turns: number
  tokenized_turns: number
}

export class SessionRepo extends Context.Tag("@agentpane/SessionRepo")<
  SessionRepo,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Session>, SqlError>
    readonly get: (id: string) => Effect.Effect<Session, SqlError | SessionNotFoundError>
    readonly create: (name?: string, agentType?: string) => Effect.Effect<Session, SqlError>
    readonly remove: (id: string) => Effect.Effect<void, SqlError>
    readonly rename: (id: string, name: string) => Effect.Effect<Session, SqlError | SessionNotFoundError>
    readonly updateCwd: (id: string, cwd: string) => Effect.Effect<void, SqlError>
    readonly updateConfig: (
      id: string,
      agentType: string,
      cwd: string
    ) => Effect.Effect<Session, SqlError | SessionNotFoundError>
    readonly updateAgentSessionId: (
      id: string,
      agentSessionId: string | null
    ) => Effect.Effect<void, SqlError>
    readonly addTurn: (
      sessionId: string,
      role: "user" | "assistant"
    ) => Effect.Effect<Turn, SqlError>
    readonly completeTurn: (
      turnId: string,
      stopReason: string,
      tokenUsage?: TurnTokenUsage
    ) => Effect.Effect<void, SqlError>
    readonly addMessageBlock: (
      turnId: string,
      kind: string,
      content: string
    ) => Effect.Effect<MessageBlock, SqlError>
    readonly getConversation: (
      sessionId: string
    ) => Effect.Effect<
      ReadonlyArray<Turn & { blocks: ReadonlyArray<MessageBlock> }>,
      SqlError
    >
    readonly getSetting: (key: string) => Effect.Effect<string | null, SqlError>
    readonly setSetting: (key: string, value: string) => Effect.Effect<void, SqlError>
    readonly getSessionTokenUsage: (sessionId: string) => Effect.Effect<SessionTokenUsage, SqlError>
    readonly persistOps: (ops: ReadonlyArray<WriteOp>) => Effect.Effect<void, SqlError>
    readonly enqueueWriteOp: (op: WriteOp) => Effect.Effect<QueuedWriteOp, SqlError>
    readonly loadQueuedWriteOps: () => Effect.Effect<ReadonlyArray<QueuedWriteOp>, SqlError>
    readonly persistQueuedOps: (ops: ReadonlyArray<QueuedWriteOp>) => Effect.Effect<void, SqlError>
  }
>() {
  static readonly layer = Layer.effect(
    SessionRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient

      const list = Effect.fn("SessionRepo.list")(function* () {
        return yield* sql<Session>`SELECT id, name, cwd, agent_type, agent_session_id, created_at FROM sessions ORDER BY created_at`
      })

      const get = Effect.fn("SessionRepo.get")(function* (id: string) {
        const rows = yield* sql<Session>`SELECT id, name, cwd, agent_type, agent_session_id, created_at FROM sessions WHERE id = ${id}`
        if (rows.length === 0) {
          return yield* new SessionNotFoundError({ id })
        }
        return rows[0]
      })

      const create = Effect.fn("SessionRepo.create")(function* (name?: string, agentType?: string) {
        const id = crypto.randomUUID()
        const now = Date.now()
        const counts = yield* sql<{ cnt: number }>`SELECT COUNT(*) as cnt FROM sessions`
        const sessionName = name || `Session ${(counts[0]?.cnt ?? 0) + 1}`
        const home = process.env.HOME || "~"
        const provider = agentType || ""
        const rows = yield* sql<Session>`
          INSERT INTO sessions (id, name, cwd, agent_type, agent_session_id, created_at)
          VALUES (${id}, ${sessionName}, ${home}, ${provider}, ${null}, ${now})
          RETURNING id, name, cwd, agent_type, agent_session_id, created_at
        `
        return rows[0]
      })

      const remove = Effect.fn("SessionRepo.remove")(function* (id: string) {
        yield* sql`DELETE FROM sessions WHERE id = ${id}`
      })

      const rename = Effect.fn("SessionRepo.rename")(function* (id: string, name: string) {
        const rows = yield* sql<Session>`
          UPDATE sessions SET name = ${name} WHERE id = ${id}
          RETURNING id, name, cwd, agent_type, agent_session_id, created_at
        `
        if (rows.length === 0) {
          return yield* new SessionNotFoundError({ id })
        }
        return rows[0]
      })

      const updateCwd = Effect.fn("SessionRepo.updateCwd")(function* (id: string, cwd: string) {
        yield* sql`UPDATE sessions SET cwd = ${cwd} WHERE id = ${id}`
      })

      const updateConfig = Effect.fn("SessionRepo.updateConfig")(
        function* (id: string, agentType: string, cwd: string) {
          const rows = yield* sql<Session>`
            UPDATE sessions SET agent_type = ${agentType}, cwd = ${cwd} WHERE id = ${id}
            RETURNING id, name, cwd, agent_type, agent_session_id, created_at
          `
          if (rows.length === 0) {
            return yield* new SessionNotFoundError({ id })
          }
          return rows[0]
        }
      )

      const updateAgentSessionId = Effect.fn("SessionRepo.updateAgentSessionId")(
        function* (id: string, agentSessionId: string | null) {
          yield* sql`UPDATE sessions SET agent_session_id = ${agentSessionId} WHERE id = ${id}`
        }
      )

      const addTurn = Effect.fn("SessionRepo.addTurn")(
        function* (sessionId: string, role: "user" | "assistant") {
          const id = crypto.randomUUID()
          const now = Date.now()
          const rows = yield* sql<Turn>`
            INSERT INTO turns (id, session_id, role, stop_reason, created_at)
            VALUES (${id}, ${sessionId}, ${role}, ${null}, ${now})
            RETURNING id, session_id, role, stop_reason, prompt_tokens, completion_tokens, total_tokens, token_source, created_at
          `
          return rows[0]
        }
      )

      const completeTurn = Effect.fn("SessionRepo.completeTurn")(
        function* (turnId: string, stopReason: string, tokenUsage?: TurnTokenUsage) {
          yield* sql`
            UPDATE turns
            SET
              stop_reason = ${stopReason},
              prompt_tokens = ${tokenUsage?.promptTokens ?? null},
              completion_tokens = ${tokenUsage?.completionTokens ?? null},
              total_tokens = ${tokenUsage?.totalTokens ?? null},
              token_source = ${tokenUsage?.tokenSource ?? null}
            WHERE id = ${turnId}
          `
        }
      )

      const addMessageBlock = Effect.fn("SessionRepo.addMessageBlock")(
        function* (turnId: string, kind: string, content: string) {
          const id = crypto.randomUUID()
          const now = Date.now()
          const rows = yield* sql<MessageBlock>`
            INSERT INTO message_blocks (id, turn_id, kind, content, created_at)
            VALUES (${id}, ${turnId}, ${kind}, ${content}, ${now})
            RETURNING id, turn_id, kind, content, created_at
          `
          return rows[0]
        }
      )

      const getConversation = Effect.fn("SessionRepo.getConversation")(
        function* (sessionId: string) {
          const turns = yield* sql<Turn>`
            SELECT id, session_id, role, stop_reason, prompt_tokens, completion_tokens, total_tokens, token_source, created_at
            FROM turns
            WHERE session_id = ${sessionId}
            ORDER BY created_at, id
          `
          const blocks = yield* sql<MessageBlock>`
            SELECT mb.id, mb.turn_id, mb.kind, mb.content, mb.created_at
            FROM message_blocks mb
            JOIN turns t ON t.id = mb.turn_id
            WHERE t.session_id = ${sessionId}
            ORDER BY mb.created_at, mb.id
          `

          const blocksByTurn = new Map<string, MessageBlock[]>()
          for (const block of blocks) {
            const arr = blocksByTurn.get(block.turn_id) ?? []
            arr.push(block)
            blocksByTurn.set(block.turn_id, arr)
          }

          return turns.map((turn) => ({
            ...turn,
            blocks: blocksByTurn.get(turn.id) ?? [],
          }))
        }
      )

      const getSetting = Effect.fn("SessionRepo.getSetting")(function* (key: string) {
        const rows = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${key}`
        return rows.length > 0 ? rows[0].value : null
      })

      const setSetting = Effect.fn("SessionRepo.setSetting")(function* (key: string, value: string) {
        yield* sql`INSERT OR REPLACE INTO settings (key, value) VALUES (${key}, ${value})`
      })

      const getSessionTokenUsage = Effect.fn("SessionRepo.getSessionTokenUsage")(function* (sessionId: string) {
        const rows = yield* sql<SessionTokenUsage>`
          SELECT
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(CASE WHEN token_source = 'provider' THEN 1 ELSE 0 END), 0) AS provider_turns,
            COALESCE(SUM(CASE WHEN token_source = 'estimated' THEN 1 ELSE 0 END), 0) AS estimated_turns,
            COALESCE(SUM(CASE WHEN total_tokens IS NOT NULL THEN 1 ELSE 0 END), 0) AS tokenized_turns
          FROM turns
          WHERE session_id = ${sessionId}
        `
        return rows[0] ?? {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          provider_turns: 0,
          estimated_turns: 0,
          tokenized_turns: 0,
        }
      })

      const persistOps = Effect.fn("SessionRepo.persistOps")(function* (ops: ReadonlyArray<WriteOp>) {
        if (ops.length === 0) return

        const applyOp = (op: WriteOp): Effect.Effect<void, SqlError> =>
          Effect.gen(function* () {
            if (op._tag === "AddMessageBlock") {
              const id = op.id ?? crypto.randomUUID()
              const now = op.createdAt ?? Date.now()
              yield* sql`
                INSERT INTO message_blocks (id, turn_id, kind, content, created_at)
                VALUES (${id}, ${op.turnId}, ${op.kind}, ${op.content}, ${now})
              `
              return
            }

            if (op._tag === "CompleteTurn") {
              yield* sql`
                UPDATE turns
                SET
                  stop_reason = ${op.stopReason},
                  prompt_tokens = ${op.tokenUsage?.promptTokens ?? null},
                  completion_tokens = ${op.tokenUsage?.completionTokens ?? null},
                  total_tokens = ${op.tokenUsage?.totalTokens ?? null},
                  token_source = ${op.tokenUsage?.tokenSource ?? null}
                WHERE id = ${op.turnId}
              `
              return
            }

            yield* sql`
              UPDATE sessions
              SET agent_session_id = ${op.agentSessionId}
              WHERE id = ${op.sessionId}
            `
          })

        yield* sql`BEGIN IMMEDIATE TRANSACTION`
        const exit = yield* Effect.forEach(ops, applyOp, { discard: true }).pipe(Effect.exit)

        if (exit._tag === "Success") {
          yield* sql`COMMIT`
          return
        }

        yield* sql`ROLLBACK`.pipe(Effect.catchAll(() => Effect.void))
        return yield* Effect.failCause(exit.cause)
      })

      const enqueueWriteOp = Effect.fn("SessionRepo.enqueueWriteOp")(function* (op: WriteOp) {
        const queueId = crypto.randomUUID()
        const now = Date.now()
        yield* sql`
          INSERT INTO write_queue_ops (id, session_id, op_json, created_at)
          VALUES (${queueId}, ${op.sessionId}, ${JSON.stringify(op)}, ${now})
        `
        return { queueId, op }
      })

      const loadQueuedWriteOps = Effect.fn("SessionRepo.loadQueuedWriteOps")(function* () {
        const rows = yield* sql<{ id: string; op_json: string }>`
          SELECT id, op_json
          FROM write_queue_ops
          ORDER BY created_at, id
        `

        const parsed: Array<QueuedWriteOp> = []
        for (const row of rows) {
          try {
            parsed.push({ queueId: row.id, op: JSON.parse(row.op_json) as WriteOp })
          } catch {
            yield* sql`DELETE FROM write_queue_ops WHERE id = ${row.id}`
          }
        }
        return parsed
      })

      const persistQueuedOps = Effect.fn("SessionRepo.persistQueuedOps")(
        function* (ops: ReadonlyArray<QueuedWriteOp>) {
          if (ops.length === 0) return

          const applyOp = (op: WriteOp): Effect.Effect<void, SqlError> =>
            Effect.gen(function* () {
              if (op._tag === "AddMessageBlock") {
                const id = op.id ?? crypto.randomUUID()
                const now = op.createdAt ?? Date.now()
                yield* sql`
                  INSERT INTO message_blocks (id, turn_id, kind, content, created_at)
                  VALUES (${id}, ${op.turnId}, ${op.kind}, ${op.content}, ${now})
                `
                return
              }

              if (op._tag === "CompleteTurn") {
                yield* sql`
                  UPDATE turns
                  SET
                    stop_reason = ${op.stopReason},
                    prompt_tokens = ${op.tokenUsage?.promptTokens ?? null},
                    completion_tokens = ${op.tokenUsage?.completionTokens ?? null},
                    total_tokens = ${op.tokenUsage?.totalTokens ?? null},
                    token_source = ${op.tokenUsage?.tokenSource ?? null}
                  WHERE id = ${op.turnId}
                `
                return
              }

              yield* sql`
                UPDATE sessions
                SET agent_session_id = ${op.agentSessionId}
                WHERE id = ${op.sessionId}
              `
            })

          yield* sql`BEGIN IMMEDIATE TRANSACTION`
          const exit = yield* Effect.forEach(ops, (queued) => applyOp(queued.op), { discard: true }).pipe(Effect.exit)

          if (exit._tag === "Success") {
            for (const queued of ops) {
              yield* sql`DELETE FROM write_queue_ops WHERE id = ${queued.queueId}`
            }
            yield* sql`COMMIT`
            return
          }

          yield* sql`ROLLBACK`.pipe(Effect.catchAll(() => Effect.void))
          return yield* Effect.failCause(exit.cause)
        }
      )

      return SessionRepo.of({
        list,
        get,
        create,
        remove,
        rename,
        updateCwd,
        updateConfig,
        updateAgentSessionId,
        addTurn,
        completeTurn,
        addMessageBlock,
        getConversation,
        getSetting,
        setSetting,
        getSessionTokenUsage,
        persistOps,
        enqueueWriteOp,
        loadQueuedWriteOps,
        persistQueuedOps,
      })
    })
  )
}
