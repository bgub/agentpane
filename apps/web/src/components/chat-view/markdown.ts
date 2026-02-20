import { code } from "@streamdown/code"
import { createCodeComponent } from "./code-block"

export const markdownPlugins = { code }
const CodeComponent = createCodeComponent(code)
export const markdownComponents = { code: CodeComponent } as Record<string, React.ComponentType<Record<string, unknown>>>
