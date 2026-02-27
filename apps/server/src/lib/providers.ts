import fs from "node:fs"
import path from "node:path"

export interface Provider {
  readonly id: string
  readonly name: string
  readonly bin: string
}

export const PROVIDERS: Record<string, Provider> = {
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    bin: "claude-agent-acp",
  },
  codex: {
    id: "codex",
    name: "Codex",
    bin: "codex-acp",
  },
}

export const DEFAULT_PROVIDER = "claude-code"

// Resolve relative to the server package root (apps/server/), not process.cwd()
const packageRoot = path.resolve(import.meta.dirname, "../..")

export function resolveProviderBin(agentType: string): string {
  const provider = PROVIDERS[agentType]
  if (!provider) {
    throw new Error(`Unknown provider: ${agentType}`)
  }
  if (path.isAbsolute(provider.bin)) {
    return provider.bin
  }
  // Walk up from package root to find the binary in node_modules/.bin/
  // Handles both dev (apps/server/node_modules/.bin/) and installed (hoisted to consumer's node_modules/.bin/)
  let dir = packageRoot
  while (true) {
    const candidate = path.join(dir, "node_modules", ".bin", provider.bin)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `Could not find "${provider.bin}" binary. Make sure the agent package is installed.`
  )
}
