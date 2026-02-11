import { SessionProvider } from "./components/session-provider"
import { LayoutProvider } from "./components/layout-provider"
import Sidebar from "./components/sidebar"
import { PaneContainer } from "./components/pane-container"

export default function Home() {
  return (
    <div className="flex h-screen bg-[var(--t-bg)] overflow-hidden">
      <SessionProvider>
        <LayoutProvider>
          <Sidebar />
          <PaneContainer />
        </LayoutProvider>
      </SessionProvider>
    </div>
  )
}
