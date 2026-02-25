"use client"

import { SessionProvider } from "@/components/session-provider"
import { LayoutProvider } from "@/components/layout-provider"
import Sidebar from "@/components/sidebar"
import { PaneContainer } from "@/components/pane-container"
import type { LayoutState } from "@/lib/layout-types"

interface AppProps {
  initialLayout?: LayoutState | null
  initialActiveSessionId?: string | null
}

export default function App({ initialLayout, initialActiveSessionId }: AppProps) {
  return (
    <SessionProvider initialActiveSessionId={initialActiveSessionId}>
      <LayoutProvider initialLayout={initialLayout}>
        <div className="flex h-screen bg-[var(--t-bg)] overflow-hidden">
          <Sidebar />
          <PaneContainer />
        </div>
      </LayoutProvider>
    </SessionProvider>
  )
}
