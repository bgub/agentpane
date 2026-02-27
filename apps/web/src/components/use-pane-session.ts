import { useReducer, useEffect, useRef } from "react"
import { useSession } from "./session-provider"
import { api, type PromptInputBlock } from "@/lib/api"
import type { ConfigOption, AvailableCommand, UsageState } from "./chat-view/types"
import type { Session, AuthMethod, SessionModesState, PromptCapabilities, McpCapabilities } from "@/lib/types"

interface TransientState {
  connecting: boolean
  lastSentPrompt: { text: string; ts: number } | null
  promptError: { message: string; ts: number } | null
  configOptions: ConfigOption[]
  availableCommands: AvailableCommand[]
  pendingAuthMethods: AuthMethod[]
  modes: SessionModesState | null
  promptCapabilities: PromptCapabilities
  mcpCapabilities: McpCapabilities
  usageUpdate: UsageState | null
}

type Action =
  | { type: "RESET" }
  | { type: "SET_CONNECTING"; value: boolean }
  | { type: "SET_LAST_SENT_PROMPT"; value: { text: string; ts: number } }
  | { type: "SET_PROMPT_ERROR"; value: { message: string; ts: number } }
  | { type: "SET_CONFIG_OPTIONS"; value: ConfigOption[] }
  | { type: "SET_AVAILABLE_COMMANDS"; value: AvailableCommand[] }
  | { type: "SET_PENDING_AUTH_METHODS"; value: AuthMethod[] }
  | { type: "SET_MODES"; value: SessionModesState | null }
  | { type: "UPDATE_MODE"; modeId: string }
  | { type: "SET_PROMPT_CAPABILITIES"; value: PromptCapabilities }
  | { type: "SET_MCP_CAPABILITIES"; value: McpCapabilities }
  | { type: "SET_USAGE_UPDATE"; value: UsageState | null }
  | { type: "CONNECT_ERROR"; promptError: { message: string; ts: number }; authMethods?: AuthMethod[] }

const INITIAL_STATE: TransientState = {
  connecting: false,
  lastSentPrompt: null,
  promptError: null,
  configOptions: [],
  availableCommands: [],
  pendingAuthMethods: [],
  modes: null,
  promptCapabilities: {},
  mcpCapabilities: {},
  usageUpdate: null,
}

function reducer(state: TransientState, action: Action): TransientState {
  switch (action.type) {
    case "RESET":
      return INITIAL_STATE
    case "SET_CONNECTING":
      return { ...state, connecting: action.value }
    case "SET_LAST_SENT_PROMPT":
      return { ...state, lastSentPrompt: action.value }
    case "SET_PROMPT_ERROR":
      return { ...state, promptError: action.value }
    case "SET_CONFIG_OPTIONS":
      return { ...state, configOptions: action.value }
    case "SET_AVAILABLE_COMMANDS":
      return { ...state, availableCommands: action.value }
    case "SET_PENDING_AUTH_METHODS":
      return { ...state, pendingAuthMethods: action.value }
    case "SET_MODES":
      return { ...state, modes: action.value }
    case "UPDATE_MODE":
      return { ...state, modes: { ...(state.modes ?? {}), currentModeId: action.modeId } }
    case "SET_PROMPT_CAPABILITIES":
      return { ...state, promptCapabilities: action.value }
    case "SET_MCP_CAPABILITIES":
      return { ...state, mcpCapabilities: action.value }
    case "SET_USAGE_UPDATE":
      return { ...state, usageUpdate: action.value }
    case "CONNECT_ERROR":
      return {
        ...state,
        pendingAuthMethods: action.authMethods ?? [],
        promptError: action.promptError,
      }
  }
}

export interface PaneSessionState {
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
  promptCapabilities: PromptCapabilities
  mcpCapabilities: McpCapabilities
  usageUpdate: UsageState | null
  connectAgent: () => Promise<void>
  authenticateAndConnect: (methodId: string) => Promise<void>
  disconnectAgent: () => Promise<void>
  sendPrompt: (text: string, blocks?: PromptInputBlock[]) => Promise<void>
  cancelPrompt: () => void
  setConfigOption: (configId: string, value: string) => Promise<void>
  setMode: (modeId: string) => Promise<void>
  onConfigOptionsChange: (opts: ConfigOption[]) => void
  onAvailableCommandsChange: (cmds: AvailableCommand[]) => void
  onModesChange: (modes: SessionModesState | null) => void
  onPromptCapabilitiesChange: (caps: PromptCapabilities) => void
  onMcpCapabilitiesChange: (caps: McpCapabilities) => void
  onUsageUpdate: (usage: UsageState | null) => void
}

