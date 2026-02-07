# Acapa

ACP (Agent Client Protocol) frontend — a web UI for interacting with AI coding agents like Claude Code. Spawns ACP agent subprocesses, communicates via JSON-RPC 2.0 over stdio, and displays streamed agent responses, tool calls, and plans in a chat-style interface.

## Tech Stack

- **Frontend:** Next.js 16, React 19, Tailwind CSS 4
- **Backend:** Effect.ts services/layers, ManagedRuntime singleton
- **Database:** SQLite via `@effect/sql-sqlite-node` + `better-sqlite3` at `data/acapa.db`
- **ACP:** `@agentclientprotocol/sdk` + `@zed-industries/claude-code-acp`
- **Dev server:** `npm run dev` on port 6767

## Architecture

### Backend (`src/lib/`)

Effect.ts service layers composed into a single `ManagedRuntime` (`AppRuntime`) shared across all API routes:

- `schema.ts` — Effect Schema classes for `Session`, `Turn`, `MessageBlock`, and error types
- `db.ts` — `SqliteLive` layer (SQLite connection, migrations, WAL mode, foreign keys)
- `session-repo.ts` — `SessionRepo` service (CRUD for sessions, turns, message blocks)
- `acp-client.ts` — `AcpClient` service (manages agent subprocesses, ACP connections, prompt streaming)
- `runtime.ts` — `AppRuntime = ManagedRuntime.make(AcpClient.layer | SessionRepo.layer | SqliteLive)`

### API Routes (`src/app/api/sessions/`)

- `GET/POST /api/sessions` — list/create sessions (POST auto-connects agent)
- `GET/PATCH/DELETE /api/sessions/[id]` — get/rename/delete (DELETE disconnects agent)
- `POST /api/sessions/[id]/prompt` — send prompt, stream response via SSE
- `GET /api/sessions/[id]/conversation` — get full conversation history
- `POST/DELETE /api/sessions/[id]/connect` — connect/disconnect agent

### Frontend (`src/app/components/`)

- `session-layout.tsx` — orchestrator: sidebar + chat view, auto-creates first session
- `sidebar.tsx` — session list with create/rename/delete, connection status indicators
- `chat-view.tsx` — chat-style message display, SSE streaming, prompt input

## Key Patterns

- Effect services use `Context.Tag` class pattern with static `layer` properties
- Errors use `Schema.TaggedError` (e.g., `SessionNotFoundError`, `AcpConnectionError`) for type-safe domain errors
- Service methods use `Effect.fn` for call-site tracing
- API routes bridge Effect into Next.js via `AppRuntime.runPromise` / `AppRuntime.runPromiseExit`
- ACP agent spawned as child process (`claude-code-acp`), communicates via `ndJsonStream` over stdio
- `ClientSideConnection` from ACP SDK manages JSON-RPC 2.0 protocol
- Session updates streamed to frontend as SSE events (`text/event-stream`)
- `serverExternalPackages` includes `better-sqlite3`, `@agentclientprotocol/sdk`, `@zed-industries/claude-code-acp`

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->
