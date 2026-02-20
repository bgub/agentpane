# AgentPane

Web UI for AI coding agents. `npx agentpane` starts a local server on port 3456 that serves both the API and the UI from a single process. No separate frontend deployment — everything runs locally.

Communication with agents uses ACP (Agent Client Protocol) — JSON-RPC 2.0 over stdio.

## Quick Start

```sh
npx agentpane          # starts server + UI on http://localhost:3456
```

For development: `pnpm dev` starts both Vite dev server (port 6767) and Hono API server (port 3456) via Turbo. The Vite dev server proxies `/api` requests to localhost:3456.

## Tech Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Backend (`apps/server`):** Hono + Effect.ts services/layers, Node.js server on port 3456. Published to npm as `agentpane`. Serves both API and static frontend.
- **Frontend (`apps/web`):** Vite SPA, React 19, Tailwind CSS 4. Built as static assets, served by the backend.
- **Database:** SQLite via `@effect/sql-sqlite-node` + `better-sqlite3` at `data/agentpane.db`
- **ACP:** `@agentclientprotocol/sdk` + `@zed-industries/claude-code-acp`

## Architecture

### Unified Server

The backend serves both the API (`/api/*`) and the frontend (static files from `web/` directory). In production (`npx agentpane`), `apps/server/web/` contains the pre-built Vite output. In development, Vite runs its own dev server with HMR and proxies API calls to the backend.

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
- `src/index.ts` — Entry point, Hono app + `serve()` on port 3456 + serveStatic for frontend

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

Vite SPA — pure UI, no backend dependencies (no Effect, no SQLite, no ACP SDK). Same-origin with the API, no auth tokens or CORS needed.

- `src/main.tsx` — App entry point (replaces Next.js layout.tsx + page.tsx)
- `src/lib/api.ts` — Backend API client (relative URLs, plain fetch — no auth)
- `src/app/components/session-provider.tsx` — Session state management
- `src/app/components/layout-provider.tsx` — Multi-pane layout state
- `src/app/components/sidebar.tsx` — Session list with Active/History sections, status dots
- `src/app/components/chat-view/index.tsx` — Chat display, always-on SSE, prompt input
- `src/app/components/providers.ts` — Provider info for UI display

## Key Patterns

### Backend

- Effect services use `Context.Tag` class pattern with static `layer` properties
- Errors use `Schema.TaggedError` with `httpStatus`/`httpMessage` getters for self-describing HTTP responses
- Service methods use `Effect.fn` for call-site tracing
- Hono routes bridge Effect via `runEffect(c, effect, status?)` — centralizes exit matching and error-to-HTTP mapping
- For routes without typed errors (DELETE, cancel), use `AppRuntime.runPromise` directly
- Session-level broadcasters (`Map<sessionId, EventBroadcaster>`) survive agent disconnects
- `subscribe()` always succeeds (no `AcpConnectionError`), uses session-level broadcaster
- `connect()` broadcasts `"connected"` event; `disconnect()`/crash broadcasts `"disconnected"`
- No auth or CORS middleware — everything is same-origin

### Frontend

- **No manual memoization** — React Compiler (`babel-plugin-react-compiler`) handles all memoization automatically. Never use `useMemo`, `useCallback`, or `React.memo` — they add noise and the compiler does it better.
- EventSource is always-on (no `if (!connected) return` guard)
- Top bar has connect/disconnect toggle button; submitting a prompt auto-reconnects if disconnected
- Setup mode lives in `SessionLayout`, not `ChatView` — no DB session until user clicks Start
- Sidebar splits sessions into Active (connected, with status dots) and History (disconnected, muted)
- No auth tokens — API calls use plain `fetch` with relative URLs

### Build Pipeline

- `pnpm build` — Turbo builds `@agentpane/web` first (Vite → `apps/web/dist/`), then server (`tsc` + copies `../web/dist` → `apps/server/web/`)
- `apps/server/web/` is a build artifact (gitignored), included in npm publish via `files` field
- `node apps/server/bin/agentpane.js` — single process serves everything on :3456

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->
