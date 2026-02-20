import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { QueryProvider } from "@/app/components/query-provider"
import { SessionProvider } from "@/app/components/session-provider"
import { LayoutProvider } from "@/app/components/layout-provider"
import Sidebar from "@/app/components/sidebar"
import { PaneContainer } from "@/app/components/pane-container"
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "@/app/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryProvider>
        <SessionProvider>
          <LayoutProvider>
            <div className="flex h-screen bg-[var(--t-bg)] overflow-hidden">
              <Sidebar />
              <PaneContainer />
            </div>
          </LayoutProvider>
        </SessionProvider>
      </QueryProvider>
    </ThemeProvider>
  </StrictMode>,
)
