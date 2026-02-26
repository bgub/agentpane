import { type DragEvent } from "react"
import { DRAG_TYPES, parseDragData } from "@/lib/constants"
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
    if (!e.dataTransfer.types.includes(DRAG_TYPES.sidebarSession)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }

  const handlePaneDrop = (e: DragEvent) => {
    const data = parseDragData<{ sessionId: string }>(e, DRAG_TYPES.sidebarSession)
    if (!data) return
    e.preventDefault()
    openSessionInPane(paneId, data.sessionId)
  }

  return (
    <div
      role="group"
      className="flex flex-col h-full min-w-0 min-h-0 bg-[var(--t-bg)]"
      onClick={() => focusPane(paneId)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) focusPane(paneId) }}
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
        pendingAuthMethods={ps.pendingAuthMethods}
        modes={ps.modes}
        onConnect={ps.connectAgent}
        onAuthenticateAndConnect={ps.authenticateAndConnect}
        onDisconnect={ps.disconnectAgent}
        onSetConfigOption={ps.setConfigOption}
        onSetMode={ps.setMode}
      />

      <div className="flex-1 min-h-0 relative">
        {ps.activeSession ? (
          <ChatView
            key={ps.activeSession.id}
            sessionId={ps.activeSession.id}
            lastSentPrompt={ps.lastSentPrompt}
            promptError={ps.promptError}
            onConfigOptionsChange={ps.onConfigOptionsChange}
            onAvailableCommandsChange={ps.onAvailableCommandsChange}
            onModesChange={ps.onModesChange}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--t-muted)] text-sm">
            No session selected. Open one from the sidebar.
          </div>
        )}
      </div>

      <ChatFooter
        key={ps.activeSession?.id ?? "empty"}
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
