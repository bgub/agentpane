import { API_BASE } from "./constants"

const TOKEN_KEY = "agentpane:authToken"

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set("Authorization", `Bearer ${token}`)
  return fetch(url, { ...init, headers })
}

export const api = {
  health: (): Promise<Response> =>
    fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2000) }),

  sessions: {
    list: (): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions`),

    create: (body?: { name?: string; agent_type?: string; cwd?: string }): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),

    get: (id: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}`),

    rename: (id: string, name: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),

    delete: (id: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}`, { method: "DELETE" }),

    conversation: (id: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}/conversation`),

    prompt: (id: string, content: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }),

    cancel: (id: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}/cancel`, { method: "POST" }),

    permission: (id: string, requestId: string, optionId: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}/permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, optionId }),
      }),

    connect: (id: string, body?: { agent_type?: string; cwd?: string }): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),

    disconnect: (id: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}/connect`, { method: "DELETE" }),

    commands: (id: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}/commands`),

    config: (id: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}/config`),

    setConfig: (id: string, configId: string, value: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/sessions/${id}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, value }),
      }),
  },

  settings: {
    get: (key: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/settings/${encodeURIComponent(key)}`),

    set: (key: string, value: string): Promise<Response> =>
      authFetch(`${API_BASE}/api/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      }),
  },

  eventsUrl: (id: string): string => {
    const token = getToken()
    const base = `${API_BASE}/api/sessions/${id}/events`
    return token ? `${base}?token=${encodeURIComponent(token)}` : base
  },

  gitBranch: (cwd: string): Promise<Response> =>
    authFetch(`${API_BASE}/api/git-branch?cwd=${encodeURIComponent(cwd)}`),
}
