"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useSession } from "./session-provider"
import { BackendOfflineScreen } from "./backend-offline-screen"
import { SessionSetupScreen } from "./session-setup-screen"
import { ChatHeader } from "./chat-header"
import { ChatFooter } from "./chat-footer"
import ChatView, { type ConfigOption } from "./chat-view"
import { api } from "@/lib/api"

export function MainPanel() {
  const {
    sessions,
    activeSessionId,
    connectedSessionIds,
    promptingSessionIds,
    backendStatus,
    showSetup,
    onPromptingChange,
    onConnectionChange,
  } = useSession()

  const [connecting, setConnecting] = useState(false)
  const [lastSentPrompt, setLastSentPrompt] = useState<{ text: string; ts: number } | null>(null)
  const [promptError, setPromptError] = useState<{ message: string; ts: number } | null>(null)
  const [configOptions, setConfigOptions] = useState<ConfigOption[]>([])
  const configOptionsRef = useRef(configOptions)
  configOptionsRef.current = configOptions

  // Clear per-session transient state when switching sessions
  useEffect(() => {
    setLastSentPrompt(null)
    setPromptError(null)
    setConfigOptions([])
  }, [activeSessionId])

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const connected = activeSession ? connectedSessionIds.has(activeSession.id) : false
  const prompting = activeSession ? promptingSessionIds.has(activeSession.id) : false
  const hasChat = !!activeSession && !showSetup && backendStatus !== "offline"

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

  const handleConfigOptionsChange = useCallback((opts: ConfigOption[]) => {
    setConfigOptions(opts)
  }, [])

  const handleSetConfigOption = useCallback(async (configId: string, value: string) => {
    if (!activeSession) return
    // Optimistic update
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
        // Revert on failure
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

    // Auto-reconnect if disconnected
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

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--t-bg)]">
      <ChatHeader
        cwd={hasChat ? activeSession?.cwd : undefined}
        connected={connected}
        prompting={prompting}
        connecting={connecting}
        configOptions={configOptions}
        onConnect={connectAgent}
        onDisconnect={disconnectAgent}
        onSetConfigOption={handleSetConfigOption}
      />

      <div className="flex-1 min-h-0 relative">
        {backendStatus === "offline" ? (
          <BackendOfflineScreen />
        ) : showSetup ? (
          <SessionSetupScreen />
        ) : activeSession ? (
          <ChatView
            sessionId={activeSession.id}
            connected={connected}
            lastSentPrompt={lastSentPrompt}
            promptError={promptError}
            onPromptingChange={onPromptingChange}
            onConnectionChange={onConnectionChange}
            onConfigOptionsChange={handleConfigOptionsChange}
          />
        ) : backendStatus === "checking" ? null : (
          <div className="flex h-full items-center justify-center text-[var(--t-muted)] text-sm">
            No sessions. Click + to create one.
          </div>
        )}
      </div>

      <ChatFooter
        sessionId={activeSession?.id ?? null}
        active={hasChat}
        prompting={prompting}
        connecting={connecting}
        connected={connected}
        onSend={sendPrompt}
        onCancel={cancelPrompt}
      />
    </div>
  )
}
