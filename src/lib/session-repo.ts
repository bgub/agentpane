import { SqlClient } from "@effect/sql/SqlClient"
import { SqlError } from "@effect/sql/SqlError"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as crypto from "node:crypto"
import { Session, Entry } from "./schema"

type RepoError = SqlError | Error

export interface SessionRepo {
  readonly list: () => Effect.Effect<ReadonlyArray<Session>, RepoError>
  readonly get: (id: string) => Effect.Effect<Session, RepoError>
  readonly create: (name?: string) => Effect.Effect<Session, RepoError>
  readonly remove: (id: string) => Effect.Effect<void, RepoError>
  readonly rename: (id: string, name: string) => Effect.Effect<Session, RepoError>
  readonly updateCwd: (id: string, cwd: string) => Effect.Effect<void, RepoError>
  readonly addEntry: (
    sessionId: string,
    type: string,
    content: string
  ) => Effect.Effect<Entry, RepoError>
  readonly getEntries: (sessionId: string) => Effect.Effect<ReadonlyArray<Entry>, RepoError>
}

export const SessionRepo = Context.GenericTag<SessionRepo>("SessionRepo")

export const SessionRepoLive = Layer.effect(
  SessionRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient

    return SessionRepo.of({
      list: () =>
        sql<Session>`SELECT id, name, cwd, created_at FROM sessions ORDER BY created_at`,

      get: (id) =>
        sql<Session>`SELECT id, name, cwd, created_at FROM sessions WHERE id = ${id}`.pipe(
          Effect.flatMap((rows) =>
            rows.length === 0
              ? Effect.fail(new Error(`Session not found: ${id}`))
              : Effect.succeed(rows[0])
          )
        ),

      create: (name) =>
        Effect.gen(function* () {
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
        }),

      remove: (id) =>
        Effect.asVoid(sql`DELETE FROM sessions WHERE id = ${id}`),

      rename: (id, name) =>
        sql<Session>`
          UPDATE sessions SET name = ${name} WHERE id = ${id}
          RETURNING id, name, cwd, created_at
        `.pipe(
          Effect.flatMap((rows) =>
            rows.length === 0
              ? Effect.fail(new Error(`Session not found: ${id}`))
              : Effect.succeed(rows[0])
          )
        ),

      updateCwd: (id, cwd) =>
        Effect.asVoid(sql`UPDATE sessions SET cwd = ${cwd} WHERE id = ${id}`),

      addEntry: (sessionId, type, content) =>
        Effect.gen(function* () {
          const now = Date.now()
          const rows = yield* sql<Entry>`
            INSERT INTO entries (session_id, type, content, created_at)
            VALUES (${sessionId}, ${type}, ${content}, ${now})
            RETURNING id, session_id, type, content, created_at
          `
          return rows[0]
        }),

      getEntries: (sessionId) =>
        sql<Entry>`SELECT id, session_id, type, content, created_at FROM entries WHERE session_id = ${sessionId} ORDER BY id`,
    })
  })
)
