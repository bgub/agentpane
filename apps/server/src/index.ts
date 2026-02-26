import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { execFile } from "node:child_process"
import { Effect, Exit } from "effect"
import { serve } from "@hono/node-server"
import { AppRuntime } from "./lib/runtime.js"
import { SessionRepo } from "./lib/session-repo.js"
import { AcpClient } from "./lib/acp-client.js"
import { sessionsRoutes } from "./routes/sessions.js"

const app = new Hono()

app.use("*", bodyLimit({
  maxSize: 10 * 1024 * 1024, // 10 MB (supports image uploads)
  onError: (c) => c.json({ error: "Request body too large" }, 413),
}))

app.get("/api/health", (c) => c.json({ app: "agentpane", status: "ok" }))

app.get("/api/metrics", async (c) => {
  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const acp = yield* AcpClient
      const usage = process.memoryUsage()
      return {
        uptimeSec: Math.round(process.uptime()),
        memory: {
          rss: usage.rss,
          heapTotal: usage.heapTotal,
          heapUsed: usage.heapUsed,
          external: usage.external,
          arrayBuffers: usage.arrayBuffers,
        },
        acp: acp.stats(),
      }
    })
  )
  return Exit.match(exit, {
    onFailure: () => c.json({ error: "Internal error" }, 500),
    onSuccess: (value) => c.json(value),
  })
})

app.get("/api/git-branch", async (c) => {
  const cwd = c.req.query("cwd")
  if (!cwd) return c.json({ error: "cwd is required" }, 400)
  const home = process.env.HOME || "/"
  const resolved = cwd === "~" ? home : cwd.startsWith("~/") ? home + cwd.slice(1) : cwd
  try {
    const branch = await new Promise<string>((resolve, reject) =>
      execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: resolved }, (err, stdout) =>
        err ? reject(err) : resolve(stdout.trim())
      )
    )
    return c.json({ branch })
  } catch {
    return c.json({ branch: null })
  }
})

app.get("/api/settings/:key", async (c) => {
  const key = c.req.param("key")
  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      return yield* repo.getSetting(key)
    })
  )
  return Exit.match(exit, {
    onFailure: () => c.json({ error: "Internal error" }, 500),
    onSuccess: (value) => value !== null ? c.json({ value }) : c.json({ error: "Not found" }, 404),
  })
})

app.put("/api/settings/:key", async (c) => {
  const key = c.req.param("key")
  const body = await c.req.json<{ value: string }>()
  if (typeof body.value !== "string") return c.json({ error: "value is required" }, 400)
  const exit = await AppRuntime.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      yield* repo.setSetting(key, body.value)
    })
  )
  return Exit.match(exit, {
    onFailure: () => c.json({ error: "Internal error" }, 500),
    onSuccess: () => c.body(null, 204),
  })
})

app.route("/api/sessions", sessionsRoutes)

const server = serve({ fetch: app.fetch, port: 3456 })
// Prevent Node.js default 5-minute timeout from killing SSE connections
const httpServer = server as unknown as import("node:http").Server
httpServer.requestTimeout = 0
httpServer.headersTimeout = 0
console.log("AgentPane running on http://localhost:3456")
