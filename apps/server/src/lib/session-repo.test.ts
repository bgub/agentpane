import { describe, expect, it } from "vitest"
import * as SqliteNode from "@effect/sql-sqlite-node/SqliteClient"
import { SqlClient } from "@effect/sql/SqlClient"
import { Effect, Layer } from "effect"
import { SessionRepo } from "./session-repo.js"
import type { WriteOp } from "./write-ops.js"

const testSqliteLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient
    yield* sql`PRAGMA foreign_keys = ON`
    yield* sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        agent_session_id TEXT,
        mcp_servers TEXT,
        created_at INTEGER NOT NULL
      )
    `
    yield* sql`
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        stop_reason TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        token_source TEXT,
        created_at INTEGER NOT NULL
      )
    `
    yield* sql`
      CREATE TABLE IF NOT EXISTS message_blocks (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `
    yield* sql`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `
  })
).pipe(Layer.provideMerge(SqliteNode.layer({ filename: ":memory:" })))

describe("SessionRepo.persistOps", () => {
  it("rolls back entire batch when one op fails", async () => {
    const layer = SessionRepo.layer.pipe(Layer.provide(testSqliteLayer))

    const program = Effect.gen(function* () {
      const repo = yield* SessionRepo
      const session = yield* repo.create("rollback-test", "claude-code")
      const turn = yield* repo.addTurn(session.id, "assistant")

      const ops: ReadonlyArray<WriteOp> = [
        {
          _tag: "AddMessageBlock",
          sessionId: session.id,
          turnId: turn.id,
          kind: "text",
          content: "this should be rolled back",
        },
        {
          _tag: "AddMessageBlock",
          sessionId: session.id,
          turnId: "missing-turn-id",
          kind: "text",
          content: "this should fail",
        },
      ]

      const exit = yield* repo.persistOps(ops).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")

      const conversation = yield* repo.getConversation(session.id)
      expect(conversation.length).toBe(1)
      expect(conversation[0]?.blocks.length ?? 0).toBe(0)
    }).pipe(Effect.provide(layer))

    await Effect.runPromise(program)
  })
})
