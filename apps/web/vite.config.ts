import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig(({ command }) => ({
  plugins: [
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 6767,
    proxy: {
      "/api": "http://localhost:3456",
    },
  },
  ssr: {
    // Bundle all deps into SSR output so it runs standalone in apps/server.
    // Only in build — in dev, ssrLoadModule handles resolution and CJS interop.
    noExternal: command === "build",
  },
}))
