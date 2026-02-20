import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import { QueryProvider } from "@/components/query-provider"
import { SessionProvider } from "@/components/session-provider"
import { LayoutProvider } from "@/components/layout-provider"
import Sidebar from "@/components/sidebar"
import { PaneContainer } from "@/components/pane-container"
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "@/globals.css"

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
