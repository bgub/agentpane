import * as SqliteNode from "@effect/sql-sqlite-node/SqliteClient"
import { SqlClient } from "@effect/sql/SqlClient"
import { Effect, Layer } from "effect"
import fs from "node:fs"
import path from "node:path"

const dataDir = path.resolve(process.cwd(), "data")
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const migrations = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`PRAGMA journal_mode = WAL`
  yield* sql`PRAGMA foreign_keys = ON`
  yield* sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL DEFAULT '~',
      created_at INTEGER NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id, id)
  `
})

const dbPath = path.resolve(process.cwd(), "data", "acapa.db")

const SqliteBaseLive = SqliteNode.layer({ filename: dbPath })

export const SqliteLive = Layer.effectDiscard(migrations).pipe(
  Layer.provideMerge(SqliteBaseLive)
)
