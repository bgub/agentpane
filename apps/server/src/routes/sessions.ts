import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { Effect, Exit } from "effect"
import { AppRuntime } from "../lib/runtime.js"
import { SessionRepo } from "../lib/session-repo.js"
import { AcpClient } from "../lib/acp-client.js"
import type { PromptInputBlock } from "../lib/prompt-engine.js"
import {
  type JsonObject,
  asNonEmptyString,
  asOptionalString,
  asString,
  badRequest,
  parseLastEventId,
  readJsonObject,
  safeParse,
} from "./validation.js"

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
        const err = cause.error as {
          httpStatus?: number
          httpMessage?: string
          provider?: string
          authMethods?: unknown
        }
        if (err.httpStatus) {
          const payload: Record<string, unknown> = { error: err.httpMessage ?? "Error" }
          if (typeof err.provider === "string") payload.provider = err.provider
          if (Array.isArray(err.authMethods)) payload.authMethods = err.authMethods
          return c.json(payload, err.httpStatus as ContentfulStatusCode)
        }
      }
      return c.json({ error: "Internal error" }, 500)
    },
    onSuccess: (result) => c.json(result, status),
  })
}

const app = new Hono()

type ParseResult =
  | { ok: true; blocks: ReadonlyArray<PromptInputBlock> }
  | { ok: false; error: string }

const parsePromptBlocks = (body: JsonObject): ParseResult => {
  const content = asNonEmptyString(body.content)
  const rawBlocks = body.blocks

  if (content && rawBlocks !== undefined) {
    return { ok: false, error: "Provide either content or blocks, not both" }
  }

  if (content) {
    return { ok: true, blocks: [{ type: "text", text: content }] }
  }

  if (!Array.isArray(rawBlocks)) {
    return { ok: false, error: "content or blocks is required" }
  }

  const parsed: Array<PromptInputBlock> = []
  for (const item of rawBlocks) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "blocks must contain objects" }
    }

    const block = item as Record<string, unknown>
    const type = asString(block.type)
    if (type === "text") {
      const text = asNonEmptyString(block.text)
      if (!text) return { ok: false, error: "text block requires text" }
      parsed.push({ type: "text", text })
      continue
    }

    if (type === "resource_link") {
      const uri = asNonEmptyString(block.uri)
      const name = asNonEmptyString(block.name)
      if (!uri || !name) return { ok: false, error: "resource_link block requires uri and name" }
      parsed.push({
        type: "resource_link",
        uri,
        name,
        description: asOptionalString(block.description) ?? null,
        mimeType: asOptionalString(block.mimeType) ?? null,
        title: asOptionalString(block.title) ?? null,
      })
      continue
    }

    if (type === "image") {
      const data = asNonEmptyString(block.data)
      const mimeType = asNonEmptyString(block.mimeType)
      if (!data || !mimeType) return { ok: false, error: "image block requires data and mimeType" }
      parsed.push({ type: "image", data, mimeType })
      continue
    }

    return { ok: false, error: `Unsupported block type: ${String(type ?? "unknown")}` }
  }

  if (parsed.length === 0) {
    return { ok: false, error: "blocks must not be empty" }
  }

  return { ok: true, blocks: parsed }
}

// GET /sessions — list all sessions with connection status
app.get("/", async (c) => runEffect(c,
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
))

