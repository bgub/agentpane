"use client"

import { useSession } from "./session-provider"
import { BackendOfflineScreen } from "./backend-offline-screen"
import { SessionSetupScreen } from "./session-setup-screen"
import ChatView from "./chat-view"

export function MainPanel() {
  const {
    sessions,
    activeSessionId,
    connectedSessionIds,
    backendStatus,
    showSetup,
    onPromptingChange,
    onConnectionChange,
  } = useSession()

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  return (
    <div className="flex-1 min-w-0 min-h-0 relative">
      {backendStatus === "offline" ? (
        <BackendOfflineScreen />
      ) : showSetup ? (
        <SessionSetupScreen />
      ) : activeSession ? (
        <ChatView
          key={activeSession.id}
          sessionId={activeSession.id}
          cwd={activeSession.cwd}
          agentType={activeSession.agent_type}
          connected={connectedSessionIds.has(activeSession.id)}
          onPromptingChange={onPromptingChange}
          onConnectionChange={onConnectionChange}
        />
      ) : backendStatus === "checking" ? (
        <div className="h-full bg-[var(--t-bg)]" />
      ) : (
        <div className="flex h-full items-center justify-center text-[var(--t-muted)] text-sm bg-[var(--t-bg)]">
          No sessions. Click + to create one.
        </div>
      )}
    </div>
  )
}
