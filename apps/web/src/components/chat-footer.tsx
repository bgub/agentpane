import { useState, useRef, useEffect, type KeyboardEvent, type DragEvent, type ClipboardEvent } from "react"
import { Square, Paperclip, X } from "lucide-react"
import { useSessionTokenUsageQuery } from "@/lib/queries"
import type { AvailableCommand, UsageState } from "./chat-view/types"
import type { PromptInputBlock } from "@/lib/api"

interface AttachedImage {
  data: string
  mimeType: string
  preview: string
}

interface ChatFooterProps {
  sessionId: string | null
  active: boolean
  prompting: boolean
  connecting: boolean
  connected: boolean
  availableCommands: AvailableCommand[]
  usageUpdate: UsageState | null
  supportsImages?: boolean
  onSend: (text: string, blocks?: PromptInputBlock[]) => void
  onCancel: () => void
  autoFocus?: boolean
}

function formatUsage(usage: UsageState): string {
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)
  let s = `${fmt(usage.used)}/${fmt(usage.size)}`
  if (usage.cost) s += ` $${usage.cost.amount.toFixed(2)}`
  return s
}

export function ChatFooter({ sessionId, active, prompting, connecting, connected, availableCommands, usageUpdate, supportsImages, onSend, onCancel, autoFocus = true }: ChatFooterProps) {
  const [input, setInput] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { data: tokenUsage } = useSessionTokenUsageQuery(sessionId ?? undefined)

  const tokenHint = usageUpdate
    ? formatUsage(usageUpdate)
    : tokenUsage && tokenUsage.tokenized_turns > 0
      ? `${tokenUsage.total_tokens.toLocaleString()} tok`
      : null

  // Compute filtered commands based on current input
  const filteredCommands = (() => {
    if (!input.startsWith("/") || availableCommands.length === 0) return []
    const prefix = input.slice(1).toLowerCase()
    // Only show autocomplete when typing the command (no space yet)
    if (input.includes(" ")) return []
    return availableCommands.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(prefix)
    )
  })()

  const processFiles = (files: FileList | File[]) => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const base64 = dataUrl.split(",")[1]
        setAttachedImages((prev) => [...prev, { data: base64, mimeType: file.type, preview: dataUrl }])
      }
      reader.readAsDataURL(file)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!supportsImages || !e.dataTransfer.files.length) return
    processFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!supportsImages) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!supportsImages) return
    const items = e.clipboardData.items
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      processFiles(imageFiles)
    }
  }

  const removeImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index))
  }

  const showAutocomplete = filteredCommands.length > 0 && !prompting && !connecting

  // Reset textarea height on mount (key-based remount handles session changes)
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }, [])

  // Focus textarea when ready (only in focused pane)
  useEffect(() => {
    if (autoFocus && active && !prompting && !connecting) textareaRef.current?.focus()
  }, [autoFocus, active, prompting, connecting])

  // Global keydown to focus textarea (only in focused pane)
  useEffect(() => {
    if (!autoFocus || !active) return
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.metaKey || e.ctrlKey || e.altKey
      ) return
      if (e.key.length === 1) textareaRef.current?.focus()
    }
    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [autoFocus, active])

  const selectCommand = (cmd: AvailableCommand) => {
    setInput(`/${cmd.name} `)
    setSelectedIndex(0)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showAutocomplete) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault()
        const cmd = filteredCommands[selectedIndex]
        if (cmd) selectCommand(cmd)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setInput("")
        setSelectedIndex(0)
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const trimmed = input.trim()
      if ((trimmed || attachedImages.length > 0) && !prompting) {
        const blocks: PromptInputBlock[] = []
        if (trimmed) blocks.push({ type: "text", text: trimmed })
        for (const img of attachedImages) {
          blocks.push({ type: "image", data: img.data, mimeType: img.mimeType })
        }
        setInput("")
        setSelectedIndex(0)
        setAttachedImages([])
        if (textareaRef.current) textareaRef.current.style.height = "auto"
        onSend(trimmed, blocks.length > 1 || attachedImages.length > 0 ? blocks : undefined)
      }
    }
    if (e.key === "Escape" && prompting) {
      onCancel()
    }
  }

  const handleInputChange = (value: string) => {
    setInput(value)
    setSelectedIndex(0)
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }

  return (
    <div
      className="shrink-0 border-t border-[var(--t-border)] bg-[var(--t-surface)] px-5 relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Image preview strip */}
      {attachedImages.length > 0 && (
        <div className="max-w-3xl mx-auto flex gap-2 pt-2 pb-1">
          {attachedImages.map((img, i) => (
            <div key={i} className="relative group">
              <img src={img.preview} alt="" className="h-12 rounded border border-[var(--t-border)] object-cover" />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-[var(--t-surface)] border border-[var(--t-border)] p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                <X className="size-2.5 text-[var(--t-muted)]" />
              </button>
            </div>
          ))}
        </div>
      )}
    <div className="h-12 flex items-center relative">
      {/* Autocomplete dropdown */}
      {showAutocomplete && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-0 right-0 px-5 pb-1"
        >
          <div className="max-w-3xl mx-auto rounded-md border border-[var(--t-border)] bg-[var(--t-surface)] shadow-lg overflow-hidden">
            {filteredCommands.map((cmd, i) => (
              <button
                type="button"
                key={cmd.name}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectCommand(cmd)
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors cursor-pointer ${
                  i === selectedIndex
                    ? "bg-[var(--t-elevated)]"
                    : "hover:bg-[var(--t-elevated)]/50"
                }`}
              >
                <span className="font-mono text-[var(--t-accent)] shrink-0">/{cmd.name}</span>
                <span className="text-[var(--t-muted)] truncate text-xs">{cmd.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto w-full flex items-center gap-2.5">
        <span className={`shrink-0 text-sm font-mono select-none ${
          !active || prompting || connecting ? "text-[var(--t-dim)]" : "text-[var(--t-accent)]"
        }`}>
          &#10095;
        </span>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={!active || prompting || connecting}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-[var(--t-bright)] outline-none placeholder:text-[var(--t-dim)] disabled:opacity-40"
          style={{ caretColor: 'var(--t-accent)' }}
          placeholder={
            !active
              ? ""
              : connecting
                ? "Connecting agent..."
                : prompting
                  ? "Agent is thinking..."
                  : !connected
                    ? `Send a message to reconnect${tokenHint ? ` (${tokenHint})` : ""}...`
                    : `Send a message${tokenHint ? ` (${tokenHint})` : ""}...`
          }
          spellCheck={false}
        />
        {supportsImages && active && !prompting && !connecting && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) processFiles(e.target.files); e.target.value = "" }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 text-[var(--t-dim)] hover:text-[var(--t-muted)] transition-colors cursor-pointer"
              title="Attach image"
            >
              <Paperclip className="size-3.5" />
            </button>
          </>
        )}
        {active && prompting ? (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-md bg-[var(--t-red)]/15 p-2 text-[var(--t-red)] hover:bg-[var(--t-red)]/25 transition-colors cursor-pointer"
            title="Stop (Esc)"
          >
            <Square className="size-3.5" />
          </button>
        ) : active ? (
          <span className="shrink-0 text-xs text-[var(--t-muted)] select-none">
            enter &#8629;
          </span>
        ) : null}
      </div>
    </div>
    </div>
  )
}
