# AgentPane

Web UI for AI coding agents. Users visit [agentpane.dev](https://agentpane.dev), run `npx agentpane` locally, and the webapp connects to their local server to manage agent sessions. The frontend is deployed on Vercel; the backend runs on the user's machine (spawning ACP agent subprocesses, managing SQLite state, and streaming responses via SSE).

Communication with agents uses ACP (Agent Client Protocol) — JSON-RPC 2.0 over stdio.

## Quick Start

```sh
npx agentpane          # starts local server on port 3456
# then open https://agentpane.dev
```

For development: `pnpm dev` starts both server and web via Turbo.

## Tech Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Backend (`apps/server`):** Hono + Effect.ts services/layers, standalone Node.js server on port 3456. Published to npm as `agentpane`.
- **Frontend (`apps/web`):** Next.js 16, React 19, Tailwind CSS 4. Deployed to Vercel at [agentpane.dev](https://agentpane.dev).
- **Database:** SQLite via `@effect/sql-sqlite-node` + `better-sqlite3` at `data/agentpane.db`
- **ACP:** `@agentclientprotocol/sdk` + `@zed-industries/claude-code-acp`

## Architecture

### Backend (`apps/server/`)

Standalone Hono HTTP server with Effect.ts service layers composed into `ManagedRuntime`:

- `src/lib/schema.ts` — Effect Schema classes for `Session`, `Turn`, `MessageBlock`, and error types
- `src/lib/db.ts` — `SqliteLive` layer (SQLite connection, migrations, WAL mode, foreign keys)
- `src/lib/session-repo.ts` — `SessionRepo` service (CRUD for sessions, turns, message blocks)
- `src/lib/acp-client.ts` — `AcpClient` service (agent subprocesses, ACP connections, session-level broadcasters)
- `src/lib/event-broadcaster.ts` — `EventBroadcaster` class (SSE event buffering + ring buffer for reconnection)
- `src/lib/runtime.ts` — `AppRuntime = ManagedRuntime.make(AcpClient.layer | SessionRepo.layer | SqliteLive)`
- `src/lib/providers.ts` — Agent provider config (claude-code, codex)
- `src/routes/sessions.ts` — All Hono route handlers
- `src/index.ts` — Entry point, Hono app + `serve()` on port 3456

### API Routes (all in `apps/server/src/routes/sessions.ts`)

- `GET/POST /api/sessions` — list/create sessions (POST with `agent_type` does atomic create+connect)
- `GET /api/sessions/status` — quick connection/prompting status check
- `GET/PATCH/DELETE /api/sessions/:id` — get/rename/delete (DELETE disconnects agent + removes broadcaster)
- `GET /api/sessions/:id/conversation` — get full conversation history
- `POST /api/sessions/:id/prompt` — send prompt (no auto-connect; returns error if not connected)
- `POST /api/sessions/:id/cancel` — cancel in-progress prompt
- `GET /api/sessions/:id/events` — SSE event stream (always succeeds, uses session-level broadcaster)
- `POST/DELETE /api/sessions/:id/connect` — connect/disconnect agent

### Frontend (`apps/web/`)

Pure UI — no backend dependencies (no Effect, no SQLite, no ACP SDK).

- `src/lib/api.ts` — Backend API client (all fetch calls to `http://localhost:3456`)
- `src/app/components/session-layout.tsx` — Orchestrator: sidebar + chat views + setup mode
- `src/app/components/sidebar.tsx` — Session list with Active/History sections, status dots
- `src/app/components/chat-view.tsx` — Chat display, always-on SSE, prompt input, connect/disconnect button
- `src/app/components/providers.ts` — Provider info for UI display

## Key Patterns

- Effect services use `Context.Tag` class pattern with static `layer` properties
- Errors use `Schema.TaggedError` (e.g., `SessionNotFoundError`, `AcpConnectionError`)
- Service methods use `Effect.fn` for call-site tracing
- Hono routes bridge Effect via `AppRuntime.runPromise` / `AppRuntime.runPromiseExit`
- Session-level broadcasters (`Map<sessionId, EventBroadcaster>`) survive agent disconnects
- `subscribe()` always succeeds (no `AcpConnectionError`), uses session-level broadcaster
- `connect()` broadcasts `"connected"` event; `disconnect()`/crash broadcasts `"disconnected"`
- Frontend EventSource is always-on (no `if (!connected) return` guard)
- Top bar has connect/disconnect toggle button; submitting a prompt auto-reconnects if disconnected
- Setup mode lives in `SessionLayout`, not `ChatView` — no DB session until user clicks Start
- Sidebar splits sessions into Active (connected, with status dots) and History (disconnected, muted)

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->
