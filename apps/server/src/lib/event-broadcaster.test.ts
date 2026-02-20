import { describe, it, expect } from "vitest"
import { EventBroadcaster } from "./event-broadcaster.js"

const parseEventId = (payload: string): number => {
  const firstLine = payload.split("\n", 1)[0] ?? ""
  const id = firstLine.replace("id:", "").trim()
  return Number(id)
}

describe("EventBroadcaster", () => {
  it("keeps replay buffer within byte budget", async () => {
    const broadcaster = new EventBroadcaster(220, 100)

    broadcaster.broadcast({ n: 1, text: "a".repeat(80) })
    broadcaster.broadcast({ n: 2, text: "b".repeat(80) })
    broadcaster.broadcast({ n: 3, text: "c".repeat(80) })

    expect(broadcaster.replayBytes).toBeLessThanOrEqual(220)
    expect(broadcaster.replaySize).toBeGreaterThan(0)

    const { stream } = broadcaster.subscribe(0)
    const reader = stream.getReader()
    const oldest = broadcaster.oldestEventId
    if (oldest === null) throw new Error("expected oldest event id")

    const ids: number[] = []
    for (let i = 0; i < broadcaster.replaySize; i++) {
      const next = await reader.read()
      if (next.done || !next.value) break
      ids.push(parseEventId(next.value))
    }

    expect(ids.length).toBe(broadcaster.replaySize)
    expect(ids[0]).toBe(oldest)
    expect(ids[ids.length - 1]).toBe(broadcaster.latestEventId)
  })

  it("replays only events after afterEventId", async () => {
    const broadcaster = new EventBroadcaster(4096, 100)
    broadcaster.broadcast({ n: 1 })
    broadcaster.broadcast({ n: 2 })
    broadcaster.broadcast({ n: 3 })

    const { stream } = broadcaster.subscribe(2)
    const reader = stream.getReader()

    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(parseEventId(first.value!)).toBe(3)
  })

  it("marks replay gap when requested event id is too old", () => {
    const broadcaster = new EventBroadcaster(220, 100)
    broadcaster.broadcast({ n: 1, text: "a".repeat(80) })
    broadcaster.broadcast({ n: 2, text: "b".repeat(80) })
    broadcaster.broadcast({ n: 3, text: "c".repeat(80) })

    const oldest = broadcaster.oldestEventId
    if (oldest === null) throw new Error("expected oldest event id")

    const { replayGap } = broadcaster.subscribe(oldest - 2)
    expect(replayGap).toBe(true)

    const { replayGap: noGap } = broadcaster.subscribe(oldest - 1)
    expect(noGap).toBe(false)
  })
})
