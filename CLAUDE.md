# Acapa

Web-based terminal with persistent multi-session support. Users can create, rename, and delete terminal sessions, each with independent command history and working directory that persists across server restarts.

## Tech Stack

- **Frontend:** Next.js 16, React 19, Tailwind CSS 4
- **Backend:** Effect.ts services/layers, ManagedRuntime singleton
- **Database:** SQLite via `@effect/sql-sqlite-node` + `better-sqlite3` at `data/acapa.db`
- **Dev server:** `npm run dev` on port 6767

## Architecture

### Backend (`src/lib/`)

Effect.ts service layers composed into a single `ManagedRuntime` (`AppRuntime`) shared across all API routes:

- `schema.ts` — Effect Schema classes for `Session`, `Entry`, and `SessionNotFoundError`
- `db.ts` — `SqliteLive` layer (SQLite connection, migrations, WAL mode, foreign keys)
- `session-repo.ts` — `SessionRepo` service (`Context.Tag` class with static `layer`)
- `command-executor.ts` — `CommandExecutor` service (`Context.Tag` class with static `layer`)
- `runtime.ts` — `AppRuntime = ManagedRuntime.make(CommandExecutor.layer | SessionRepo.layer | SqliteLive)`

### API Routes (`src/app/api/sessions/`)

- `GET/POST /api/sessions` — list/create sessions
- `GET/PATCH/DELETE /api/sessions/[id]` — get/rename/delete
- `POST /api/sessions/[id]/exec` — execute command (streaming NDJSON)
- `GET /api/sessions/[id]/history` — get all entries

### Frontend (`src/app/components/`)

- `session-layout.tsx` — orchestrator: sidebar + terminal, auto-creates first session
- `sidebar.tsx` — session list with create/rename/delete (right-click context menu)
- `terminal.tsx` — per-session terminal, loads history from DB, streams command output

## Key Patterns

- Effect services use `Context.Tag` class pattern with static `layer` properties
- Errors use `Schema.TaggedError` (e.g., `SessionNotFoundError`) for type-safe domain errors
- Service methods use `Effect.fn` for call-site tracing
- API routes bridge Effect into Next.js via `AppRuntime.runPromise` / `AppRuntime.runPromiseExit`
- CWD tracked server-side: CommandExecutor appends `echo "__ACAPA_CWD_9f3a__$(pwd)"` after each command, filters marker from streamed output, updates session cwd in DB
- `serverExternalPackages: ["better-sqlite3"]` in `next.config.ts` for native module support

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->
