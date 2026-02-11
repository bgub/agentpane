import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "./api"
import type { Session } from "./types"

// --- Query keys ---

export const queryKeys = {
  sessions: ["sessions"] as const,
  conversation: (id: string) => ["conversation", id] as const,
  gitBranch: (cwd: string) => ["gitBranch", cwd] as const,
}

// --- Query hooks ---

export function useSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: async () => {
      const res = await api.sessions.list()
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<Session[]>
    },
    staleTime: 30_000,
  })
}

export function useConversationQuery(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.conversation(sessionId),
    queryFn: async () => {
      const res = await api.sessions.conversation(sessionId)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<unknown[]>
    },
    staleTime: Infinity, // Only refetched on SSE "done" invalidation
  })
}

export function useGitBranchQuery(cwd: string | undefined) {
  return useQuery({
    queryKey: queryKeys.gitBranch(cwd!),
    queryFn: async () => {
      const res = await api.gitBranch(cwd!)
      const data = (await res.json()) as { branch: string | null }
      return data.branch
    },
    enabled: !!cwd,
  })
}

// --- Mutation hooks ---

export function useStartSessionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ agentType, cwd }: { agentType: string; cwd: string }) => {
      const res = await api.sessions.create({ agent_type: agentType, cwd })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<Session>
    },
    onSuccess: (session) => {
      queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
        old ? [...old, session] : [session]
      )
    },
  })
}

export function useDeleteSessionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.sessions.delete(id)
      return id
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.sessions })
      const previous = queryClient.getQueryData<Session[]>(queryKeys.sessions)
      queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
        old?.filter((s) => s.id !== id)
      )
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.sessions, context.previous)
      }
    },
  })
}

export function useRenameSessionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await api.sessions.rename(id, name)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<Session>
    },
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.sessions })
      const previous = queryClient.getQueryData<Session[]>(queryKeys.sessions)
      queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
        old?.map((s) => (s.id === id ? { ...s, name } : s))
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.sessions, context.previous)
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
        old?.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
      )
    },
  })
}
