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
