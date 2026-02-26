export const dynamic = "force-dynamic"

import type { Metadata } from "next"
export const metadata: Metadata = { title: "AgentPane", description: "Web interface for AI coding agents" }

import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import { getQueryClient } from "@/lib/get-query-client"
import { queryKeys } from "@/lib/queries"
import { parseLayout } from "@/lib/layout-utils"
import type { Session } from "@/lib/types"
import type { LayoutState } from "@/lib/layout-types"
import App from "@/App"

const API = "http://localhost:3456"

function resolveActiveSessionId(sessions: Session[], layout: LayoutState | null): string | null {
  if (layout) {
    const focused = layout.panes.find((p) => p.id === layout.focusedPaneId)
    if (focused?.activeTabSessionId) return focused.activeTabSessionId
  }
  return sessions[0]?.id ?? null
}

export default async function Page() {
  const queryClient = getQueryClient()

  // Prefetch sessions
  await queryClient.prefetchQuery({
    queryKey: queryKeys.sessions,
    queryFn: async () => {
      const res = await fetch(`${API}/api/sessions`, { cache: "no-store" })
      if (!res.ok) return []
      return res.json() as Promise<Session[]>
    },
  })
  const sessions = queryClient.getQueryData<Session[]>(queryKeys.sessions) ?? []

  // Fetch layout setting (not a React Query concern — it's app config)
  let parsedLayout: LayoutState | null = null
  try {
    const res = await fetch(`${API}/api/settings/layout`, { cache: "no-store" })
    if (res.ok) {
      const data = (await res.json()) as { value?: string }
      if (data?.value) {
        const sessionIds = new Set(sessions.map((s) => s.id))
        parsedLayout = parseLayout(data.value, sessionIds)
      }
    }
  } catch { /* API not available */ }

  const activeSessionId = resolveActiveSessionId(sessions, parsedLayout)

  // Prefetch conversations for visible pane sessions
  const sessionIds = new Set(sessions.map((s) => s.id))
  const visibleIds = new Set<string>()
  if (parsedLayout) {
    for (const pane of parsedLayout.panes) {
      if (pane.activeTabSessionId && sessionIds.has(pane.activeTabSessionId)) {
        visibleIds.add(pane.activeTabSessionId)
      }
    }
  }
  if (visibleIds.size === 0 && sessions.length > 0) {
    visibleIds.add(sessions[0].id)
  }

  await Promise.all(
    [...visibleIds].map((id) =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.conversation(id),
        queryFn: async () => {
          const res = await fetch(`${API}/api/sessions/${id}/conversation`, { cache: "no-store" })
          if (!res.ok) return []
          return res.json() as Promise<unknown[]>
        },
      }),
    ),
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <App initialLayout={parsedLayout} initialActiveSessionId={activeSessionId} />
    </HydrationBoundary>
  )
}