// POST /sessions — create a new session, optionally auto-connect
app.post("/", async (c) => {
  const body = await readJsonObject(c)
  const name = asOptionalString(body.name)
  const agentType = asOptionalString(body.agent_type)
  const cwdInput = asOptionalString(body.cwd)
  const mcpServers = Array.isArray(body.mcpServers) ? body.mcpServers as Array<Record<string, unknown>> : undefined

  return runEffect(c, Effect.gen(function* () {
    const repo = yield* SessionRepo
    const acp = yield* AcpClient
    const session = yield* repo.create(name, agentType)

    const cwd = cwdInput || session.cwd
    if (cwdInput && cwdInput !== session.cwd) {
      yield* repo.updateCwd(session.id, cwdInput)
    }

    if (mcpServers && mcpServers.length > 0) {
      yield* repo.updateMcpServers(session.id, JSON.stringify(mcpServers))
    }

    acp.ensureBroadcaster(session.id)

    let connected = false
    if (agentType) {
      yield* acp.connect(session.id, cwd, session.agent_type, undefined, undefined, mcpServers).pipe(
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
  const body = await readJsonObject(c)
  const name = asNonEmptyString(body.name)
  if (!name) return badRequest(c, "name is required")
  return runEffect(c, Effect.flatMap(SessionRepo, (repo) => repo.rename(c.req.param("id"), name)))
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
app.get("/:id/conversation", async (c) => runEffect(c,
  Effect.flatMap(SessionRepo, (repo) => repo.getConversation(c.req.param("id")))
))

// GET /sessions/:id/token-usage — aggregate token usage for the session
app.get("/:id/token-usage", async (c) => runEffect(c,
  Effect.flatMap(SessionRepo, (repo) => repo.getSessionTokenUsage(c.req.param("id")))
))

// POST /sessions/:id/prompt — send a prompt to the agent
app.post("/:id/prompt", async (c) => {
  const body = await readJsonObject(c)
  const parsed = parsePromptBlocks(body)
  if (!parsed.ok) return badRequest(c, parsed.error)
  return runEffect(c, Effect.flatMap(AcpClient, (acp) => acp.prompt(c.req.param("id"), parsed.blocks)))
})

// POST /sessions/:id/permission — respond to a permission request
app.post("/:id/permission", async (c) => {
  const body = await readJsonObject(c)
  const requestId = asNonEmptyString(body.requestId)
  const optionId = asNonEmptyString(body.optionId)
  if (!requestId || !optionId) return badRequest(c, "requestId and optionId are required")
  await AppRuntime.runPromise(
    Effect.flatMap(AcpClient, (acp) => acp.respondToPermission(c.req.param("id"), requestId, optionId))
  )
  return c.body(null, 204)
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
  const body = await readJsonObject(c)
  const configId = asNonEmptyString(body.configId)
  const value = asString(body.value)
  if (!configId || value === undefined) return badRequest(c, "configId and value are required")
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
// CORS: in dev the Next.js frontend (port 6767) connects directly here
// because Next.js rewrites buffer SSE responses.
app.get("/:id/events", (c) => {
  const origin = c.req.header("Origin")
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin)
  }

  const id = c.req.param("id")

  // SSE standard: EventSource sends Last-Event-ID on auto-reconnect
  const afterEventId = parseLastEventId(c.req.header("Last-Event-ID"))

  return streamSSE(c, async (stream) => {
    const { subscriberId, stream: eventStream, prompting, assistantTurnId, latestEventId, replayGap } =
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
        replayGap,
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
  const body = await readJsonObject(c)
  const bodyAgentType = asOptionalString(body.agent_type)
  const bodyCwd = asOptionalString(body.cwd)
  const authMethodId = asOptionalString(body.authMethodId)
  const mcpServers = Array.isArray(body.mcpServers) ? body.mcpServers as Array<Record<string, unknown>> : undefined
  const id = c.req.param("id")
  return runEffect(c, Effect.gen(function* () {
    const repo = yield* SessionRepo
    const acp = yield* AcpClient
    const session = bodyAgentType && bodyCwd
      ? yield* repo.updateConfig(id, bodyAgentType, bodyCwd)
      : yield* repo.get(id)

    // Resolve MCP servers: body > session > global defaults
    let resolvedMcpServers = mcpServers
    if (!resolvedMcpServers && session.mcp_servers) {
      resolvedMcpServers = safeParse<Array<Record<string, unknown>>>(session.mcp_servers) ?? undefined
    }
    if (!resolvedMcpServers) {
      const globalJson = yield* repo.getSetting("mcp_servers")
      if (globalJson) {
        resolvedMcpServers = safeParse<Array<Record<string, unknown>>>(globalJson) ?? undefined
      }
    }

    acp.ensureBroadcaster(id)
    return yield* acp.connect(id, session.cwd, session.agent_type, session.agent_session_id, authMethodId, resolvedMcpServers)
  }))
})

// GET /sessions/:id/mode — get current mode state
app.get("/:id/mode", async (c) => runEffect(c,
  Effect.flatMap(AcpClient, (acp) => acp.getModes(c.req.param("id")))
))

// POST /sessions/:id/mode — set session mode
app.post("/:id/mode", async (c) => {
  const body = await readJsonObject(c)
  const modeId = asNonEmptyString(body.modeId)
  if (!modeId) return badRequest(c, "modeId is required")
  return runEffect(c,
    Effect.flatMap(AcpClient, (acp) => acp.setMode(c.req.param("id"), modeId))
  )
})

// GET /sessions/:id/agent-sessions — list agent's session history
app.get("/:id/agent-sessions", async (c) => {
  const cwd = c.req.query("cwd")
  return runEffect(c, Effect.flatMap(AcpClient, (acp) => acp.listAgentSessions(c.req.param("id"), cwd)))
})

// DELETE /sessions/:id/connect — disconnect agent
app.delete("/:id/connect", async (c) => {
  await AppRuntime.runPromise(
    Effect.flatMap(AcpClient, (acp) => acp.disconnect(c.req.param("id")))
  )
  return c.body(null, 204)
})

export const sessionsRoutes = app
