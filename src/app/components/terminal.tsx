"use client"

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react"

interface OutputLine {
  id: number
  type: "command" | "stdout" | "stderr" | "error" | "info"
  text: string
}

interface TerminalProps {
  sessionId: string
  active: boolean
  cwd: string
  onCwdChange?: (sessionId: string, cwd: string) => void
  onRunningChange?: (sessionId: string, running: boolean) => void
}

const MAX_OUTPUT_LINES = 5000

export default function Terminal({ sessionId, active, cwd, onCwdChange, onRunningChange }: TerminalProps) {
  const [input, setInput] = useState("")
  const [output, setOutput] = useState<OutputLine[]>([])
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [loaded, setLoaded] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)
  const abortRef = useRef<AbortController | null>(null)

  // Batched line buffer + rAF flush
  const pendingLines = useRef<OutputLine[]>([])
  const rafHandle = useRef<number | null>(null)

  const flushPendingLines = useCallback(() => {
    rafHandle.current = null
    const lines = pendingLines.current
    if (lines.length === 0) return
    pendingLines.current = []
    setOutput((prev) => {
      const combined = prev.concat(lines)
      if (combined.length > MAX_OUTPUT_LINES) {
        const trimCount = combined.length - MAX_OUTPUT_LINES
        const truncatedLine: OutputLine = {
          id: 0,
          type: "info",
          text: `--- ${trimCount} lines truncated ---`,
        }
        return [truncatedLine, ...combined.slice(trimCount)]
      }
      return combined
    })
  }, [])

  const addLine = useCallback((type: OutputLine["type"], text: string) => {
    pendingLines.current.push({ id: nextId.current++, type, text })
    if (rafHandle.current === null) {
      rafHandle.current = requestAnimationFrame(flushPendingLines)
    }
  }, [flushPendingLines])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafHandle.current !== null) {
        cancelAnimationFrame(rafHandle.current)
      }
    }
  }, [])

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  // Refocus input when command finishes
  useEffect(() => {
    if (!running && active) {
      inputRef.current?.focus()
    }
  }, [running, active])

  // Always capture keyboard input — refocus on any keypress (only when active)
  useEffect(() => {
    if (!active) return
    const handler = (e: globalThis.KeyboardEvent) => {
      const el = document.activeElement
      if (el && el !== inputRef.current && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      if (e.metaKey || e.altKey) return
      if (e.ctrlKey && e.key !== "v") return
      inputRef.current?.focus()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [active])

  // Load history on mount
  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/history`)
      .then((res) => res.json())
      .then((entries: Array<{ type: string; content: string }>) => {
        const lines: OutputLine[] = entries.map((e) => ({
          id: nextId.current++,
          type: e.type as OutputLine["type"],
          text: e.content,
        }))
        const cmds = entries
          .filter((e) => e.type === "command")
          .map((e) => e.content.replace(/^\$ /, ""))
        setOutput(lines)
        setHistory(cmds)
        setLoaded(true)
      })
      .catch(() => {
        setLoaded(true)
      })
  }, [sessionId])

  const killProcess = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      addLine("info", "^C")
    }
  }, [addLine])

  // Notify parent of running state changes
  useEffect(() => {
    onRunningChange?.(sessionId, running)
  }, [running, sessionId, onRunningChange])

  // Ctrl+C to kill running process (only when active)
  useEffect(() => {
    if (!running || !active) return
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "c" && e.ctrlKey) {
        e.preventDefault()
        killProcess()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [running, active, killProcess])

  const runCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim()
      if (!trimmed) return

      setHistory((prev) => [...prev, trimmed])
      setHistoryIndex(-1)
      addLine("command", `$ ${trimmed}`)
      setRunning(true)
      setInput("")

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(`/api/sessions/${sessionId}/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: trimmed }),
          signal: controller.signal,
        })

        const reader = res.body?.getReader()
        if (!reader) {
          addLine("error", "Failed to read response stream")
          setRunning(false)
          return
        }

        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const msg = JSON.parse(line)
              if (msg.type === "stdout") {
                addLine("stdout", msg.data.replace(/\n$/, ""))
              } else if (msg.type === "stderr") {
                addLine("stderr", msg.data.replace(/\n$/, ""))
              } else if (msg.type === "error") {
                addLine("error", msg.data)
              } else if (msg.type === "cwd") {
                onCwdChange?.(sessionId, msg.data)
              } else if (msg.type === "exit" && msg.code !== 0) {
                addLine("info", `exit code: ${msg.code}`)
              }
            } catch {
              // ignore malformed lines
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User killed the process — CWD may not have been streamed
        } else {
          addLine("error", `Network error: ${err}`)
        }
      } finally {
        abortRef.current = null
        setRunning(false)
      }
    },
    [addLine, sessionId, onCwdChange]
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !running) {
      runCommand(input)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (history.length > 0) {
        const newIndex =
          historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
        setHistoryIndex(newIndex)
        setInput(history[newIndex])
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1
        if (newIndex >= history.length) {
          setHistoryIndex(-1)
          setInput("")
        } else {
          setHistoryIndex(newIndex)
          setInput(history[newIndex])
        }
      }
    }
  }

  const colorFor = (type: OutputLine["type"]) => {
    switch (type) {
      case "command":
        return "text-blue-400"
      case "stdout":
        return "text-zinc-200"
      case "stderr":
        return "text-red-400"
      case "error":
        return "text-red-500 font-bold"
      case "info":
        return "text-zinc-500"
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-zinc-950 font-mono text-sm"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <span className="text-zinc-400 text-xs">acapa terminal</span>
        <span className="text-zinc-600 text-xs">{cwd}</span>
      </div>

      <div ref={scrollRef} className="terminal-scroll flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 space-y-0.5">
          {!loaded && (
            <pre className="text-zinc-600">Loading history...</pre>
          )}
          {output.map((line) => (
            <pre key={line.id} className={`${colorFor(line.type)} whitespace-pre-wrap break-all`}>
              {line.text}
            </pre>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center border-t border-zinc-800 px-4 py-2 gap-2">
        <span className="text-green-400 shrink-0">{cwd} $</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          className="flex-1 bg-transparent text-zinc-100 outline-none placeholder:text-zinc-700 disabled:opacity-50"
          placeholder={running ? "Ctrl+C to stop" : "type a command..."}
          autoFocus
          spellCheck={false}
        />
        {running && (
          <button
            onClick={killProcess}
            className="shrink-0 text-xs text-red-400 hover:text-red-300 px-2 py-0.5 border border-zinc-700 rounded"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  )
}
