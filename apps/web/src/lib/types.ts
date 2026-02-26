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
