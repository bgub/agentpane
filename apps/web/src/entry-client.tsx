import { StrictMode } from "react"
import { hydrateRoot, createRoot } from "react-dom/client"
import App from "./App"
import type { InitialState } from "./App"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = window as any
const ssrData = w.__SSR_DATA__ as InitialState | undefined
delete w.__SSR_DATA__

const root = document.getElementById("root")!

if (ssrData && root.childNodes.length > 0) {
  hydrateRoot(root, <StrictMode><App initialState={ssrData} /></StrictMode>)
} else {
  createRoot(root).render(<StrictMode><App /></StrictMode>)
}
