const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3456"

export const api = {
  health: (): Promise<Response> =>
    fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2000) }),

  sessions: {
    list: (): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions`),

    create: (body?: { name?: string; agent_type?: string; cwd?: string }): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),

    get: (id: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}`),

    rename: (id: string, name: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),

    delete: (id: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}`, { method: "DELETE" }),

    status: (): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/status`),

    conversation: (id: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}/conversation`),

    prompt: (id: string, content: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }),

    cancel: (id: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}/cancel`, { method: "POST" }),

    permission: (id: string, requestId: string, optionId: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}/permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, optionId }),
      }),

    connect: (id: string, body?: { agent_type?: string; cwd?: string }): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),

    disconnect: (id: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}/connect`, { method: "DELETE" }),

    commands: (id: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}/commands`),

    config: (id: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}/config`),

    setConfig: (id: string, configId: string, value: string): Promise<Response> =>
      fetch(`${API_BASE}/api/sessions/${id}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, value }),
      }),
  },

  eventsUrl: (id: string): string =>
    `${API_BASE}/api/sessions/${id}/events`,

  gitBranch: (cwd: string): Promise<Response> =>
    fetch(`${API_BASE}/api/git-branch?cwd=${encodeURIComponent(cwd)}`),
}
