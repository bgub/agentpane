"use client"

import { type DragEvent } from "react"
import { useLayout } from "./layout-provider"
import { TabBar } from "./tab-bar"
import { ChatHeader } from "./chat-header"
import { ChatFooter } from "./chat-footer"
import ChatView from "./chat-view"
import { usePaneSession } from "./use-pane-session"

interface PaneViewProps {
  paneId: string
}

export function PaneView({ paneId }: PaneViewProps) {
  const { layout, focusPane, openSessionInPane } = useLayout()
  const pane = layout.panes.find((p) => p.id === paneId)
  const isFocused = layout.focusedPaneId === paneId
  const activeTabSessionId = pane?.activeTabSessionId ?? ""

  const ps = usePaneSession(activeTabSessionId || undefined)

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
        cwd={ps.activeSession?.cwd}
        connected={ps.connected}
        prompting={ps.prompting}
        connecting={ps.connecting}
        configOptions={ps.configOptions}
        onConnect={ps.connectAgent}
        onDisconnect={ps.disconnectAgent}
        onSetConfigOption={ps.setConfigOption}
      />

      <div className="flex-1 min-h-0 relative">
        {ps.activeSession ? (
          <ChatView
            sessionId={ps.activeSession.id}
            connected={ps.connected}
            lastSentPrompt={ps.lastSentPrompt}
            promptError={ps.promptError}
            onPromptingChange={ps.onPromptingChange}
            onConnectionChange={ps.onConnectionChange}
            onConfigOptionsChange={ps.onConfigOptionsChange}
            onAvailableCommandsChange={ps.onAvailableCommandsChange}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--t-muted)] text-sm">
            No session selected. Open one from the sidebar.
          </div>
        )}
      </div>

      <ChatFooter
        sessionId={ps.activeSession?.id ?? null}
        active={!!ps.activeSession}
        prompting={ps.prompting}
        connecting={ps.connecting}
        connected={ps.connected}
        availableCommands={ps.availableCommands}
        onSend={ps.sendPrompt}
        onCancel={ps.cancelPrompt}
        autoFocus={isFocused}
      />
    </div>
  )
}
