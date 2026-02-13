interface Subscriber {
  controller: ReadableStreamDefaultController<string>
  closed: boolean
}

interface BufferedEvent {
  id: number
  payload: string
  bytes: number
}

export class EventBroadcaster {
  private subscribers = new Map<string, Subscriber>()
  private nextSubId = 0
  private eventCounter = 0
  private buffered: Array<BufferedEvent> = []
  private bufferedBytes = 0

  constructor(
    private readonly maxReplayBytes = 512 * 1024,
    private readonly maxReplayEvents = 1000
  ) {}

  get latestEventId(): number {
    return this.eventCounter
  }

  subscribe(afterEventId?: number): {
    subscriberId: string
    stream: ReadableStream<string>
    latestEventId: number
  } {
    const subscriberId = `sub-${++this.nextSubId}`
    let subscriber: Subscriber

    const stream = new ReadableStream<string>({
      start: (controller) => {
        subscriber = { controller, closed: false }

        // Replay buffered events then register — all synchronous in start(),
        // so no gap between replay and live events (JS single-threaded)
        for (const evt of this.buffered) {
          if (afterEventId !== undefined && evt.id <= afterEventId) continue
          try {
            controller.enqueue(evt.payload)
          } catch {
            subscriber.closed = true
            return
          }
        }

        this.subscribers.set(subscriberId, subscriber)
      },
      cancel: () => {
        this.removeSubscriber(subscriberId)
      },
    })

    return { subscriberId, stream, latestEventId: this.eventCounter }
  }

  broadcast(eventData: unknown): void {
    const id = ++this.eventCounter
    const payload = `id: ${id}\ndata: ${JSON.stringify(eventData)}\n\n`
    const bytes = Buffer.byteLength(payload, "utf-8")

    // Store in replay buffer (bounded by bytes and event count)
    this.buffered.push({ id, payload, bytes })
    this.bufferedBytes += bytes
    while (
      this.buffered.length > this.maxReplayEvents ||
      this.bufferedBytes > this.maxReplayBytes
    ) {
      const evicted = this.buffered.shift()
      if (!evicted) break
      this.bufferedBytes -= evicted.bytes
    }

    // Deliver to live subscribers
    const dead: string[] = []
    for (const [subId, sub] of this.subscribers) {
      if (sub.closed) {
        dead.push(subId)
        continue
      }
      try {
        sub.controller.enqueue(payload)
      } catch {
        dead.push(subId)
      }
    }
    for (const subId of dead) this.removeSubscriber(subId)
  }

  sendTo(subscriberId: string, eventData: unknown): void {
    const sub = this.subscribers.get(subscriberId)
    if (!sub || sub.closed) return
    // sendTo uses id: 0 so it doesn't interfere with replay sequence
    const payload = `id: 0\ndata: ${JSON.stringify(eventData)}\n\n`
    try {
      sub.controller.enqueue(payload)
    } catch {
      this.removeSubscriber(subscriberId)
    }
  }

  unsubscribe(subscriberId: string): void {
    this.removeSubscriber(subscriberId)
  }

  close(): void {
    for (const sub of this.subscribers.values()) {
      if (!sub.closed) {
        sub.closed = true
        try {
          sub.controller.close()
        } catch { /* already closed */ }
      }
    }
    this.subscribers.clear()
  }

  get subscriberCount(): number {
    return this.subscribers.size
  }

  get replayBytes(): number {
    return this.bufferedBytes
  }

  get replaySize(): number {
    return this.buffered.length
  }

  get oldestEventId(): number | null {
    return this.buffered[0]?.id ?? null
  }

  private removeSubscriber(subscriberId: string): void {
    const sub = this.subscribers.get(subscriberId)
    if (sub) {
      if (!sub.closed) {
        sub.closed = true
        try {
          sub.controller.close()
        } catch { /* already closed */ }
      }
      this.subscribers.delete(subscriberId)
    }
  }
}
