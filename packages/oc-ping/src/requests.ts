import { requestDue, type Settings } from './policy.js'

export type WaitingRequest = {
  kind: 'permission' | 'question'
  sessionID: string
  requestID: string
  created: number
  body: string
  replyHint?: string
}

type Storage = {
  get(key: string): Promise<unknown>
  set(key: string, value: WaitingRequest): Promise<void>
  remove(key: string): Promise<void>
  scan(options: { prefix: string; after?: string; limit: number }): Promise<{
    entries: readonly { key: string; value: unknown }[]
    next?: string
  }>
}

// The caller serializes these operations with event handling and settings changes.
export function requestQueue(input: {
  storage: Storage
  prefix: string
  settings(): Settings
  enabled(kind: WaitingRequest['kind']): boolean
  pending(item: WaitingRequest): Promise<boolean>
  notify(item: WaitingRequest): Promise<void>
  onError(error: unknown): void
  now?: () => number
}) {
  const { storage, prefix } = input
  const now = input.now ?? Date.now
  const key = (id: string) => `${prefix}${id}`
  return {
    async add(item: WaitingRequest) {
      if (!await storage.get(key(item.requestID))) await storage.set(key(item.requestID), item)
    },
    cancel(id: string) { return storage.remove(key(id)) },
    async flush() {
      let after: string | undefined
      do {
        const page = await storage.scan({ prefix, after, limit: 100 })
        after = page.next
        for (const entry of page.entries) {
          const item = entry.value as WaitingRequest
          try {
            if (!input.enabled(item.kind)) { await storage.remove(entry.key); continue }
            if (!requestDue(input.settings(), item.created, now())) continue
            // Query authoritative state immediately before sending, including after reloads.
            if (await input.pending(item)) await input.notify(item)
            await storage.remove(entry.key)
          } catch (error) { input.onError(error) }
        }
      } while (after)
    },
  }
}
