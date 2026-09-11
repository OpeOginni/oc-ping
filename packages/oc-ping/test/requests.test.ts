import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestQueue, type WaitingRequest } from '../src/requests.js'
import { defaultSettings } from '../src/policy.js'

function harness() {
  const entries = new Map<string, WaitingRequest>()
  let now = 0
  let settings = { ...defaultSettings }
  let enabled = true
  let fail = false
  const resolved = new Set<string>()
  const sent: string[] = []
  const errors: unknown[] = []
  const storage = {
    async get(key: string) { return entries.get(key) },
    async set(key: string, value: WaitingRequest) { entries.set(key, structuredClone(value)) },
    async remove(key: string) { entries.delete(key) },
    async scan({ prefix, after, limit }: { prefix: string; after?: string; limit: number }) {
      const keys = [...entries.keys()].sort().filter(key => key.startsWith(prefix) && (!after || key > after))
      const page = keys.slice(0, limit)
      return { entries: page.map(key => ({ key, value: entries.get(key)! })), next: keys.length > limit ? page.at(-1) : undefined }
    },
  }
  const make = (prefix = 'waiting/workspace-a/') => requestQueue({
    storage, prefix, now: () => now, settings: () => settings, enabled: () => enabled,
    pending: async item => { if (fail) throw new Error('disconnected'); return !resolved.has(item.requestID) },
    notify: async item => { sent.push(item.requestID) },
    onError: error => errors.push(error),
  })
  const item = (id: string, kind: WaitingRequest['kind'] = 'permission'): WaitingRequest => ({ kind, sessionID: 'session', requestID: id, created: now, body: 'Need input' })
  return { make, item, entries, sent, resolved, errors, time: (time: number) => { now = time }, away: (away: boolean) => { settings.away = away }, delay: (minutes: number) => { settings.requestDelayMinutes = minutes }, enable: (value: boolean) => { enabled = value }, fail: (value: boolean) => { fail = value } }
}

test('unanswered requests send once at the threshold; duplicate events do not reset the timer', async () => {
  const h = harness(), queue = h.make()
  await queue.add(h.item('permission'))
  h.time(179999)
  await queue.add(h.item('permission'))
  await queue.flush()
  assert.deepEqual(h.sent, [])
  h.time(180000)
  await queue.flush()
  await queue.flush()
  assert.deepEqual(h.sent, ['permission'])
})

test('resolution events cancel timers and authoritative state catches missed resolution events', async () => {
  const h = harness(), queue = h.make()
  await queue.add(h.item('cancelled'))
  await queue.add(h.item('answered', 'question'))
  await queue.cancel('cancelled')
  h.resolved.add('answered')
  h.time(180000)
  await queue.flush()
  assert.deepEqual(h.sent, [])
  assert.equal(h.entries.size, 0)
})

test('persisted timers survive queue recreation and do not cross workspace boundaries', async () => {
  const h = harness()
  await h.make().add(h.item('a'))
  await h.make('waiting/workspace-b/').add(h.item('b'))
  h.time(180000)
  await h.make().flush()
  assert.deepEqual(h.sent, ['a'])
  assert.equal(h.entries.size, 1)
  await h.make('waiting/workspace-b/').flush()
  assert.deepEqual(h.sent, ['a', 'b'])
})

test('away flushes existing requests; turning it off restores waiting for future requests', async () => {
  const h = harness(), queue = h.make()
  await queue.add(h.item('a'))
  h.away(true)
  await queue.flush()
  h.away(false)
  await queue.add(h.item('b', 'question'))
  await queue.flush()
  assert.deepEqual(h.sent, ['a'])
  h.time(180000)
  await queue.flush()
  assert.deepEqual(h.sent, ['a', 'b'])
})

test('live delay edits use original request age', async () => {
  const h = harness(), queue = h.make()
  await queue.add(h.item('a'))
  h.time(60000)
  h.delay(0.5)
  await queue.flush()
  assert.deepEqual(h.sent, ['a'])
})

test('disabled events discard persisted requests even while away', async () => {
  const h = harness(), queue = h.make()
  await queue.add(h.item('a'))
  h.away(true)
  h.enable(false)
  await queue.flush()
  assert.deepEqual(h.sent, [])
  assert.equal(h.entries.size, 0)
})

test('failed pending checks never send and can recover on a later sweep', async () => {
  const h = harness(), queue = h.make()
  await queue.add(h.item('a'))
  h.time(180000)
  h.fail(true)
  await queue.flush()
  assert.deepEqual(h.sent, [])
  assert.equal(h.errors.length, 1)
  assert.equal(h.entries.size, 1)
  h.fail(false)
  await queue.flush()
  assert.deepEqual(h.sent, ['a'])
})

test('pagination does not skip requests when removing earlier pages', async () => {
  const h = harness(), queue = h.make()
  for (let i = 0; i < 205; i++) await queue.add(h.item(String(i).padStart(3, '0')))
  h.time(180000)
  await queue.flush()
  assert.equal(h.sent.length, 205)
  assert.equal(new Set(h.sent).size, 205)
  assert.equal(h.entries.size, 0)
})
