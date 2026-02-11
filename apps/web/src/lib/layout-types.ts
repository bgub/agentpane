export interface Pane {
  id: string
  tabSessionIds: string[]
  activeTabSessionId: string
}

export interface LayoutState {
  panes: Pane[]
  focusedPaneId: string
  paneSizes: number[]
}
