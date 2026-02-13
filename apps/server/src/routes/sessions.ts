import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { Effect, Exit } from "effect"
import { AppRuntime } from "../lib/runtime.js"
import { SessionRepo } from "../lib/session-repo.js"
import { AcpClient } from "../lib/acp-client.js"

type AppContext = SessionRepo | AcpClient

const runEffect = async <A>(
  c: Context,
  effect: Effect.Effect<A, unknown, AppContext>,
  status: ContentfulStatusCode = 200
) => {
  const exit = await AppRuntime.runPromiseExit(effect)
  return Exit.match(exit, {
    onFailure: (cause) => {
      if (cause._tag === "Fail") {
        const err = cause.error as { httpStatus?: number; httpMessage?: string }
        if (err.httpStatus) return c.json({ error: err.httpMessage ?? "Error" }, err.httpStatus as ContentfulStatusCode)
      }
      return c.json({ error: "Internal error" }, 500)
    },
    onSuccess: (result) => c.json(result, status),
  })
}

const app = new Hono()

// GET /sessions — list all sessions with connection status
app.get("/", async (c) => {
  const result = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient
      const sessions = yield* repo.list()
      const connected = acp.connectedSessionIds()
      const prompting = acp.promptingSessionIds()
      return sessions.map((s) => ({
        ...s,
        connected: connected.has(s.id),
        prompting: prompting.has(s.id),
      }))
    })
  )
  return c.json(result)
})

// POST /sessions — create a new session, optionally auto-connect
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return runEffect(c, Effect.gen(function* () {
    const repo = yield* SessionRepo
    const acp = yield* AcpClient
    const session = yield* repo.create(body.name, body.agent_type)

    const cwd = body.cwd || session.cwd
    if (body.cwd && body.cwd !== session.cwd) {
      yield* repo.updateCwd(session.id, body.cwd)
    }

    acp.ensureBroadcaster(session.id)

    let connected = false
    if (body.agent_type) {
      yield* acp.connect(session.id, cwd, session.agent_type).pipe(
        Effect.tapError(() =>
          Effect.gen(function* () {
            acp.removeBroadcaster(session.id)
            yield* repo.remove(session.id)
          }).pipe(Effect.ignore)
        )
      )
      connected = true
    }

    return { ...session, cwd, connected, prompting: false }
  }), 201)
})

// GET /sessions/status — quick connection/prompting status check
app.get("/status", async (c) => {
  const { connected, prompting } = await AppRuntime.runPromise(
    Effect.map(AcpClient, (acp) => ({
      connected: [...acp.connectedSessionIds()],
      prompting: [...acp.promptingSessionIds()],
    }))
  )
  return c.json({ connected, prompting })
})

// GET /sessions/:id — get a single session
app.get("/:id", async (c) => runEffect(c,
  Effect.gen(function* () {
    const id = c.req.param("id")
    const repo = yield* SessionRepo
    const acp = yield* AcpClient
    const session = yield* repo.get(id)
    const connected = yield* acp.isConnected(id)
    return { ...session, connected }
  })
))

// PATCH /sessions/:id — rename a session
app.patch("/:id", async (c) => {
  const body = await c.req.json()
  return runEffect(c, Effect.flatMap(SessionRepo, (repo) => repo.rename(c.req.param("id"), body.name)))
})

// DELETE /sessions/:id — delete a session
app.delete("/:id", async (c) => {
  const id = c.req.param("id")
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const acp = yield* AcpClient
      yield* acp.disconnect(id)
      acp.removeBroadcaster(id)
      const repo = yield* SessionRepo
      yield* repo.remove(id)
    })
  )
  return c.body(null, 204)
})

// GET /sessions/:id/conversation — get full conversation history
app.get("/:id/conversation", async (c) => {
  const conversation = await AppRuntime.runPromise(
    Effect.flatMap(SessionRepo, (repo) => repo.getConversation(c.req.param("id")))
  )
  return c.json(conversation)
})

// GET /sessions/:id/token-usage — aggregate token usage for the session
app.get("/:id/token-usage", async (c) => runEffect(c,
  Effect.flatMap(SessionRepo, (repo) => repo.getSessionTokenUsage(c.req.param("id")))
))

