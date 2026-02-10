import { SessionProvider } from "./components/session-provider"
import Sidebar from "./components/sidebar"
import { MainPanel } from "./components/main-panel"

export default function Home() {
  return (
    <div className="flex h-screen bg-[var(--t-bg)] overflow-hidden">
      <SessionProvider>
        <Sidebar />
        <MainPanel />
      </SessionProvider>
    </div>
  )
}
