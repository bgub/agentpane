interface ProviderInfo {
  readonly id: string
  readonly name: string
  readonly shortLabel: string
  readonly description: string
}

export const PROVIDER_INFO: Record<string, ProviderInfo> = {
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    shortLabel: "CLAUDE",
    description: "Anthropic's agentic coding assistant",
  },
  codex: {
    id: "codex",
    name: "Codex",
    shortLabel: "CODEX",
    description: "OpenAI's coding agent",
  },
}

export const PROVIDERS = Object.values(PROVIDER_INFO)
