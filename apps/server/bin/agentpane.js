#!/usr/bin/env node
import { fork } from "node:child_process"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { join } from "node:path"

process.env.AGENTPANE_DATA_DIR ||= join(homedir(), ".agentpane")

// Start API server on :3456
import "../dist/index.js"

// Start Next.js server on :6767
const webDir = resolve(import.meta.dirname, "../web/apps/web")
fork(resolve(webDir, "server.js"), {
  env: { ...process.env, PORT: "6767", HOSTNAME: "0.0.0.0" },
  cwd: webDir,
})
