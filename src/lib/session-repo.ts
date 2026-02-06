import { SqlClient } from "@effect/sql/SqlClient"
import type { SqlError } from "@effect/sql/SqlError"
import { Context, Effect, Layer } from "effect"
import * as crypto from "node:crypto"
import { Session, Entry, SessionNotFoundError } from "./schema"

export class SessionRepo extends Context.Tag("@acapa/SessionRepo")<
  SessionRepo,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Session>, SqlError>
    readonly get: (id: string) => Effect.Effect<Session, SqlError | SessionNotFoundError>
    readonly create: (name?: string) => Effect.Effect<Session, SqlError>
    readonly remove: (id: string) => Effect.Effect<void, SqlError>
    readonly rename: (id: string, name: string) => Effect.Effect<Session, SqlError | SessionNotFoundError>
    readonly updateCwd: (id: string, cwd: string) => Effect.Effect<void, SqlError>
    readonly addEntry: (
      sessionId: string,
      type: string,
      content: string
    ) => Effect.Effect<Entry, SqlError>
    readonly getEntries: (sessionId: string) => Effect.Effect<ReadonlyArray<Entry>, SqlError>
  }
>() {
  static readonly layer = Layer.effect(
    SessionRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient

      const list = Effect.fn("SessionRepo.list")(function* () {
        return yield* sql<Session>`SELECT id, name, cwd, created_at FROM sessions ORDER BY created_at`
      })

      const get = Effect.fn("SessionRepo.get")(function* (id: string) {
        const rows = yield* sql<Session>`SELECT id, name, cwd, created_at FROM sessions WHERE id = ${id}`
        if (rows.length === 0) {
          return yield* new SessionNotFoundError({ id })
        }
        return rows[0]
      })

      const create = Effect.fn("SessionRepo.create")(function* (name?: string) {
        const id = crypto.randomUUID()
        const now = Date.now()
        const counts = yield* sql<{ cnt: number }>`SELECT COUNT(*) as cnt FROM sessions`
        const sessionName = name || `Session ${(counts[0]?.cnt ?? 0) + 1}`
        const home = process.env.HOME || "~"
        const rows = yield* sql<Session>`
          INSERT INTO sessions (id, name, cwd, created_at)
          VALUES (${id}, ${sessionName}, ${home}, ${now})
          RETURNING id, name, cwd, created_at
        `
        return rows[0]
      })

      const remove = Effect.fn("SessionRepo.remove")(function* (id: string) {
        yield* sql`DELETE FROM sessions WHERE id = ${id}`
      })

      const rename = Effect.fn("SessionRepo.rename")(function* (id: string, name: string) {
        const rows = yield* sql<Session>`
          UPDATE sessions SET name = ${name} WHERE id = ${id}
          RETURNING id, name, cwd, created_at
        `
        if (rows.length === 0) {
          return yield* new SessionNotFoundError({ id })
        }
        return rows[0]
      })

      const updateCwd = Effect.fn("SessionRepo.updateCwd")(function* (id: string, cwd: string) {
        yield* sql`UPDATE sessions SET cwd = ${cwd} WHERE id = ${id}`
      })

      const addEntry = Effect.fn("SessionRepo.addEntry")(
        function* (sessionId: string, type: string, content: string) {
          const now = Date.now()
          const rows = yield* sql<Entry>`
            INSERT INTO entries (session_id, type, content, created_at)
            VALUES (${sessionId}, ${type}, ${content}, ${now})
            RETURNING id, session_id, type, content, created_at
          `
          return rows[0]
        }
      )

      const getEntries = Effect.fn("SessionRepo.getEntries")(function* (sessionId: string) {
        const rows = yield* sql<Entry>`SELECT id, session_id, type, content, created_at FROM entries WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT 2000`
        return rows.slice().reverse()
      })

      return SessionRepo.of({
        list,
        get,
        create,
        remove,
        rename,
        updateCwd,
        addEntry,
        getEntries,
      })
    })
  )
}
