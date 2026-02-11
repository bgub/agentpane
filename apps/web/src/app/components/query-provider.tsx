"use client"

import { useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { queryKeys } from "@/lib/queries"
import type { InitialData } from "@/lib/server-api"

function makeQueryClient(initialData?: InitialData | null): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        refetchOnWindowFocus: false,
      },
    },
  })
  if (initialData) {
    client.setQueryData(queryKeys.sessions, initialData.sessions)
    for (const [id, turns] of Object.entries(initialData.conversations)) {
      client.setQueryData(queryKeys.conversation(id), turns)
    }
  }
  return client
}

export function QueryProvider({
  children,
  initialData,
}: {
  children: ReactNode
  initialData?: InitialData | null
}) {
  const [queryClient] = useState(() => makeQueryClient(initialData))
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
