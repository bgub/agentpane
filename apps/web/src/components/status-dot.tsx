import type { Session } from "@/lib/types"

interface StatusDotProps {
  session: Session | undefined
  size?: "sm" | "md"
  showDisconnected?: boolean
}

export function StatusDot({ session, size = "md", showDisconnected = false }: StatusDotProps) {
  const sizeClass = size === "sm" ? "size-1.5" : "size-2"

  if (session?.prompting) {
    return <span className={`shrink-0 ${sizeClass} rounded-full bg-[var(--t-amber)] animate-pulse`} />
  }
  if (session?.connected) {
    return <span className={`shrink-0 ${sizeClass} rounded-full bg-[var(--t-green)]`} />
  }
  if (showDisconnected) {
    return <span className={`shrink-0 ${sizeClass} rounded-full bg-[var(--t-dim)]/40`} />
  }
  return null
}
