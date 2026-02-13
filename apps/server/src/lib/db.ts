import * as SqliteBun from "@effect/sql-sqlite-bun/SqliteClient"
import { SqlClient } from "@effect/sql/SqlClient"
import { Effect, Layer } from "effect"
import fs from "node:fs"
import path from "node:path"

// AGENTPANE_DATA_DIR overrides the base directory (set by bin script for npx).
// Default for dev: navigate from import.meta.dirname to monorepo root.
const baseDir = process.env.AGENTPANE_DATA_DIR || path.resolve(import.meta.dirname, "../../../..")
const dataDir = process.env.AGENTPANE_DATA_DIR || path.resolve(baseDir, "data")
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const migrations = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`PRAGMA journal_mode = WAL`
  yield* sql`PRAGMA busy_timeout = 5000`
  yield* sql`PRAGMA foreign_keys = ON`
  yield* sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL DEFAULT '~',
      agent_type TEXT NOT NULL DEFAULT 'claude-code',
      agent_session_id TEXT,
      created_at INTEGER NOT NULL
    )
  `
  yield* sql`ALTER TABLE sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'claude-code'`.pipe(
    Effect.catchAll(() => Effect.void)
  )
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
  yield* sql`ALTER TABLE turns ADD COLUMN prompt_tokens INTEGER`.pipe(
    Effect.catchAll(() => Effect.void)
  )
  yield* sql`ALTER TABLE turns ADD COLUMN completion_tokens INTEGER`.pipe(
    Effect.catchAll(() => Effect.void)
  )
  yield* sql`ALTER TABLE turns ADD COLUMN total_tokens INTEGER`.pipe(
    Effect.catchAll(() => Effect.void)
  )
  yield* sql`ALTER TABLE turns ADD COLUMN token_source TEXT`.pipe(
    Effect.catchAll(() => Effect.void)
  )
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, id)
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
    CREATE INDEX IF NOT EXISTS idx_message_blocks_turn ON message_blocks(turn_id, id)
  `
  yield* sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `
})

const dbPath = path.resolve(dataDir, "agentpane.db")

const SqliteBaseLive = SqliteBun.layer({ filename: dbPath })

export const SqliteLive = Layer.effectDiscard(migrations).pipe(
  Layer.provideMerge(SqliteBaseLive)
)
