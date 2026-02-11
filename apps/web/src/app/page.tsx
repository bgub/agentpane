import { SessionProvider } from "./components/session-provider"
import { QueryProvider } from "./components/query-provider"
import { LayoutProvider } from "./components/layout-provider"
import Sidebar from "./components/sidebar"
import { PaneContainer } from "./components/pane-container"
import { fetchInitialData } from "@/lib/server-api"

export const dynamic = "force-dynamic"

export default async function Home() {
  const initialData = await fetchInitialData()

  return (
    <div className="flex h-screen bg-[var(--t-bg)] overflow-hidden">
      <QueryProvider initialData={initialData}>
        <SessionProvider initialData={initialData}>
          <LayoutProvider savedLayout={initialData?.layout ?? null}>
            <Sidebar />
            <PaneContainer />
          </LayoutProvider>
        </SessionProvider>
      </QueryProvider>
    </div>
  )
}
