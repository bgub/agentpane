"use client"

import { isValidElement, useMemo, useState, useEffect, useRef, useCallback, type ReactNode } from "react"
import { Check, Copy } from "lucide-react"
import type { CodeHighlighterPlugin } from "streamdown"

interface CodeProps {
  node?: unknown
  className?: string
  children?: ReactNode
  "data-block"?: string
  [key: string]: unknown
}

interface Token {
  content: string
  color?: string
  bgColor?: string
  htmlStyle?: Record<string, string>
  htmlAttrs?: Record<string, string>
  offset?: number
}

interface TokenResult {
  tokens: Token[][]
  bg: string
  fg: string
  rootStyle?: string
}

/**
 * Synchronous code component that replaces streamdown's default lazy-loaded
 * MarkdownCode. Eliminates the Suspense spinner flash during SSR by rendering
 * block code eagerly, then applying Shiki highlighting on the client.
 */
export function createCodeComponent(plugin: CodeHighlighterPlugin) {
  const themes = plugin.getThemes()

  return function Code({ className, children, ...props }: CodeProps) {
    if (!("data-block" in props)) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm" {...props}>
          {children}
        </code>
      )
    }

    const match = className?.match(/language-([\S]+)/)
    const language = match?.[1] ?? ""

    let text = ""
    if (isValidElement(children) && typeof (children.props as Record<string, unknown>)?.children === "string") {
      text = (children.props as Record<string, unknown>).children as string
    } else if (typeof children === "string") {
      text = children
    }

    return <SyncCodeBlock code={text} language={language} plugin={plugin} themes={themes} />
  }
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)

  useEffect(() => () => { window.clearTimeout(timerRef.current) }, [])

  const handleCopy = useCallback(async () => {
    if (copied) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      timerRef.current = window.setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }, [code, copied])

  return (
    <button
      className="cursor-pointer p-1 text-muted-foreground transition-all hover:text-foreground"
      onClick={handleCopy}
      title="Copy code"
      type="button"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

function makeFallback(code: string): TokenResult {
  return {
    tokens: code.split("\n").map((line) => [{
      content: line,
      color: "inherit",
      bgColor: "transparent",
      htmlStyle: {},
      offset: 0,
    }]),
    bg: "transparent",
    fg: "inherit",
  }
}

function SyncCodeBlock({
  code,
  language,
  plugin,
  themes,
}: {
  code: string
  language: string
  plugin: CodeHighlighterPlugin
  themes: [string, string]
}) {
  const trimmed = useMemo(() => code.replace(/\n+$/, ""), [code])
  const fallback = useMemo(() => makeFallback(trimmed), [trimmed])
  const [result, setResult] = useState<TokenResult>(fallback)

  useEffect(() => {
    const cb = (r: TokenResult) => setResult(r)
    const sync = plugin.highlight({ code: trimmed, language: language as never, themes }, cb as never)
    if (sync) {
      cb(sync as TokenResult)
    }
  }, [trimmed, language, plugin, themes])

  const rootVars = useMemo(() => {
    const vars: Record<string, string> = {}
    if (result.bg) vars["--sdm-bg"] = result.bg
    if (result.fg) vars["--sdm-fg"] = result.fg
    if (result.rootStyle) {
      for (const part of result.rootStyle.split(";")) {
        const idx = part.indexOf(":")
        if (idx > 0) {
          const key = part.slice(0, idx).trim()
          const val = part.slice(idx + 1).trim()
          if (key && val) vars[key] = val
        }
      }
    }
    return vars
  }, [result.bg, result.fg, result.rootStyle])

  return (
    <div
      className="my-4 w-full overflow-hidden rounded-xl border border-border"
      data-language={language}
      data-streamdown="code-block"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 200px" }}
    >
      <div
        className="flex items-center justify-between bg-muted/80 p-3 text-muted-foreground text-xs"
        data-streamdown="code-block-header"
      >
        <span className="ml-1 font-mono lowercase">{language}</span>
        <div className="flex items-center gap-2">
          <CopyButton code={code} />
        </div>
      </div>
      <pre
        className="p-4 text-sm overflow-x-auto border-border border-t bg-[var(--sdm-bg,transparent)] dark:bg-[var(--shiki-dark-bg,var(--sdm-bg,transparent))]"
        data-language={language}
        data-streamdown="code-block-body"
        style={rootVars}
      >
        <code className="[counter-increment:line_0] [counter-reset:line]">
          {result.tokens.map((line, i) => (
            <span
              key={i}
              className="block before:content-[counter(line)] before:inline-block before:[counter-increment:line] before:w-6 before:mr-4 before:text-[13px] before:text-right before:text-muted-foreground/50 before:font-mono before:select-none"
            >
              {line.map((token, j) => (
                <span
                  key={j}
                  className={[
                    "text-[var(--sdm-c,inherit)]",
                    "dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]",
                    token.bgColor ? "bg-[var(--sdm-tbg)]" : "",
                    token.bgColor ? "dark:bg-[var(--shiki-dark-bg,var(--sdm-tbg))]" : "",
                  ].filter(Boolean).join(" ")}
                  style={{
                    ...(token.color ? { "--sdm-c": token.color } as React.CSSProperties : {}),
                    ...(token.bgColor ? { "--sdm-tbg": token.bgColor } as React.CSSProperties : {}),
                    ...token.htmlStyle,
                  }}
                  {...token.htmlAttrs}
                >
                  {token.content}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}
