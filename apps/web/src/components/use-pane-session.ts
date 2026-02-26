import { useState, useEffect, useRef } from "react"
import { useSession } from "./session-provider"
import { api } from "@/lib/api"
import type { ConfigOption, AvailableCommand } from "./chat-view/types"
import type { Session, AuthMethod, SessionModesState } from "@/lib/types"

interface PaneSessionState {
  activeSession: Session | undefined
  connected: boolean
  prompting: boolean
  connecting: boolean
  lastSentPrompt: { text: string; ts: number } | null
  promptError: { message: string; ts: number } | null
  configOptions: ConfigOption[]
  availableCommands: AvailableCommand[]
  pendingAuthMethods: AuthMethod[]
  modes: SessionModesState | null
  connectAgent: () => Promise<void>
  authenticateAndConnect: (methodId: string) => Promise<void>
  disconnectAgent: () => Promise<void>
  sendPrompt: (text: string) => Promise<void>
  cancelPrompt: () => void
  setConfigOption: (configId: string, value: string) => Promise<void>
  setMode: (modeId: string) => Promise<void>
  onConfigOptionsChange: (opts: ConfigOption[]) => void
  onAvailableCommandsChange: (cmds: AvailableCommand[]) => void
  onModesChange: (modes: SessionModesState | null) => void
}

export function usePaneSession(sessionId: string | undefined): PaneSessionState {
  const { sessions } = useSession()

  const activeSession = sessions.find((s) => s.id === sessionId)
  const connected = !!activeSession?.connected
  const prompting = !!activeSession?.prompting

  const [connecting, setConnecting] = useState(false)
  const [lastSentPrompt, setLastSentPrompt] = useState<{ text: string; ts: number } | null>(null)
  const [promptError, setPromptError] = useState<{ message: string; ts: number } | null>(null)
  const [configOptions, setConfigOptions] = useState<ConfigOption[]>([])
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([])
  const [pendingAuthMethods, setPendingAuthMethods] = useState<AuthMethod[]>([])
  const [modes, setModes] = useState<SessionModesState | null>(null)
  const configOptionsRef = useRef(configOptions)
  configOptionsRef.current = configOptions

  // Clear transient state when session changes
  useEffect(() => {
    void sessionId
    setConnecting(false)
    setLastSentPrompt(null)
    setPromptError(null)
    setConfigOptions([])
    setAvailableCommands([])
    setPendingAuthMethods([])
    setModes(null)
  }, [sessionId])

  // Returns true if connected successfully, false on error
  const attemptConnect = async (session: Session, authMethodId?: string): Promise<boolean> => {
    setConnecting(true)
    try {
      const body: { agent_type: string; cwd: string; authMethodId?: string } = {
        agent_type: session.agent_type,
        cwd: session.cwd,
      }
      if (authMethodId) body.authMethodId = authMethodId
      const res = await api.sessions.connect(session.id, body)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Connection failed" })) as {
          error?: string
          authMethods?: AuthMethod[]
        }
        if (res.status === 401 && Array.isArray(err.authMethods)) {
          setPendingAuthMethods(err.authMethods)
          setPromptError({ message: `Error: ${err.error ?? "Authentication required"}`, ts: Date.now() })
        } else {
          setPendingAuthMethods([])
          setPromptError({ message: `Error: ${err.error ?? "Connection failed"}`, ts: Date.now() })
        }
        return false
      }
      setPendingAuthMethods([])
      return true
    } catch {
      setPendingAuthMethods([])
      setPromptError({ message: "Error: Failed to connect agent", ts: Date.now() })
      return false
    } finally {
      setConnecting(false)
    }
  }

  const connectAgent = async () => {
    if (!activeSession || connecting) return
    await attemptConnect(activeSession)
  }

  const authenticateAndConnect = async (methodId: string) => {
    if (!activeSession || connecting || !methodId) return
    await attemptConnect(activeSession, methodId)
  }

  const disconnectAgent = async () => {
    if (!activeSession) return
    await api.sessions.disconnect(activeSession.id).catch(() => {})
  }

  const setConfigOption = async (configId: string, value: string) => {
    if (!activeSession) return
    const prev = configOptionsRef.current
    setConfigOptions(prev.map((opt) =>
      opt.id === configId ? { ...opt, currentValue: value } : opt
    ))
    try {
      const res = await api.sessions.setConfig(activeSession.id, configId, value)
      if (res.ok) {
        const updated = await res.json() as ConfigOption[]
        setConfigOptions(updated)
      } else {
        setConfigOptions(prev)
      }
    } catch {
      setConfigOptions(prev)
    }
  }

  const setMode = async (modeId: string) => {
    if (!activeSession) return
    const prev = modes
    setModes((old) => ({ ...(old ?? {}), currentModeId: modeId }))
    try {
      const res = await api.sessions.setMode(activeSession.id, modeId)
      if (res.ok) {
        const updated = await res.json() as SessionModesState | null
        setModes(updated)
      } else {
        setModes(prev)
      }
    } catch {
      setModes(prev)
    }
  }

  const cancelPrompt = () => {
    if (!activeSession) return
    api.sessions.cancel(activeSession.id).catch(() => {})
  }

  const sendPrompt = async (text: string) => {
    if (!activeSession || prompting) return

    setLastSentPrompt({ text, ts: Date.now() })

    if (!connected) {
      const ok = await attemptConnect(activeSession)
      if (!ok) return
    }

    try {
      const res = await api.sessions.prompt(activeSession.id, text)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }))
        setPromptError({ message: `Error: ${err.error}`, ts: Date.now() })
      }
    } catch {
      setPromptError({ message: "Error: Network error", ts: Date.now() })
    }
  }

  const activeSessionId = activeSession?.id
  useEffect(() => {
    if (!activeSessionId || !connected) return
    api.sessions.mode(activeSessionId)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json() as SessionModesState | null
        setModes(data)
      })
      .catch(() => {})
  }, [activeSessionId, connected])

  return {
    activeSession,
    connected,
    prompting,
    connecting,
    lastSentPrompt,
    promptError,
    configOptions,
    availableCommands,
    pendingAuthMethods,
    modes,
    connectAgent,
    authenticateAndConnect,
    disconnectAgent,
    sendPrompt,
    cancelPrompt,
    setConfigOption,
    setMode,
    onConfigOptionsChange: setConfigOptions,
    onAvailableCommandsChange: setAvailableCommands,
    onModesChange: setModes,
  }
}
