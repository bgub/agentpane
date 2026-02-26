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
    bin: "node_modules/.bin/claude-agent-acp",
  },
  codex: {
    id: "codex",
    name: "Codex",
    bin: "node_modules/.bin/codex-acp",
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
  return path.resolve(packageRoot, provider.bin)
}
