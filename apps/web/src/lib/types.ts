export interface Session {
  id: string
  name: string
  cwd: string
  agent_type: string
  agent_session_id: string | null
  created_at: number
  connected?: boolean
  prompting?: boolean
}

export interface SessionTokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  provider_turns: number
  estimated_turns: number
  tokenized_turns: number
}

export interface AuthMethod {
  id: string
  name: string
  description?: string
}

export interface SessionMode {
  modeId: string
  name: string
  description?: string
}

export interface SessionModesState {
  currentModeId?: string
  modes?: SessionMode[]
}

export interface PromptCapabilities {
  image?: boolean
  resourceLinks?: boolean
}

export interface McpCapabilities {
  supported?: boolean
}

export type McpServer =
  | { name: string; type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { name: string; type: "http"; url: string }
  | { name: string; type: "sse"; url: string }
