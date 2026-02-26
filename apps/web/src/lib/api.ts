export type PromptInputBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name: string; description?: string | null; mimeType?: string | null; title?: string | null }

export const api = {
  health: (): Promise<Response> =>
    fetch("/api/health", { signal: AbortSignal.timeout(2000) }),

  sessions: {
    list: (): Promise<Response> =>
      fetch("/api/sessions"),

    create: (body?: { name?: string; agent_type?: string; cwd?: string }): Promise<Response> =>
      fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),

    get: (id: string): Promise<Response> =>
      fetch(`/api/sessions/${id}`),

    rename: (id: string, name: string): Promise<Response> =>
      fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),

    delete: (id: string): Promise<Response> =>
      fetch(`/api/sessions/${id}`, { method: "DELETE" }),

    conversation: (id: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/conversation`),

    tokenUsage: (id: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/token-usage`),

    prompt: (id: string, content: string | { blocks: PromptInputBlock[] }): Promise<Response> =>
      fetch(`/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(typeof content === "string" ? { content } : content),
      }),

    cancel: (id: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/cancel`, { method: "POST" }),

    permission: (id: string, requestId: string, optionId: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, optionId }),
      }),

    connect: (id: string, body?: { agent_type?: string; cwd?: string; authMethodId?: string }): Promise<Response> =>
      fetch(`/api/sessions/${id}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),

    disconnect: (id: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/connect`, { method: "DELETE" }),

    agentSessions: (id: string, cwd?: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/agent-sessions${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),

    commands: (id: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/commands`),

    config: (id: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/config`),

    setConfig: (id: string, configId: string, value: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, value }),
      }),

    mode: (id: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/mode`),

    setMode: (id: string, modeId: string): Promise<Response> =>
      fetch(`/api/sessions/${id}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modeId }),
      }),
  },

  settings: {
    get: (key: string): Promise<Response> =>
      fetch(`/api/settings/${encodeURIComponent(key)}`),

    set: (key: string, value: string): Promise<Response> =>
      fetch(`/api/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      }),
  },

  eventsUrl: (id: string): string =>
    `/api/sessions/${id}/events`,

  gitBranch: (cwd: string): Promise<Response> =>
    fetch(`/api/git-branch?cwd=${encodeURIComponent(cwd)}`),
}
