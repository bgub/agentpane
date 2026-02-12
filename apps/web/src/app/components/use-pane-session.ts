"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useSession } from "./session-provider"
import { api } from "@/lib/api"
import type { ConfigOption, AvailableCommand } from "./chat-view"
import type { Session } from "@/lib/types"

export interface PaneSessionState {
  activeSession: Session | undefined
  connected: boolean
  prompting: boolean
  connecting: boolean
  lastSentPrompt: { text: string; ts: number } | null
  promptError: { message: string; ts: number } | null
  configOptions: ConfigOption[]
  availableCommands: AvailableCommand[]
  connectAgent: () => Promise<void>
  disconnectAgent: () => Promise<void>
  sendPrompt: (text: string) => Promise<void>
  cancelPrompt: () => void
  setConfigOption: (configId: string, value: string) => Promise<void>
  onConfigOptionsChange: (opts: ConfigOption[]) => void
  onAvailableCommandsChange: (cmds: AvailableCommand[]) => void
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
  const configOptionsRef = useRef(configOptions)
  configOptionsRef.current = configOptions

  // Clear transient state when session changes
  useEffect(() => {
    setConnecting(false)
    setLastSentPrompt(null)
    setPromptError(null)
    setConfigOptions([])
    setAvailableCommands([])
  }, [sessionId])

  const connectAgent = useCallback(async () => {
    if (!activeSession || connecting) return
    setConnecting(true)
    try {
      const res = await api.sessions.connect(activeSession.id, {
        agent_type: activeSession.agent_type,
        cwd: activeSession.cwd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Connection failed" }))
        setPromptError({ message: `Error: ${err.error}`, ts: Date.now() })
      }
    } catch {
      setPromptError({ message: "Error: Failed to connect agent", ts: Date.now() })
    } finally {
      setConnecting(false)
    }
  }, [activeSession, connecting])

  const disconnectAgent = useCallback(async () => {
    if (!activeSession) return
    await api.sessions.disconnect(activeSession.id).catch(() => {})
  }, [activeSession])

  const onConfigOptionsChange = useCallback((opts: ConfigOption[]) => {
    setConfigOptions(opts)
  }, [])

  const onAvailableCommandsChange = useCallback((cmds: AvailableCommand[]) => {
    setAvailableCommands(cmds)
  }, [])

  const setConfigOption = useCallback(async (configId: string, value: string) => {
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
  }, [activeSession])

  const cancelPrompt = useCallback(() => {
    if (!activeSession) return
    api.sessions.cancel(activeSession.id).catch(() => {})
  }, [activeSession])

  const sendPrompt = useCallback(async (text: string) => {
    if (!activeSession || prompting) return

    setLastSentPrompt({ text, ts: Date.now() })

    if (!connected) {
      setConnecting(true)
      try {
        const res = await api.sessions.connect(activeSession.id, {
          agent_type: activeSession.agent_type,
          cwd: activeSession.cwd,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Connection failed" }))
          setPromptError({ message: `Error: ${err.error}`, ts: Date.now() })
          setConnecting(false)
          return
        }
      } catch {
        setPromptError({ message: "Error: Failed to reconnect agent", ts: Date.now() })
        setConnecting(false)
        return
      }
      setConnecting(false)
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
  }, [activeSession, prompting, connected])

  return {
    activeSession,
    connected,
    prompting,
    connecting,
    lastSentPrompt,
    promptError,
    configOptions,
    availableCommands,
    connectAgent,
    disconnectAgent,
    sendPrompt,
    cancelPrompt,
    setConfigOption,
    onConfigOptionsChange,
    onAvailableCommandsChange,
  }
}
