import { SqlClient } from "@effect/sql/SqlClient"
import type { SqlError } from "@effect/sql/SqlError"
import { Context, Effect, Layer } from "effect"
import * as crypto from "node:crypto"
import { Session, Turn, MessageBlock, SessionNotFoundError } from "./schema.js"

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
      stopReason: string
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
            RETURNING id, session_id, role, stop_reason, created_at
          `
          return rows[0]
        }
      )

      const completeTurn = Effect.fn("SessionRepo.completeTurn")(
        function* (turnId: string, stopReason: string) {
          yield* sql`UPDATE turns SET stop_reason = ${stopReason} WHERE id = ${turnId}`
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
            SELECT id, session_id, role, stop_reason, created_at
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
      })
    })
  )
}
