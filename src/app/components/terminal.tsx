"use client"

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react"

interface OutputLine {
  id: number
  type: "command" | "stdout" | "stderr" | "error" | "info"
  text: string
}

interface TerminalProps {
  sessionId: string
  cwd: string
  onCwdChange?: (cwd: string) => void
}

export default function Terminal({ sessionId, cwd, onCwdChange }: TerminalProps) {
  const [input, setInput] = useState("")
  const [output, setOutput] = useState<OutputLine[]>([])
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [loaded, setLoaded] = useState(false)

  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)
  const currentSessionId = useRef(sessionId)

  const scrollToBottom = useCallback(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [output, scrollToBottom])

  useEffect(() => {
    inputRef.current?.focus()
  }, [sessionId])

  // Load history when sessionId changes
  useEffect(() => {
    currentSessionId.current = sessionId
    setOutput([])
    setHistory([])
    setHistoryIndex(-1)
    setInput("")
    setLoaded(false)
    nextId.current = 1

    fetch(`/api/sessions/${sessionId}/history`)
      .then((res) => res.json())
      .then((entries: Array<{ type: string; content: string }>) => {
        if (currentSessionId.current !== sessionId) return
        const lines: OutputLine[] = entries.map((e) => ({
          id: nextId.current++,
          type: e.type as OutputLine["type"],
          text: e.content,
        }))
        // Extract command history for arrow-key navigation
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

  const addLine = useCallback((type: OutputLine["type"], text: string) => {
    setOutput((prev) => [...prev, { id: nextId.current++, type, text }])
  }, [])

  const runCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim()
      if (!trimmed) return

      setHistory((prev) => [...prev, trimmed])
      setHistoryIndex(-1)
      addLine("command", `$ ${trimmed}`)
      setRunning(true)
      setInput("")

      try {
        const res = await fetch(`/api/sessions/${sessionId}/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: trimmed }),
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
              } else if (msg.type === "exit" && msg.code !== 0) {
                addLine("info", `exit code: ${msg.code}`)
              }
            } catch {
              // ignore malformed lines
            }
          }
        }

        // After command finishes, fetch updated session to get new cwd
        const sessionRes = await fetch(`/api/sessions/${sessionId}`)
        if (sessionRes.ok) {
          const session = await sessionRes.json()
          if (session.cwd && onCwdChange) {
            onCwdChange(session.cwd)
          }
        }
      } catch (err) {
        addLine("error", `Network error: ${err}`)
      } finally {
        setRunning(false)
        inputRef.current?.focus()
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
      className="flex h-full flex-col bg-zinc-950 font-mono text-sm"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <span className="text-zinc-400 text-xs">acapa terminal</span>
        <span className="text-zinc-600 text-xs">{cwd}</span>
      </div>

      <div ref={outputRef} className="flex-1 overflow-y-auto p-4 space-y-0.5">
        {!loaded && (
          <pre className="text-zinc-600">Loading history...</pre>
        )}
        {output.map((line) => (
          <pre key={line.id} className={`${colorFor(line.type)} whitespace-pre-wrap break-all`}>
            {line.text}
          </pre>
        ))}
      </div>

      <div className="flex items-center border-t border-zinc-800 px-4 py-2 gap-2">
        <span className="text-green-400 shrink-0">{cwd} $</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          className="flex-1 bg-transparent text-zinc-100 outline-none placeholder:text-zinc-700 disabled:opacity-50"
          placeholder={running ? "running..." : "type a command..."}
          autoFocus
          spellCheck={false}
        />
      </div>
    </div>
  )
}
