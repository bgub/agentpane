import type { Metadata } from "next"
import { Providers } from "@/components/app-providers"
import "@/globals.css"

export const metadata: Metadata = {
  title: "AgentPane",
  description: "Web interface for AI coding agents",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
