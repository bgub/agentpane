import type { Session } from "@/lib/types"
import { API_BASE } from "./constants"

export interface InitialData {
  sessions: Session[]
  conversations: Record<string, unknown[]>
  layout: string | null
}

/** Extract session IDs visible in panes from a serialized layout. */
function visibleSessionIds(layoutJson: string, sessions: Session[]): string[] {
  try {
    const parsed = JSON.parse(layoutJson) as {
      panes?: Array<{ activeTabSessionId?: string }>
    }
    if (!Array.isArray(parsed.panes)) return []
    const sessionSet = new Set(sessions.map((s) => s.id))
    const ids: string[] = []
    for (const p of parsed.panes) {
      if (p.activeTabSessionId && sessionSet.has(p.activeTabSessionId)) {
        ids.push(p.activeTabSessionId)
      }
    }
    return ids
  } catch {
    return []
  }
}

export async function fetchInitialData(authToken?: string | null): Promise<InitialData | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)

  try {
    if (!authToken) return null

    const headers: Record<string, string> = {}
    headers["Authorization"] = `Bearer ${authToken}`
    const opts: RequestInit = { cache: "no-store", signal: controller.signal, headers }

    // Health check (no auth needed, but include headers for consistency)
    const healthRes = await fetch(`${API_BASE}/api/health`, { cache: "no-store", signal: controller.signal })
    const health = await healthRes.json()
    if (health?.app !== "agentpane") return null

    // Fetch sessions + layout in parallel
    const [sessionsRes, layoutRes] = await Promise.all([
      fetch(`${API_BASE}/api/sessions`, opts),
      fetch(`${API_BASE}/api/settings/layout`, opts).catch(() => null),
    ])
    if (!sessionsRes.ok) return null
    const sessions: Session[] = await sessionsRes.json()

    let layout: string | null = null
    try {
      if (layoutRes?.ok) {
        const layoutData = await layoutRes.json()
        layout = layoutData?.value ?? null
      }
    } catch {
      // Layout fetch failure is non-fatal
    }

    // Only fetch conversations for sessions visible in panes
    let activeIds: string[]
    if (layout) {
      activeIds = visibleSessionIds(layout, sessions)
    } else {
      // No layout — fall back to first connected session, or first session
      const connected = sessions.find((s) => s.connected)
      const fallback = connected ?? sessions[0]
      activeIds = fallback ? [fallback.id] : []
    }

    const conversations: Record<string, unknown[]> = {}
    await Promise.all(
      activeIds.map(async (id) => {
        try {
          const res = await fetch(
            `${API_BASE}/api/sessions/${id}/conversation`,
            opts
          )
          if (res.ok) {
            conversations[id] = await res.json()
          }
        } catch {
          // Individual conversation fetch failure is non-fatal
        }
      })
    )

    return { sessions, conversations, layout }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
