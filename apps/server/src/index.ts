import { Hono } from "hono"
import { cors } from "hono/cors"
import { serve } from "@hono/node-server"
import { sessionsRoutes } from "./routes/sessions.js"

const app = new Hono()

// Private Network Access preflight support (public website → localhost)
app.use("*", async (c, next) => {
  if (c.req.header("Access-Control-Request-Private-Network") === "true") {
    c.header("Access-Control-Allow-Private-Network", "true")
  }
  await next()
})

app.use("*", cors({ origin: "*", credentials: true }))

app.get("/api/health", (c) => c.json({ app: "agentpane", status: "ok" }))

app.route("/api/sessions", sessionsRoutes)

serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`AgentPane server running on http://localhost:${info.port}`)
})
