"use client"

import { useState, useCallback, useEffect, useRef, type DragEvent } from "react"
import { useSession } from "./session-provider"
import { useLayout } from "./layout-provider"
import { TabBar } from "./tab-bar"
import { ChatHeader } from "./chat-header"
import { ChatFooter } from "./chat-footer"
import ChatView, { type ConfigOption, type AvailableCommand } from "./chat-view"
import { api } from "@/lib/api"

interface PaneViewProps {
  paneId: string
}

export function PaneView({ paneId }: PaneViewProps) {
  const {
    sessions,
    connectedSessionIds,
    promptingSessionIds,
    onPromptingChange,
    onConnectionChange,
  } = useSession()

  const { layout, focusPane, openSessionInPane } = useLayout()
  const pane = layout.panes.find((p) => p.id === paneId)
  const isFocused = layout.focusedPaneId === paneId
  const activeTabSessionId = pane?.activeTabSessionId ?? ""
  const activeSession = sessions.find((s) => s.id === activeTabSessionId)

  const [connecting, setConnecting] = useState(false)
  const [lastSentPrompt, setLastSentPrompt] = useState<{ text: string; ts: number } | null>(null)
  const [promptError, setPromptError] = useState<{ message: string; ts: number } | null>(null)
  const [configOptions, setConfigOptions] = useState<ConfigOption[]>([])
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([])
  const configOptionsRef = useRef(configOptions)
  configOptionsRef.current = configOptions

  // Clear per-session transient state when active tab changes
  useEffect(() => {
    setConnecting(false)
    setLastSentPrompt(null)
    setPromptError(null)
    setConfigOptions([])
    setAvailableCommands([])
  }, [activeTabSessionId])

  const connected = activeSession ? connectedSessionIds.has(activeSession.id) : false
  const prompting = activeSession ? promptingSessionIds.has(activeSession.id) : false
  const hasChat = !!activeSession

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

  const handleAvailableCommandsChange = useCallback((cmds: AvailableCommand[]) => {
    setAvailableCommands(cmds)
  }, [])

  const handleSetConfigOption = useCallback(async (configId: string, value: string) => {
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

  const handlePaneDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-sidebar-session")) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }

  const handlePaneDrop = (e: DragEvent) => {
    const raw = e.dataTransfer.getData("application/x-sidebar-session")
    if (!raw) return
    e.preventDefault()
    try {
      const data = JSON.parse(raw) as { sessionId: string }
      openSessionInPane(paneId, data.sessionId)
    } catch { /* ignore */ }
  }

  return (
    <div
      className="flex flex-col h-full min-w-0 min-h-0 bg-[var(--t-bg)]"
      onClick={() => focusPane(paneId)}
      onDragOver={handlePaneDragOver}
      onDrop={handlePaneDrop}
    >
      <TabBar
        paneId={paneId}
        tabSessionIds={pane?.tabSessionIds ?? []}
        activeTabSessionId={activeTabSessionId}
        isFocused={isFocused}
      />

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
        {activeSession ? (
          <ChatView
            sessionId={activeSession.id}
            connected={connected}
            lastSentPrompt={lastSentPrompt}
            promptError={promptError}
            onPromptingChange={onPromptingChange}
            onConnectionChange={onConnectionChange}
            onConfigOptionsChange={handleConfigOptionsChange}
            onAvailableCommandsChange={handleAvailableCommandsChange}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--t-muted)] text-sm">
            No session selected. Open one from the sidebar.
          </div>
        )}
      </div>

      <ChatFooter
        sessionId={activeSession?.id ?? null}
        active={hasChat}
        prompting={prompting}
        connecting={connecting}
        connected={connected}
        availableCommands={availableCommands}
        onSend={sendPrompt}
        onCancel={cancelPrompt}
        autoFocus={isFocused}
      />
    </div>
  )
}
