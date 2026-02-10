import { Hono } from "hono"
import { cors } from "hono/cors"
import { serve } from "@hono/node-server"
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

app.route("/api/sessions", sessionsRoutes)

serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`AgentPane server running on http://localhost:${info.port}`)
})
