import { Hono } from "hono"
import { cors } from "hono/cors"
import { serve } from "@hono/node-server"
import { execFile } from "node:child_process"
import { sessionsRoutes } from "./routes/sessions.js"

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
  })
)

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

app.route("/api/sessions", sessionsRoutes)

serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`AgentPane server running on http://localhost:${info.port}`)
})
