export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3456"

export const DRAG_TYPES = {
  sidebarSession: "application/x-sidebar-session",
  paneTab: "application/x-pane-tab",
} as const
