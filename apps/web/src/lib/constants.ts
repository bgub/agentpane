export const DRAG_TYPES = {
  sidebarSession: "application/x-sidebar-session",
  paneTab: "application/x-pane-tab",
} as const

export function parseDragData<T>(e: { dataTransfer: DataTransfer | null }, type: string): T | null {
  const raw = e.dataTransfer?.getData(type)
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}
