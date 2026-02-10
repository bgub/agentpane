import { Hono } from "hono"
import { cors } from "hono/cors"
import { serve } from "@hono/node-server"
import { sessionsRoutes } from "./routes/sessions.js"

const app = new Hono()

app.use("*", cors({ origin: "*", credentials: true }))

// All session routes are mounted under /api/sessions
// The sessionsRoutes handler includes all sub-routes (:id/prompt, :id/events, etc.)
app.route("/api/sessions", sessionsRoutes)

serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`Acapa server running on http://localhost:${info.port}`)
})
