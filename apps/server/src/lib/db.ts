import * as SqliteNode from "@effect/sql-sqlite-node/SqliteClient"
import { SqlClient } from "@effect/sql/SqlClient"
import { Effect, Layer } from "effect"
import fs from "node:fs"
import path from "node:path"

// Database lives at monorepo root: ../../data/acapa.db (relative to apps/server/)
const monorepoRoot = path.resolve(import.meta.dirname, "../../../..")
const dataDir = path.resolve(monorepoRoot, "data")
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
      created_at INTEGER NOT NULL
    )
  `
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
})

const dbPath = path.resolve(monorepoRoot, "data", "acapa.db")

const SqliteBaseLive = SqliteNode.layer({ filename: dbPath })

export const SqliteLive = Layer.effectDiscard(migrations).pipe(
  Layer.provideMerge(SqliteBaseLive)
)
