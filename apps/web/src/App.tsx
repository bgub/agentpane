import { ThemeProvider } from "next-themes"
import { QueryProvider } from "@/components/query-provider"
import { SessionProvider } from "@/components/session-provider"
import { LayoutProvider } from "@/components/layout-provider"
import Sidebar from "@/components/sidebar"
import { PaneContainer } from "@/components/pane-container"
import type { Session } from "@/lib/types"
import type { LayoutState } from "@/lib/layout-types"
import type { DehydratedState } from "@tanstack/react-query"

export interface InitialState {
  sessions: Session[]
  activeSessionId: string | null
  layout: LayoutState | null
  dehydratedQueryState: DehydratedState
}

export default function App({ initialState }: { initialState?: InitialState }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryProvider dehydratedState={initialState?.dehydratedQueryState}>
        <SessionProvider
          initialSessions={initialState?.sessions}
          initialActiveSessionId={initialState?.activeSessionId}
        >
          <LayoutProvider initialLayout={initialState?.layout}>
            <div className="flex h-screen bg-[var(--t-bg)] overflow-hidden">
              <Sidebar />
              <PaneContainer />
            </div>
          </LayoutProvider>
        </SessionProvider>
      </QueryProvider>
    </ThemeProvider>
  )
}
