import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Plugin } from '@opencode/plugin'
import { OpenCode, type OpenCodeEvent, type FormInfo } from '@opencode/client'
import { Service } from '@opencode/client/service'
import { Spectrum } from 'spectrum-ts'
import { imessage } from 'spectrum-ts/providers/imessage'
import { describeForm, formAnswer, parseReply, permissionReply } from './protocol.js'

type Pending = { kind: 'permission' | 'question'; sessionID: string; requestID: string; expires: number; recipient: string }
const defaults = ['result', 'permission', 'question']
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
const log = (message: string, error?: unknown) => console.error(`[oc-ping] ${message}${error === undefined ? '' : `: ${errorMessage(error)}`}`)

export default Plugin.define({
  id: 'oc-ping',
  async setup(ctx) {
    const configured = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
    const recipient = configured(ctx.options.recipient) ?? configured(process.env.OC_PING_RECIPIENT)
    if (typeof recipient !== 'string' || !recipient.trim()) throw new Error('oc-ping: options.recipient is required.')
    if (ctx.options.deviceName !== undefined && (typeof ctx.options.deviceName !== 'string' || !ctx.options.deviceName.trim())) throw new Error('oc-ping: options.deviceName must be a non-empty string.')
    const deviceName = typeof ctx.options.deviceName === 'string' ? ctx.options.deviceName.trim() : undefined
    const selected = ctx.options.events ?? defaults
    if (!Array.isArray(selected) || !selected.every(v => typeof v === 'string')) throw new Error('oc-ping: events must be an array of event names.')
    const events = new Set<string>(selected)
    const replies = ctx.options.replies !== false
    const controller = new AbortController()
    const projectId = configured(ctx.options.projectId) ?? configured(process.env.SPECTRUM_PROJECT_ID)
    const projectSecret = configured(ctx.options.projectSecret) ?? configured(process.env.SPECTRUM_PROJECT_SECRET)
    if ((projectId && !projectSecret) || (!projectId && projectSecret)) throw new Error('oc-ping: projectId and projectSecret must be configured together.')
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
      for (let start = 0; start < chars.length; start += 3000) await dm.send(chars.slice(start, start + 3000).join(''))
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
    const notifyRequest = async (kind: Pending['kind'], sessionID: string, requestID: string, body: string) => {
      const marker = `request/${requestID}`
      if (await ctx.storage.get(marker)) return
      const code = randomBytes(4).toString('hex')
      const pending: Pending = { kind, sessionID, requestID, expires: Date.now() + 24 * 60 * 60 * 1000, recipient }
      await ctx.storage.set(`pending/${code}`, pending)
      const instructions = !replies ? 'Respond in OpenCode.' : kind === 'permission'
        ? `Reply: ${code} allow | ${code} always | ${code} deny\n(always saves approval according to OpenCode rules.)`
        : `Reply: ${code} <answer>\nFor multiple fields: ${code} {"fieldKey":"answer"}\nCancel: ${code} /cancel`
      await send(`${body}\n\n${instructions}`)
      await ctx.storage.set(marker, true)
    }
    const onEvent = async (event: OpenCodeEvent) => {
      const data = event.data
      const sessionID = 'sessionID' in data && typeof data.sessionID === 'string' ? data.sessionID
        : event.type === 'form.created' ? event.data.form.sessionID : undefined
      const selectedRaw = events.has(event.type)
      const selectedDefault = (event.type === 'session.idle' && events.has('result')) || (event.type === 'permission.asked' && events.has('permission')) || (event.type === 'form.created' && events.has('question'))
      if (!selectedRaw && !selectedDefault) return
      const session = sessionID ? await scoped(sessionID) : undefined
      if (sessionID && !session) return
      if (!sessionID && (!event.location || resolve(event.location.directory) !== resolve(ctx.location.directory) || event.location.workspaceID !== ctx.location.workspaceID)) return
      const title = session?.title ?? ctx.location.directory
      if (event.type === 'permission.asked') {
        const r = event.data
        await notifyRequest('permission', r.sessionID, r.id, `[${title}] Permission needed\n${r.action}\n${r.resources.join('\n')}${r.message ? `\n${r.message}` : ''}`)
      } else if (event.type === 'form.created') {
        const f = event.data.form
        await notifyRequest('question', f.sessionID, f.id, `[${title}] Question\n${describeForm(f)}`)
      } else if (event.type === 'session.idle' && session && events.has('result')) {
        if (session.outcome !== 'succeeded') return
        const messages = await ctx.session.context({ sessionID: session.id })
        const last = [...messages].reverse().find(m => m.type === 'assistant')
        if (!last || last.type !== 'assistant' || last.error || !last.time.completed) return
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
    const onReply = async (id: string, text: string) => {
      const parsed = parseReply(text)
      if (!parsed) return // Ignore unrelated chat and replies for other instances.
      const value = await ctx.storage.get(`pending/${parsed.code}`)
      if (!value || typeof value !== 'object' || Array.isArray(value)) return
      const pending = value as Pending
      if (pending.recipient !== recipient || await ctx.storage.get(`inbound/${id}`)) return
      if (pending.expires < Date.now()) {
        await ctx.storage.remove(`pending/${parsed.code}`)
        await send(`[${parsed.code}] Request expired; respond in OpenCode.`)
        return
      }
      if (!await scoped(pending.sessionID)) return
      try {
        if (pending.kind === 'permission') {
          const reply = permissionReply(parsed.text)
          await ctx.permission.get({ sessionID: pending.sessionID, requestID: pending.requestID })
          await ctx.permission.reply({ sessionID: pending.sessionID, requestID: pending.requestID, reply })
        } else {
          const api = await forms(pending.sessionID)
          const input = { sessionID: pending.sessionID, formID: pending.requestID }
          const state = await api.state(input)
          if (state.status !== 'pending') {
            await ctx.storage.remove(`pending/${parsed.code}`)
            await send(`[${parsed.code}] This question has already been resolved.`)
            return
          }
          const current = await api.get(input)
          if (parsed.text.trim() === '/cancel') await api.cancel(input)
          else await api.reply({ ...input, answer: formAnswer(current as FormInfo, parsed.text) })
        }
      } catch {
        await send(`[${parsed.code}] Could not apply reply. Check the answer format and whether the request is still pending in OpenCode.`)
        return
      }
      await ctx.storage.set(`inbound/${id}`, true)
      await ctx.storage.remove(`pending/${parsed.code}`)
      await send(`[${parsed.code}] Reply applied.`)
    }
    // Consume the server stream promptly; isolate network work on a serial queue.
    let queue = Promise.resolve()
    const enqueue = (work: () => Promise<void>) => {
      queue = queue.then(async () => { if (!controller.signal.aborted) await work() }).catch(error => log('Notification/reply failed', error))
    }
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
          if (message.platform !== 'imessage' || message.direction !== 'inbound' || message.content.type !== 'text') continue
          if (message.sender?.id !== user.id || space.id !== dm.id || imessage(space).type !== 'dm' || imessage(space).phone !== imessage(dm).phone) continue
          const text = message.content.text
          enqueue(() => onReply(message.id, text))
        }
      } catch { if (!controller.signal.aborted) log('Photon receive stream stopped; reload the plugin to reconnect.') }
    })()
    return async () => {
      controller.abort()
      await app.stop()
      await Promise.allSettled([outgoing, incoming, queue])
    }
  },
})
