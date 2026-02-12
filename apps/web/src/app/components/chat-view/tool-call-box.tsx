"use client"

import { useState, useEffect } from "react"
import { Check } from "lucide-react"
import { Streamdown } from "streamdown"
import { code } from "@streamdown/code"
import type { ToolCallState, PermissionOption, DiffLine } from "./types"
import {
  kindIcon,
  statusIndicator,
  formatOutput,
  extractOutputText,
  extractCommand,
  parseExitPlanMode,
  isPlanSubagent,
  parseEditChanges,
  computeLineDiff,
} from "./utils"
import { api } from "@/lib/api"

const markdownPlugins = { code }

export function EditDiffView({ rawInput }: { rawInput: unknown }) {
  const changes = parseEditChanges(rawInput)
  if (!changes) return null

  return (
    <div className="space-y-2">
      {changes.map((change, i) => {
        const lines: DiffLine[] = change.oldContent
          ? computeLineDiff(change.oldContent, change.content)
          : change.content.split("\n").map((l): DiffLine => ({ type: "add", content: l }))

        return (
          <div key={i}>
            {changes.length > 1 && (
              <div className="text-[10px] text-[var(--t-dim)] mb-1 truncate">{change.path}</div>
            )}
            <div className="text-xs font-mono leading-[1.6] overflow-x-auto max-h-60 overflow-y-auto">
              {lines.map((line, j) => (
                <div
                  key={j}
                  className={
                    line.type === "add"
                      ? "bg-[var(--t-green)]/10 text-[var(--t-green)]"
                      : line.type === "remove"
                        ? "bg-[var(--t-red)]/10 text-[var(--t-red)]"
                        : "text-[var(--t-dim)]"
                  }
                >
                  <span className="select-none inline-block w-4 text-center opacity-60">
                    {line.type === "add" ? "+" : line.type === "remove" ? "\u2212" : " "}
                  </span>
                  {line.content || " "}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MarkdownDetailView({ content }: { content: string }) {
  return (
    <div className="text-sm leading-[1.7] text-[var(--t-text)] max-h-96 overflow-y-auto">
      <Streamdown plugins={markdownPlugins} mode="static">
        {content}
      </Streamdown>
    </div>
  )
}

export function PermissionButtons({
  sessionId,
  requestId,
  options,
}: {
  sessionId: string
  requestId: string
  options: PermissionOption[]
}) {
  const [responding, setResponding] = useState(false)

  const handleClick = (optionId: string) => {
    setResponding(true)
    api.sessions.permission(sessionId, requestId, optionId).catch(() => {
      setResponding(false)
    })
  }

  if (responding) return null

  return (
    <div className="flex items-center gap-2 pt-1">
      {options.map((opt) => {
        const isReject = opt.kind.startsWith("reject")
        return (
          <button
            key={opt.optionId}
            onClick={() => handleClick(opt.optionId)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
              isReject
                ? "border-[var(--t-red)]/40 text-[var(--t-red)] hover:bg-[var(--t-red)]/10"
                : "border-[var(--t-green)]/40 text-[var(--t-green)] hover:bg-[var(--t-green)]/10"
            }`}
          >
            {opt.name}
          </button>
        )
      })}
    </div>
  )
}

function ExecuteDetails({
  command,
  outputText,
}: {
  command: string | null
  outputText: string | null
}) {
  return (
    <div className="space-y-1.5">
      {command && (
        <div className="text-xs font-mono text-[var(--t-accent)]">
          <span className="text-[var(--t-dim)] select-none">$ </span>
          {command}
        </div>
      )}
      {outputText && (
        <pre className="text-xs leading-relaxed font-mono whitespace-pre overflow-x-auto text-[var(--t-muted)] max-h-60 overflow-y-auto">
          {outputText}
        </pre>
      )}
    </div>
  )
}

function GenericDetails({
  rawInput,
  outputText,
  rawOutput,
}: {
  rawInput: string
  outputText: string | null
  rawOutput: string
}) {
  const showInput = rawInput && rawInput !== "{}"
  const output = outputText || rawOutput
  const outputIsMarkdown = !!output && output.length > 200 && /^#{1,3}\s/m.test(output)

  return (
    <>
      {showInput && (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap text-[var(--t-muted)] max-h-40 overflow-y-auto">
          {rawInput}
        </pre>
      )}
      {outputIsMarkdown ? (
        <MarkdownDetailView content={output} />
      ) : output ? (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap text-[var(--t-text)] max-h-60 overflow-y-auto">
          {output}
        </pre>
      ) : null}
    </>
  )
}

export function ToolCallBox({ state, sessionId }: { state: ToolCallState; sessionId?: string }) {
  const isEdit = state.kind === "edit" && !!parseEditChanges(state.rawInput)
  const planContent = parseExitPlanMode(state.rawInput)
  const hasPendingPermission = !!state.permissionRequest
  const [expanded, setExpanded] = useState(isEdit || !!planContent || hasPendingPermission)

  // Auto-expand when permission request arrives
  useEffect(() => {
    if (hasPendingPermission) setExpanded(true)
  }, [hasPendingPermission])

  // Hide Plan subagent — the plan is shown by ExitPlanMode below
  if (isPlanSubagent(state.rawInput)) return null

  const outputText = extractOutputText(state.rawOutput)
  const command = extractCommand(state.rawInput)
  const isExecute = !isEdit && (state.kind === "execute" || !!command)
  const rawOutput = formatOutput(state.rawOutput)
  const rawInput = formatOutput(state.rawInput)
  const hasDetails =
    isEdit ||
    !!planContent ||
    isExecute ||
    !!outputText ||
    (!!rawInput && rawInput !== "{}") ||
    (!!rawOutput && rawOutput !== "{}" && rawOutput !== "null" && rawOutput !== "")

  return (
    <div className="my-1.5 rounded-md bg-[var(--t-surface)] border border-[var(--t-border)]">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs font-mono transition-colors ${
          hasDetails ? "cursor-pointer hover:bg-[var(--t-elevated)]" : "cursor-default"
        }`}
        style={{ color: "var(--t-text)" }}
      >
        <span className="text-[var(--t-blue)]">{kindIcon(state.kind)}</span>
        <span className="flex-1 text-left truncate">{state.title}</span>
        {planContent ? <Check className="size-3.5 shrink-0 text-[var(--t-green)]" /> : statusIndicator(state.status)}
        {hasDetails && (
          <span className="text-[var(--t-dim)] text-[10px]">{expanded ? "\u25BE" : "\u25B8"}</span>
        )}
      </button>
      {expanded && (hasDetails || hasPendingPermission) && (
        <div className="border-t border-[var(--t-border)] px-3 py-2 space-y-2">
          {isEdit ? (
            <EditDiffView rawInput={state.rawInput} />
          ) : planContent ? (
            <MarkdownDetailView content={planContent} />
          ) : isExecute ? (
            <ExecuteDetails command={command} outputText={outputText} />
          ) : state.kind === "read" ? (
            <pre className="text-xs leading-relaxed font-mono whitespace-pre overflow-x-auto text-[var(--t-text)] max-h-60 overflow-y-auto">
              {outputText || rawOutput}
            </pre>
          ) : (
            <GenericDetails rawInput={rawInput} outputText={outputText} rawOutput={rawOutput} />
          )}
          {hasPendingPermission && sessionId && (
            <PermissionButtons
              sessionId={sessionId}
              requestId={state.permissionRequest!.requestId}
              options={state.permissionRequest!.options}
            />
          )}
        </div>
      )}
    </div>
  )
}
