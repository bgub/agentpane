import { Hono } from "hono"
import { cors } from "hono/cors"
import { serve } from "@hono/node-server"
import { execFile } from "node:child_process"
import { sessionsRoutes } from "./routes/sessions.js"

const app = new Hono()

// Private Network Access: must wrap CORS so the header lands on the preflight response
app.use("*", async (c, next) => {
  await next()
  if (c.req.header("Access-Control-Request-Private-Network") === "true") {
    c.header("Access-Control-Allow-Private-Network", "true")
  }
})

app.use("*", cors({ origin: "*" }))

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
