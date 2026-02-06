import { SqlClient } from "@effect/sql/SqlClient"
import { SqlError } from "@effect/sql/SqlError"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as crypto from "node:crypto"
import { Session, Entry } from "./schema"

type RepoError = SqlError | Error

export interface SessionRepo {
  readonly list: () => Effect.Effect<Session[], RepoError>
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
  readonly getEntries: (sessionId: string) => Effect.Effect<Entry[], RepoError>
}

export const SessionRepo = Context.GenericTag<SessionRepo>("SessionRepo")

export const SessionRepoLive = Layer.effect(
  SessionRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient

    return SessionRepo.of({
      list: () =>
        Effect.map(
          sql<Session>`SELECT id, name, cwd, created_at FROM sessions ORDER BY created_at`,
          (rows) => rows as unknown as Session[]
        ),

      get: (id) =>
        Effect.flatMap(
          sql<Session>`SELECT id, name, cwd, created_at FROM sessions WHERE id = ${id}`,
          (rows) => {
            const r = rows as unknown as Session[]
            if (r.length === 0) {
              return Effect.fail(new Error(`Session not found: ${id}`))
            }
            return Effect.succeed(r[0])
          }
        ),

      create: (name) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const now = Date.now()
          // Count existing sessions for default name
          const counts = yield* sql<{ cnt: number }>`SELECT COUNT(*) as cnt FROM sessions`
          const sessionName = name || `Session ${(counts[0]?.cnt ?? 0) + 1}`
          const home = process.env.HOME || "~"
          yield* sql`INSERT INTO sessions (id, name, cwd, created_at) VALUES (${id}, ${sessionName}, ${home}, ${now})`
          return { id, name: sessionName, cwd: home, created_at: now } as unknown as Session
        }),

      remove: (id) =>
        Effect.asVoid(sql`DELETE FROM sessions WHERE id = ${id}`),

      rename: (id, name) =>
        Effect.gen(function* () {
          yield* sql`UPDATE sessions SET name = ${name} WHERE id = ${id}`
          const rows = yield* sql<Session>`SELECT id, name, cwd, created_at FROM sessions WHERE id = ${id}`
          const r = rows as unknown as Session[]
          if (r.length === 0) {
            return yield* Effect.fail(new Error(`Session not found: ${id}`))
          }
          return r[0]
        }),

      updateCwd: (id, cwd) =>
        Effect.asVoid(sql`UPDATE sessions SET cwd = ${cwd} WHERE id = ${id}`),

      addEntry: (sessionId, type, content) =>
        Effect.gen(function* () {
          const now = Date.now()
          yield* sql`INSERT INTO entries (session_id, type, content, created_at) VALUES (${sessionId}, ${type}, ${content}, ${now})`
          const rows = yield* sql<Entry>`SELECT id, session_id, type, content, created_at FROM entries WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT 1`
          return (rows as unknown as Entry[])[0]
        }),

      getEntries: (sessionId) =>
        Effect.map(
          sql<Entry>`SELECT id, session_id, type, content, created_at FROM entries WHERE session_id = ${sessionId} ORDER BY id`,
          (rows) => rows as unknown as Entry[]
        ),
    })
  })
)
