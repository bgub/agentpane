import fs from "node:fs"
import path from "node:path"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { execFile } from "node:child_process"
import { Effect, Exit } from "effect"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { AppRuntime } from "./lib/runtime.js"
import { SessionRepo } from "./lib/session-repo.js"
import { AcpClient } from "./lib/acp-client.js"
import { sessionsRoutes } from "./routes/sessions.js"

const app = new Hono()

app.use("*", bodyLimit({
  maxSize: 1024 * 1024, // 1 MB
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

// In dev, Vite dev server at :6767 handles frontend + SSR; this server is API-only.
// In production, serve static assets + SSR from the pre-built web bundle.
if (!process.env.AGENTPANE_DEV) {
  const clientRoot = path.resolve(import.meta.dirname, "../web/client")
  app.use("/*", serveStatic({ root: clientRoot }))

  const template = fs.readFileSync(path.resolve(clientRoot, "index.html"), "utf-8")
  const ssrModule = await import(path.resolve(import.meta.dirname, "../web/server/entry-server.js")) as {
    render: (data: { sessions: unknown[]; layout: string | null }) => { html: string; initialState: unknown }
  }

  app.get("/*", async (c) => {
    try {
      const { sessions, layout } = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const repo = yield* SessionRepo
          const acp = yield* AcpClient
          const rawSessions = yield* repo.list()
          const connected = acp.connectedSessionIds()
          const prompting = acp.promptingSessionIds()
          const sessions = rawSessions.map((s) => ({
            ...s,
            connected: connected.has(s.id),
            prompting: prompting.has(s.id),
          }))
          const layout = yield* repo.getSetting("layout")
          return { sessions, layout }
        })
      )
      const { html: appHtml, initialState } = ssrModule.render({ sessions, layout })
      const page = template
        .replace("<!--ssr-outlet-->", appHtml)
        .replace("<!--ssr-data-->", `<script>window.__SSR_DATA__=${JSON.stringify(initialState)}</script>`)
      return c.html(page)
    } catch {
      return c.html(template)
    }
  })
}

const server = serve({ fetch: app.fetch, port: 3456 })
// Prevent Node.js default 5-minute timeout from killing SSE connections
const httpServer = server as unknown as import("node:http").Server
httpServer.requestTimeout = 0
httpServer.headersTimeout = 0
console.log("AgentPane running on http://localhost:3456")
