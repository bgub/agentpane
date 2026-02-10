import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { Context } from "hono"
import { Effect, Exit } from "effect"
import { AppRuntime } from "../lib/runtime.js"
import { SessionRepo } from "../lib/session-repo.js"
import { AcpClient } from "../lib/acp-client.js"

const matchRouteExit = <A>(
  exit: Exit.Exit<A, unknown>,
  c: Context,
  successStatus: 200 | 201 = 200
) =>
  Exit.match(exit, {
    onFailure: (cause) => {
      if (cause._tag === "Fail") {
        const err = cause.error as { _tag?: string; message?: string }
        switch (err._tag) {
          case "SessionNotFoundError":
            return c.json({ error: "Session not found" }, 404)
          case "AcpConnectionError":
            return c.json({ error: err.message }, 502)
        }
      }
      return c.json({ error: "Internal error" }, 500)
    },
    onSuccess: (result) => c.json(result, successStatus),
  })

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

  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient
      const session = yield* repo.create(body.name, body.agent_type)

      // Ensure broadcaster exists immediately so EventSource works
      acp.ensureBroadcaster(session.id)

      // If agent_type provided, await connection (atomic create+connect)
      let connected = false
      if (body.agent_type) {
        yield* acp.connect(session.id, session.cwd, session.agent_type)
        connected = true
      }

      return { ...session, connected, prompting: false }
    })
  )

  return matchRouteExit(exit, c, 201)
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
app.get("/:id", async (c) => {
  const id = c.req.param("id")
  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient
      const session = yield* repo.get(id)
      const connected = yield* acp.isConnected(id)
      return { ...session, connected }
    })
  )
  return matchRouteExit(exit, c)
})

// PATCH /sessions/:id — rename a session
app.patch("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json()
  const exit = await AppRuntime.runPromiseExit(
    Effect.flatMap(SessionRepo, (repo) => repo.rename(id, body.name))
  )
  return matchRouteExit(exit, c)
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
  const id = c.req.param("id")
  const conversation = await AppRuntime.runPromise(
    Effect.flatMap(SessionRepo, (repo) => repo.getConversation(id))
  )
  return c.json(conversation)
})

// POST /sessions/:id/prompt — send a prompt to the agent
app.post("/:id/prompt", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json()
  const { content } = body

  if (!content || typeof content !== "string") {
    return c.json({ error: "content is required" }, 400)
  }

  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const acp = yield* AcpClient
      // No auto-connect — return error if not connected
      return yield* acp.prompt(id, content)
    })
  )

  return matchRouteExit(exit, c)
})

// POST /sessions/:id/cancel — cancel an in-progress prompt
app.post("/:id/cancel", async (c) => {
  const id = c.req.param("id")
  await AppRuntime.runPromise(
    Effect.flatMap(AcpClient, (acp) => acp.cancel(id))
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
  const id = c.req.param("id")
  const body = await c.req.json().catch(() => ({}))

  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const acp = yield* AcpClient

      // If agent_type and cwd provided, update session config first
      let session
      if (body.agent_type && body.cwd) {
        session = yield* repo.updateConfig(id, body.agent_type, body.cwd)
      } else {
        session = yield* repo.get(id)
      }

      // Ensure broadcaster exists
      acp.ensureBroadcaster(id)

      return yield* acp.connect(id, session.cwd, session.agent_type)
    })
  )
  return matchRouteExit(exit, c)
})

// DELETE /sessions/:id/connect — disconnect agent
app.delete("/:id/connect", async (c) => {
  const id = c.req.param("id")
  await AppRuntime.runPromise(
    Effect.flatMap(AcpClient, (acp) => acp.disconnect(id))
  )
  return c.body(null, 204)
})

export const sessionsRoutes = app