export function usePaneSession(sessionId: string | undefined): PaneSessionState {
  const { sessions } = useSession()

  const activeSession = sessions.find((s) => s.id === sessionId)
  const connected = !!activeSession?.connected
  const prompting = !!activeSession?.prompting

  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const configOptionsRef = useRef(state.configOptions)
  configOptionsRef.current = state.configOptions

  // Clear transient state when session changes
  useEffect(() => {
    void sessionId
    dispatch({ type: "RESET" })
  }, [sessionId])

  // Returns true if connected successfully, false on error
  const attemptConnect = async (session: Session, authMethodId?: string): Promise<boolean> => {
    dispatch({ type: "SET_CONNECTING", value: true })
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
          dispatch({
            type: "CONNECT_ERROR",
            promptError: { message: `Error: ${err.error ?? "Authentication required"}`, ts: Date.now() },
            authMethods: err.authMethods,
          })
        } else {
          dispatch({
            type: "CONNECT_ERROR",
            promptError: { message: `Error: ${err.error ?? "Connection failed"}`, ts: Date.now() },
          })
        }
        return false
      }
      dispatch({ type: "SET_PENDING_AUTH_METHODS", value: [] })
      return true
    } catch {
      dispatch({
        type: "CONNECT_ERROR",
        promptError: { message: "Error: Failed to connect agent", ts: Date.now() },
      })
      return false
    } finally {
      dispatch({ type: "SET_CONNECTING", value: false })
    }
  }

  const connectAgent = async () => {
    if (!activeSession || state.connecting) return
    await attemptConnect(activeSession)
  }

  const authenticateAndConnect = async (methodId: string) => {
    if (!activeSession || state.connecting || !methodId) return
    await attemptConnect(activeSession, methodId)
  }

  const disconnectAgent = async () => {
    if (!activeSession) return
    await api.sessions.disconnect(activeSession.id).catch(() => {})
  }

  const setConfigOption = async (configId: string, value: string) => {
    if (!activeSession) return
    const prev = configOptionsRef.current
    dispatch({
      type: "SET_CONFIG_OPTIONS",
      value: prev.map((opt) => (opt.id === configId ? { ...opt, currentValue: value } : opt)),
    })
    try {
      const res = await api.sessions.setConfig(activeSession.id, configId, value)
      if (res.ok) {
        const updated = await res.json() as ConfigOption[]
        dispatch({ type: "SET_CONFIG_OPTIONS", value: updated })
      } else {
        dispatch({ type: "SET_CONFIG_OPTIONS", value: prev })
      }
    } catch {
      dispatch({ type: "SET_CONFIG_OPTIONS", value: prev })
    }
  }

  const setMode = async (modeId: string) => {
    if (!activeSession) return
    const prev = state.modes
    dispatch({ type: "UPDATE_MODE", modeId })
    try {
      const res = await api.sessions.setMode(activeSession.id, modeId)
      if (res.ok) {
        const updated = await res.json() as SessionModesState | null
        dispatch({ type: "SET_MODES", value: updated })
      } else {
        dispatch({ type: "SET_MODES", value: prev })
      }
    } catch {
      dispatch({ type: "SET_MODES", value: prev })
    }
  }

  const cancelPrompt = () => {
    if (!activeSession) return
    api.sessions.cancel(activeSession.id).catch(() => {})
  }

  const sendPrompt = async (text: string, blocks?: PromptInputBlock[]) => {
    if (!activeSession || prompting) return

    dispatch({ type: "SET_LAST_SENT_PROMPT", value: { text, ts: Date.now() } })

    if (!connected) {
      const ok = await attemptConnect(activeSession)
      if (!ok) return
    }

    try {
      const body = blocks ? { blocks } : text
      const res = await api.sessions.prompt(activeSession.id, body)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }))
        dispatch({ type: "SET_PROMPT_ERROR", value: { message: `Error: ${err.error}`, ts: Date.now() } })
      }
    } catch {
      dispatch({ type: "SET_PROMPT_ERROR", value: { message: "Error: Network error", ts: Date.now() } })
    }
  }

  const activeSessionId = activeSession?.id
  useEffect(() => {
    if (!activeSessionId || !connected) return
    api.sessions.commands(activeSessionId)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json() as AvailableCommand[]
        dispatch({ type: "SET_AVAILABLE_COMMANDS", value: data })
      })
      .catch(() => {})
    api.sessions.mode(activeSessionId)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json() as SessionModesState | null
        dispatch({ type: "SET_MODES", value: data })
      })
      .catch(() => {})
  }, [activeSessionId, connected])

  return {
    activeSession,
    connected,
    prompting,
    connecting: state.connecting,
    lastSentPrompt: state.lastSentPrompt,
    promptError: state.promptError,
    configOptions: state.configOptions,
    availableCommands: state.availableCommands,
    pendingAuthMethods: state.pendingAuthMethods,
    modes: state.modes,
    promptCapabilities: state.promptCapabilities,
    mcpCapabilities: state.mcpCapabilities,
    usageUpdate: state.usageUpdate,
    connectAgent,
    authenticateAndConnect,
    disconnectAgent,
    sendPrompt,
    cancelPrompt,
    setConfigOption,
    setMode,
    onConfigOptionsChange: (opts: ConfigOption[]) => dispatch({ type: "SET_CONFIG_OPTIONS", value: opts }),
    onAvailableCommandsChange: (cmds: AvailableCommand[]) => dispatch({ type: "SET_AVAILABLE_COMMANDS", value: cmds }),
    onModesChange: (modes: SessionModesState | null) => dispatch({ type: "SET_MODES", value: modes }),
    onPromptCapabilitiesChange: (caps: PromptCapabilities) => dispatch({ type: "SET_PROMPT_CAPABILITIES", value: caps }),
    onMcpCapabilitiesChange: (caps: McpCapabilities) => dispatch({ type: "SET_MCP_CAPABILITIES", value: caps }),
    onUsageUpdate: (usage: UsageState | null) => dispatch({ type: "SET_USAGE_UPDATE", value: usage }),
  }
}
