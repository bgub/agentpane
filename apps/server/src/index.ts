import { Hono } from "hono"
import { cors } from "hono/cors"
import { bodyLimit } from "hono/body-limit"
import { serve } from "@hono/node-server"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { Effect, Exit } from "effect"
import { AppRuntime } from "./lib/runtime.js"
import { SessionRepo } from "./lib/session-repo.js"
import { sessionsRoutes } from "./routes/sessions.js"

const AUTH_TOKEN = crypto.randomBytes(24).toString("base64url")

// Write auth token to data dir so the Next.js server can read it for SSR
const dataDir = process.env.AGENTPANE_DATA_DIR || path.resolve(import.meta.dirname, "../../..", "data")
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
fs.writeFileSync(path.join(dataDir, ".auth-token"), AUTH_TOKEN)

const ALLOWED_ORIGINS = ["https://agentpane.dev", "https://www.agentpane.dev"]

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true
  try {
    const url = new URL(origin)
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
  } catch {
    return false
  }
}

const app = new Hono()

// Private Network Access: only allow for approved origins
app.use("*", async (c, next) => {
  await next()
  const origin = c.req.header("Origin")
  if (
    c.req.header("Access-Control-Request-Private-Network") === "true" &&
    origin &&
    isAllowedOrigin(origin)
  ) {
    c.header("Access-Control-Allow-Private-Network", "true")
  }
})

app.use(
  "*",
  cors({
    origin: (origin) => (isAllowedOrigin(origin) ? origin : ""),
    allowHeaders: ["Content-Type", "Authorization"],
  })
)

// Auth middleware — skip health check
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next()
  const authHeader = c.req.header("Authorization")
  const queryToken = c.req.query("token")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken
  if (token !== AUTH_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  await next()
})

app.use("*", bodyLimit({
  maxSize: 1024 * 1024, // 1 MB
  onError: (c) => c.json({ error: "Request body too large" }, 413),
}))

app.get("/api/health", (c) => c.json({ app: "agentpane", status: "ok" }))

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

serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`AgentPane server running on http://localhost:${info.port}`)
  console.log(`Open: https://agentpane.dev?token=${AUTH_TOKEN}`)
})