// POST /sessions/:id/prompt — send a prompt to the agent
app.post("/:id/prompt", async (c) => {
  const { content } = await c.req.json()
  if (!content || typeof content !== "string") return c.json({ error: "content is required" }, 400)
  return runEffect(c, Effect.flatMap(AcpClient, (acp) => acp.prompt(c.req.param("id"), content)))
})

// POST /sessions/:id/permission — respond to a permission request
app.post("/:id/permission", async (c) => {
  const { requestId, optionId } = await c.req.json()
  if (!requestId || !optionId) return c.json({ error: "requestId and optionId are required" }, 400)
  return runEffect(c, Effect.gen(function* () {
    yield* (yield* AcpClient).respondToPermission(c.req.param("id"), requestId, optionId)
    return { ok: true }
  }))
})

// GET /sessions/:id/commands — get available slash commands
app.get("/:id/commands", async (c) => runEffect(c,
  Effect.flatMap(AcpClient, (acp) => acp.getAvailableCommands(c.req.param("id")))
))

// GET /sessions/:id/config — get current config options
app.get("/:id/config", async (c) => runEffect(c,
  Effect.flatMap(AcpClient, (acp) => acp.getConfigOptions(c.req.param("id")))
))

// POST /sessions/:id/config — set a config option
app.post("/:id/config", async (c) => {
  const { configId, value } = await c.req.json()
  if (!configId || typeof configId !== "string" || typeof value !== "string") {
    return c.json({ error: "configId and value are required" }, 400)
  }
  return runEffect(c, Effect.flatMap(AcpClient, (acp) => acp.setConfigOption(c.req.param("id"), configId, value)))
})

// POST /sessions/:id/cancel — cancel an in-progress prompt
app.post("/:id/cancel", async (c) => {
  await AppRuntime.runPromise(
    Effect.flatMap(AcpClient, (acp) => acp.cancel(c.req.param("id")))
  )
  return c.body(null, 204)
})

// GET /sessions/:id/events — SSE event stream
app.get("/:id/events", (c) => {
  const id = c.req.param("id")

  // SSE standard: EventSource sends Last-Event-ID on auto-reconnect
  const lastEventIdHeader = c.req.header("Last-Event-ID")
  const afterEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : undefined

  return streamSSE(c, async (stream) => {
    const { subscriberId, stream: eventStream, prompting, assistantTurnId, latestEventId } =
      await AppRuntime.runPromise(
        Effect.flatMap(AcpClient, (acp) => acp.subscribe(id, afterEventId))
      )

    // Send initial status event (id: 0)
    await stream.writeSSE({
      id: "0",
      data: JSON.stringify({
        sessionUpdate: "status",
        prompting,
        assistantTurnId,
        latestEventId,
      }),
    })

    // Pipe broadcaster events
    const reader = eventStream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // value is already SSE-formatted ("id: N\ndata: {...}\n\n")
        await stream.write(value)
      }
    } catch {
      // Stream ended
    } finally {
      await AppRuntime.runPromise(
        Effect.flatMap(AcpClient, (acp) => acp.unsubscribe(id, subscriberId))
      ).catch(() => {})
    }
  })
})

// POST /sessions/:id/connect — connect agent to session
app.post("/:id/connect", async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const id = c.req.param("id")
  return runEffect(c, Effect.gen(function* () {
    const repo = yield* SessionRepo
    const acp = yield* AcpClient
    const session = body.agent_type && body.cwd
      ? yield* repo.updateConfig(id, body.agent_type, body.cwd)
      : yield* repo.get(id)
    acp.ensureBroadcaster(id)
    return yield* acp.connect(id, session.cwd, session.agent_type)
  }))
})

// DELETE /sessions/:id/connect — disconnect agent
app.delete("/:id/connect", async (c) => {
  await AppRuntime.runPromise(
    Effect.flatMap(AcpClient, (acp) => acp.disconnect(c.req.param("id")))
  )
  return c.body(null, 204)
})

export const sessionsRoutes = app
