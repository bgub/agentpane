import { StrictMode } from "react"
import { renderToString } from "react-dom/server"
import { QueryClient, dehydrate } from "@tanstack/react-query"
import App from "./App"
import type { InitialState } from "./App"
import { queryKeys } from "@/lib/queries"
import { parseLayout } from "@/lib/layout-utils"
import type { Session } from "@/lib/types"

function resolveActiveSessionId(sessions: Session[], layout: ReturnType<typeof parseLayout>): string | null {
  if (layout) {
    const focused = layout.panes.find((p) => p.id === layout.focusedPaneId)
    if (focused?.activeTabSessionId) return focused.activeTabSessionId
  }
  return sessions[0]?.id ?? null
}

export function render(data: { sessions: Session[]; layout: string | null }): { html: string; initialState: InitialState } {
  const queryClient = new QueryClient()
  queryClient.setQueryData(queryKeys.sessions, data.sessions)

  const parsedLayout = data.layout
    ? parseLayout(data.layout, new Set(data.sessions.map((s) => s.id)))
    : null
  const activeSessionId = resolveActiveSessionId(data.sessions, parsedLayout)

  const initialState: InitialState = {
    sessions: data.sessions,
    activeSessionId,
    layout: parsedLayout,
    dehydratedQueryState: dehydrate(queryClient),
  }

  const html = renderToString(
    <StrictMode>
      <App initialState={initialState} />
    </StrictMode>
  )

  queryClient.clear()

  return { html, initialState }
}
