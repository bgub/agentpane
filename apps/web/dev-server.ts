import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import type { IncomingMessage, ServerResponse } from "node:http"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  })

  const ssrHandler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || "/"

    // Let Vite handle asset requests
    if (url.startsWith("/@") || url.startsWith("/src/") || url.startsWith("/node_modules/") || url.includes(".")) {
      return next()
    }

    try {
      let template = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf-8")
      template = await vite.transformIndexHtml(url, template)

      // Fetch data from backend API (may fail if Hono not running yet)
      const [sessions, layoutRaw] = await Promise.all([
        fetch("http://localhost:3456/api/sessions").then((r) => r.json()).catch(() => []),
        fetch("http://localhost:3456/api/settings/layout").then((r) => r.json()).then((d: { value?: string }) => d.value ?? null).catch(() => null),
      ])

      const { render } = await vite.ssrLoadModule("/src/entry-server.tsx") as { render: (data: { sessions: unknown[]; layout: string | null }) => { html: string; initialState: unknown } }
      const { html: appHtml, initialState } = render({ sessions, layout: layoutRaw })

      const page = template
        .replace("<!--ssr-outlet-->", appHtml)
        .replace("<!--ssr-data-->", `<script>window.__SSR_DATA__=${JSON.stringify(initialState)}</script>`)

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(page)
    } catch (e) {
      vite.ssrFixStacktrace(e as Error)
      console.error(e)
      next()
    }
  }

  // Vite middleware handles HMR, static files, and proxied /api requests
  // SSR handler catches page requests that fall through
  const server = http.createServer((req, res) => {
    vite.middlewares(req, res, () => {
      ssrHandler(req, res, () => {
        res.writeHead(404)
        res.end("Not found")
      })
    })
  })

  const port = 6767
  server.listen(port, () => {
    console.log(`Dev server running on http://localhost:${port}`)
  })
}

main()
