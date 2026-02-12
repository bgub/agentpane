"use client"

import { Check, Loader2 } from "lucide-react"
import type { PlanEntry } from "./types"

export function PlanView({ entries }: { entries: PlanEntry[] }) {
  return (
    <div className="my-1.5 rounded-md bg-[var(--t-surface)] border border-[var(--t-border)] px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--t-dim)] mb-1.5">Plan</div>
      <div className="space-y-0.5">
        {entries.map((entry, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-xs font-mono py-0.5"
            style={{ opacity: entry.priority === "low" ? 0.55 : entry.priority === "medium" ? 0.8 : 1 }}
          >
            {entry.status === "completed" ? (
              <Check className="size-3.5 shrink-0 text-[var(--t-green)]" />
            ) : entry.status === "in_progress" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--t-amber)]" />
            ) : (
              <span className="size-3.5 shrink-0 inline-flex items-center justify-center text-[var(--t-dim)]">&#9702;</span>
            )}
            <span className={entry.status === "completed" ? "text-[var(--t-dim)]" : "text-[var(--t-text)]"}>
              {entry.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
