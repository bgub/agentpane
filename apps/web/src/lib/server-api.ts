import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Session } from "@/lib/types"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3456"

export interface InitialData {
  authToken: string | null
  sessions: Session[]
  conversations: Record<string, unknown[]>
  layout: string | null
}

function readAuthToken(): string | null {
  const candidates = [
    process.env.AGENTPANE_DATA_DIR && resolve(process.env.AGENTPANE_DATA_DIR, ".auth-token"),
    resolve(process.cwd(), "data/.auth-token"),
    resolve(process.cwd(), "../../data/.auth-token"),
  ]
  for (const p of candidates) {
    if (!p) continue
    try {
      return readFileSync(p, "utf-8").trim()
    } catch {
      continue
    }
  }
  return null
}

export async function fetchInitialData(): Promise<InitialData | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)

  try {
    const token = readAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers["Authorization"] = `Bearer ${token}`
    const opts: RequestInit = { cache: "no-store", signal: controller.signal, headers }

    // Health check (no auth needed, but include headers for consistency)
    const healthRes = await fetch(`${API_BASE}/api/health`, { cache: "no-store", signal: controller.signal })
    const health = await healthRes.json()
    if (health?.app !== "agentpane") return null

    // Fetch sessions
    const sessionsRes = await fetch(`${API_BASE}/api/sessions`, opts)
    if (!sessionsRes.ok) return null
    const sessions: Session[] = await sessionsRes.json()

    // Fetch conversations in parallel
    const conversations: Record<string, unknown[]> = {}
    await Promise.all(
      sessions.map(async (s) => {
        try {
          const res = await fetch(
            `${API_BASE}/api/sessions/${s.id}/conversation`,
            opts
          )
          if (res.ok) {
            conversations[s.id] = await res.json()
          }
        } catch {
          // Individual conversation fetch failure is non-fatal
        }
      })
    )

    // Fetch layout setting
    let layout: string | null = null
    try {
      const layoutRes = await fetch(`${API_BASE}/api/settings/layout`, opts)
      if (layoutRes.ok) {
        const layoutData = await layoutRes.json()
        layout = layoutData?.value ?? null
      }
    } catch {
      // Layout fetch failure is non-fatal
    }

    return { authToken: token, sessions, conversations, layout }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
