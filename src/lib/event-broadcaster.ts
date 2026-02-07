interface Subscriber {
  controller: ReadableStreamDefaultController<string>
  closed: boolean
}

export class EventBroadcaster {
  private subscribers = new Map<string, Subscriber>()
  private nextId = 0
  private eventCounter = 0

  subscribe(): { subscriberId: string; stream: ReadableStream<string> } {
    const subscriberId = `sub-${++this.nextId}`
    let subscriber: Subscriber

    const stream = new ReadableStream<string>({
      start: (controller) => {
        subscriber = { controller, closed: false }
        this.subscribers.set(subscriberId, subscriber)
      },
      cancel: () => {
        this.removeSubscriber(subscriberId)
      },
    })

    return { subscriberId, stream }
  }

  broadcast(eventData: unknown): void {
    const id = ++this.eventCounter
    const payload = `id: ${id}\ndata: ${JSON.stringify(eventData)}\n\n`
    const dead: string[] = []

    for (const [id, sub] of this.subscribers) {
      if (sub.closed) {
        dead.push(id)
        continue
      }
      try {
        sub.controller.enqueue(payload)
      } catch {
        dead.push(id)
      }
    }

    for (const id of dead) this.removeSubscriber(id)
  }

  sendTo(subscriberId: string, eventData: unknown): void {
    const sub = this.subscribers.get(subscriberId)
    if (!sub || sub.closed) return
    const id = ++this.eventCounter
    const payload = `id: ${id}\ndata: ${JSON.stringify(eventData)}\n\n`
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
