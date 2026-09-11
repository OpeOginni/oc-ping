import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Plugin } from '@opencode/plugin'
import { OpenCode, type OpenCodeEvent, type FormInfo } from '@opencode/client'
import { Service } from '@opencode/client/service'
import { Spectrum } from 'spectrum-ts'
import { imessage } from 'spectrum-ts/providers/imessage'
import { describeForm, formAnswer, permissionReply, questionReplyHint } from './protocol.js'
import { completionDue, settingsFrom } from './policy.js'
import { Ping } from './rpc.js'
import { requestQueue } from './requests.js'

type Pending = { kind: 'permission' | 'question'; sessionID: string; requestID: string; expires: number; recipient: string }
const defaults = ['result', 'permission', 'question']
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
const log = (message: string, error?: unknown) => console.error(`[oc-ping] ${message}${error === undefined ? '' : `: ${errorMessage(error)}`}`)

export default Plugin.define({
  id: 'oc-ping',
  async setup(ctx) {
    const configuredSettings = settingsFrom(ctx.options)
    const locationKey = encodeURIComponent(JSON.stringify([resolve(ctx.location.directory), ctx.location.workspaceID ?? null]))
    const settingsKey = `settings/${locationKey}`
    let settings = settingsFrom(await ctx.storage.get(settingsKey) ?? {}, configuredSettings)
    const configured = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
    const recipient = configured(ctx.options.recipient) ?? configured(process.env.OC_PING_RECIPIENT)
    if (typeof recipient !== 'string' || !recipient.trim()) throw new Error('oc-ping: set OC_PING_RECIPIENT in .env or the server environment.')
    if (ctx.options.deviceName !== undefined && (typeof ctx.options.deviceName !== 'string' || !ctx.options.deviceName.trim())) throw new Error('oc-ping: options.deviceName must be a non-empty string.')
    const deviceName = typeof ctx.options.deviceName === 'string' ? ctx.options.deviceName.trim() : undefined
    const selected = ctx.options.events ?? defaults
    if (!Array.isArray(selected) || !selected.every(v => typeof v === 'string')) throw new Error('oc-ping: events must be an array of event names.')
    const events = new Set<string>(selected)
    const replies = ctx.options.replies !== false
    const controller = new AbortController()
    const projectId = configured(ctx.options.projectId) ?? configured(process.env.SPECTRUM_PROJECT_ID)
    const projectSecret = configured(ctx.options.projectSecret) ?? configured(process.env.SPECTRUM_PROJECT_SECRET)
    if ((projectId && !projectSecret) || (!projectId && projectSecret)) throw new Error('oc-ping: set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET together in .env or the server environment.')
    const app = projectId && projectSecret
      ? await Spectrum({ projectId, projectSecret, providers: [imessage.config()], options: { logLevel: 'error' } })
      : await Spectrum({ providers: [imessage.config()], options: { logLevel: 'error' } })
    const im = imessage(app)
    let dm: Awaited<ReturnType<typeof im.space.create>>
    let user: Awaited<ReturnType<typeof im.user>>
    try {
      user = await im.user(recipient)
      if (user.service && user.service !== 'iMessage' && user.service !== 'unknown') throw new Error('Recipient is not reachable over iMessage.')
      const phone = typeof ctx.options.senderPhone === 'string' ? ctx.options.senderPhone : undefined
      dm = await im.space.create(user, phone ? { phone } : undefined)
    } catch (error) {
      await app.stop()
      throw error
    }
    const send = async (text: string) => {
      // Preserve instructions at the end of long requests by splitting, not truncating.
      const chars = Array.from(deviceName ? `[${deviceName}] ${text}` : text)
      const ids: string[] = []
      for (let start = 0; start < chars.length; start += 3000) {
        const message = await dm.send(chars.slice(start, start + 3000).join(''))
        if (message) ids.push(message.id)
      }
      return ids
    }
    const scoped = async (sessionID: string) => {
      const session = await ctx.session.get({ sessionID })
      if (session.location.workspaceID !== ctx.location.workspaceID || resolve(session.location.directory) !== resolve(ctx.location.directory)) return undefined
      if (session.parentID && ctx.options.includeSubagents !== true) return undefined
      return session
    }
    // The current V2 plugin context does not expose forms. Use the authenticated
    // client for this resource; discover only (never start a second service).
    const forms = async (sessionID: string) => {
      let client: ReturnType<typeof OpenCode.make>
      if (typeof ctx.options.serverUrl === 'string') {
        const token = process.env.OC_PING_OPENCODE_TOKEN
        client = OpenCode.make({ baseUrl: ctx.options.serverUrl, headers: token ? { authorization: `Bearer ${token}` } : undefined })
      } else {
        const endpoint = await Service.discover()
        if (!endpoint) throw new Error('No shared service found. Configure serverUrl for standalone servers.')
        client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
      }
      // Fail closed if discovery found a different service without this session.
      await client.session.get({ sessionID })
      return client.form
    }
    const notifyRequest = async (kind: Pending['kind'], sessionID: string, requestID: string, body: string, replyHint?: string) => {
      const marker = `request/${requestID}`
      if (await ctx.storage.get(marker)) return
      const pending: Pending = { kind, sessionID, requestID, expires: Date.now() + 24 * 60 * 60 * 1000, recipient }
      const instructions = !replies ? 'Respond in OpenCode.' : kind === 'permission'
        ? 'Reply to this message with allow, always, or deny.\n(always saves approval according to OpenCode rules.)'
        : replyHint ?? 'Reply to this message with your answer.\nCancel: reply with /cancel'
      const outboundIDs = await send(`${body}\n\n${instructions}`)
      if (replies && outboundIDs.length === 0) throw new Error('Photon did not return an outbound message ID for reply routing.')
      for (const messageID of outboundIDs) await ctx.storage.set(`outbound/${messageID}`, pending)
      await ctx.storage.set(marker, true)
    }
    const requests = requestQueue({
      storage: ctx.storage,
      prefix: `waiting/${locationKey}/`,
      settings: () => settings,
      enabled: kind => kind === 'permission' ? events.has('permission') || events.has('permission.asked') : events.has('question') || events.has('form.created'),
      pending: async item => {
        if (!await scoped(item.sessionID)) return false
        return item.kind === 'permission'
          ? (await ctx.permission.list({ sessionID: item.sessionID })).some(r => r.id === item.requestID)
          : (await (await forms(item.sessionID)).state({ sessionID: item.sessionID, formID: item.requestID })).status === 'pending'
      },
      notify: item => notifyRequest(item.kind, item.sessionID, item.requestID, item.body, item.replyHint),
      onError: error => log('Delayed request check failed', error),
    })
    const onEvent = async (event: OpenCodeEvent) => {
      const data = event.data
      const sessionID = 'sessionID' in data && typeof data.sessionID === 'string' ? data.sessionID
        : event.type === 'form.created' ? event.data.form.sessionID : undefined
      if (event.type === 'session.execution.started' && sessionID && await scoped(sessionID)) {
        await ctx.storage.set(`started/${sessionID}`, event.created)
      }
      const started = event.type === 'session.idle' && sessionID ? await ctx.storage.get(`started/${sessionID}`) : undefined
      if (sessionID && (event.type === 'session.idle' || event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted')) {
        await ctx.storage.remove(`started/${sessionID}`)
      }
      if (event.type === 'permission.replied') await requests.cancel(event.data.requestID)
      if (event.type === 'form.replied' || event.type === 'form.cancelled') await requests.cancel(event.data.id)
      const selectedRaw = events.has(event.type)
      const selectedDefault = (event.type === 'session.idle' && events.has('result')) || (event.type === 'permission.asked' && events.has('permission')) || (event.type === 'form.created' && events.has('question'))
      if (!selectedRaw && !selectedDefault) return
      const session = sessionID ? await scoped(sessionID) : undefined
      if (sessionID && !session) return
      if (!sessionID && (!event.location || resolve(event.location.directory) !== resolve(ctx.location.directory) || event.location.workspaceID !== ctx.location.workspaceID)) return
      const title = session?.title ?? ctx.location.directory
      if (event.type === 'permission.asked') {
        const r = event.data
        await requests.add({ kind: 'permission', sessionID: r.sessionID, requestID: r.id, created: event.created, body: `[${title}] Permission needed\n${r.action}\n${r.resources.join('\n')}${r.message ? `\n${r.message}` : ''}` })
        await requests.flush()
      } else if (event.type === 'form.created') {
        const f = event.data.form
        await requests.add({ kind: 'question', sessionID: f.sessionID, requestID: f.id, created: event.created, body: `OpenCode question\nSession: ${title}\n\n${describeForm(f)}`, replyHint: questionReplyHint(f as FormInfo) })
        await requests.flush()
      } else if (event.type === 'session.idle' && session) {
        if (session.outcome !== 'succeeded') return
        const messages = await ctx.session.context({ sessionID: session.id })
        const last = [...messages].reverse().find(m => m.type === 'assistant')
        if (!last || last.type !== 'assistant' || last.error || !last.time.completed) return
        if (!completionDue(settings, typeof started === 'number' ? started : undefined, last.time.completed)) return
        const text = last.content.filter(p => p.type === 'text').map(p => p.text).join('\n').trim()
        if (!text || await ctx.storage.get(`result/${last.id}`)) return
        await send(`[${title}] Done\n${text}`)
        await ctx.storage.set(`result/${last.id}`, true)
      } else {
        if (await ctx.storage.get(`event/${event.id}`)) return
        await send(`[${title}] ${event.type}${sessionID ? `\nSession: ${sessionID}` : ''}`)
        await ctx.storage.set(`event/${event.id}`, true)
      }
    }
    const onReply = async (id: string, targetID: string, text: string, respond: (text: string) => Promise<unknown>) => {
      const value = await ctx.storage.get(`outbound/${targetID}`)
      if (!value || typeof value !== 'object' || Array.isArray(value)) return
      const pending = value as Pending
      if (pending.recipient !== recipient || await ctx.storage.get(`inbound/${id}`)) return
      if (pending.expires < Date.now()) {
        await ctx.storage.remove(`outbound/${targetID}`)
        await respond('This request expired; respond in OpenCode.')
        return
      }
      if (!await scoped(pending.sessionID)) return
      try {
        if (pending.kind === 'permission') {
          const reply = permissionReply(text)
          await ctx.permission.get({ sessionID: pending.sessionID, requestID: pending.requestID })
          await ctx.permission.reply({ sessionID: pending.sessionID, requestID: pending.requestID, reply })
        } else {
          const api = await forms(pending.sessionID)
          const input = { sessionID: pending.sessionID, formID: pending.requestID }
          const state = await api.state(input)
          if (state.status !== 'pending') {
            await ctx.storage.remove(`outbound/${targetID}`)
            await respond('This question has already been resolved.')
            return
          }
          const current = await api.get(input)
          if (text.trim() === '/cancel') await api.cancel(input)
          else await api.reply({ ...input, answer: formAnswer(current as FormInfo, text) })
        }
      } catch {
        await respond('Could not apply reply. Check the answer format and whether the request is still pending in OpenCode.')
        return
      }
      await ctx.storage.set(`inbound/${id}`, true)
      await ctx.storage.remove(`outbound/${targetID}`)
      await respond('Reply applied.')
    }
    // Consume the server stream promptly; isolate network work on a serial queue.
    let queue = Promise.resolve()
    const serialize = <T,>(work: () => Promise<T>): Promise<T> => {
      const result = queue.then(() => {
        if (controller.signal.aborted) throw new Error('oc-ping is shutting down.')
        return work()
      })
      queue = result.then(() => {}, () => {})
      return result
    }
    const enqueue = (work: () => Promise<void>) => { void serialize(work).catch(error => { if (!controller.signal.aborted) log('Notification/reply failed', error) }) }
    // Serialize settings mutations with notifications and replies, including toggles from multiple TUIs.
    const changeSettings = (input?: unknown) => serialize(async () => {
      const next = settingsFrom(input ?? { away: !settings.away }, settings)
      await ctx.storage.set(settingsKey, next)
      settings = next
      enqueue(requests.flush)
      return { ...settings }
    })
    const rpc = await ctx.rpc.register(Ping, {
      get: () => serialize(async () => ({ ...settings })),
      update: input => changeSettings(input),
      toggle: () => changeSettings(),
    })
    let ticking = false
    const timer = setInterval(() => {
      if (ticking) return
      ticking = true
      enqueue(async () => { try { await requests.flush() } finally { ticking = false } })
    }, 1000)
    enqueue(requests.flush)
    const outgoing = (async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) enqueue(() => onEvent(event))
        } catch { if (!controller.signal.aborted) log('Event stream disconnected; reconnecting.') }
        if (!controller.signal.aborted) await delay(2000, undefined, { signal: controller.signal }).catch(() => {})
      }
    })()
    const incoming = (async () => {
      if (!replies) return
      try {
        for await (const [space, message] of app.messages) {
          if (message.platform !== 'imessage' || message.direction !== 'inbound' || message.content.type !== 'reply' || message.content.content.type !== 'text') continue
          if (message.sender?.id !== user.id || space.id !== dm.id || imessage(space).type !== 'dm' || imessage(space).phone !== imessage(dm).phone) continue
          const { text } = message.content.content
          const targetID = message.content.target.id
          enqueue(() => onReply(message.id, targetID, text, reply => message.reply(reply)))
        }
      } catch { if (!controller.signal.aborted) log('Photon receive stream stopped; reload the plugin to reconnect.') }
    })()
    return async () => {
      controller.abort()
      clearInterval(timer)
      await rpc.dispose()
      await app.stop()
      await Promise.allSettled([outgoing, incoming, queue])
    }
  },
})
