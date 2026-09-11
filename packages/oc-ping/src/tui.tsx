import { Plugin } from '@opencode/plugin/tui'
import { createSignal } from 'solid-js'
import { Ping } from './rpc.js'
import { settingsFrom, type Settings } from './policy.js'

export default Plugin.define({
  id: 'oc-ping.tui',
  setup(ctx) {
    const api = ctx.client.rpc(Ping)
    const [settings, setSettings] = createSignal<Settings>()
    const [connected, setConnected] = createSignal(false)
    let disposed = false
    let busy = false
    let dialogOpen = false
    let rpcQueue = Promise.resolve()
    const controller = new AbortController()
    const options = () => ({ location: ctx.location ?? ctx.data.location.default(), signal: controller.signal })
    const accept = (value: unknown) => {
      if (disposed) return
      setSettings(settingsFrom(value))
      setConnected(true)
    }
    // Preserve response order when a poll overlaps a toggle or a settings edit.
    const call = (method: 'get' | 'toggle' | 'update', input: unknown = {}) => {
      const requestOptions = options()
      const result = rpcQueue.then(async () => {
        const value = await api[method](input, requestOptions)
        if (JSON.stringify(requestOptions.location) === JSON.stringify(options().location)) accept(value)
      })
      rpcQueue = result.catch(() => {})
      return result
    }
    const report = () => {
      if (disposed) return
      setConnected(false)
      ctx.ui.toast.show({ title: 'oc-ping', message: 'Could not reach oc-ping. Check the server plugin and Photon setup.', variant: 'error' })
    }
    const refresh = async () => {
      if (busy || disposed) return
      busy = true
      try { await call('get') } catch { if (!disposed) setConnected(false) }
      finally { busy = false }
    }
    const toggle = async () => {
      try {
        await call('toggle')
        if (disposed) return
        ctx.ui.toast.show({ title: 'oc-ping', message: settings()?.away ? 'Away mode ON — all completions and input requests will ping.' : 'Away mode OFF — notification timers restored.', variant: 'success' })
      } catch { report() }
    }
    const dialog = async () => {
      try { await call('get') } catch { report(); return }
      while (!disposed) {
        const current = settings()!
        const choice = await ctx.ui.dialog.select({
          title: 'Ping settings',
          options: [
            { title: `Away: ${current.away ? 'ON' : 'OFF'}`, value: 'away', description: 'Ping every result and request' },
            { title: `Request delay: ${current.requestDelayMinutes} min`, value: 'requestDelayMinutes', description: 'Wait before pinging' },
            { title: `Task minimum: ${current.completionMinMinutes} min`, value: 'completionMinMinutes', description: 'Skip shorter tasks' },
          ],
        })
        if (choice === undefined) return
        if (choice === 'away') { await toggle(); continue }
        if (choice !== 'requestDelayMinutes' && choice !== 'completionMinMinutes') return
        const text = await ctx.ui.dialog.prompt({
          title: choice === 'requestDelayMinutes' ? 'Input waiting delay (minutes)' : 'Minimum task runtime (minutes)',
          value: String(current[choice]),
          description: '0 means immediate. Decimals are accepted, e.g. 0.5 for 30 seconds.',
        })
        if (text === undefined) continue
        const value = text.trim() === '' ? NaN : Number(text)
        if (!Number.isFinite(value) || value < 0 || value > 10080) {
          await ctx.ui.dialog.alert({ title: 'Invalid timer', message: 'Enter a number between 0 and 10080 minutes (7 days).' })
          continue
        }
        try { await call('update', { [choice]: value }) }
        catch { report(); return }
      }
    }
    const shortcut = typeof ctx.options.awayKeybind === 'string' ? ctx.options.awayKeybind : '<leader>p'
    const unregisterCommands = ctx.ui.slot({
      append: 'app',
      render: () => {
        ctx.keymap.layer(() => ({
          mode: 'global',
          commands: [
            { id: 'oc-ping.settings', title: 'Notification settings', group: 'oc-ping', palette: true, slash: { name: 'ping' }, run: async () => {
              if (dialogOpen) return
              dialogOpen = true
              try { await dialog() } finally { dialogOpen = false }
            } },
            { id: 'oc-ping.away', title: 'Toggle away mode', group: 'oc-ping', palette: true, slash: { name: 'ping-away' }, bind: shortcut, run: toggle },
          ],
          bindings: ['oc-ping.away'],
        }))
        return null
      },
    })
    const status = () => {
      const state = !connected() ? 'ERR' : settings()?.away ? 'ON' : 'OFF'
      const color = !connected()
        ? ctx.theme.text.feedback.error.default
        : settings()?.away
          ? ctx.theme.text.feedback.success.default
          : ctx.theme.text.subdued
      return <text fg={color}>PING {state}</text>
    }
    const slots = [
      ctx.ui.slot({ append: 'prompt.footer.status', render: () => ctx.ui.router.current().type === 'session' ? status() : null }),
      ctx.ui.slot({ append: 'home.footer', render: () => ctx.ui.router.current().type === 'home' ? <box flexGrow={1} justifyContent="flex-end" paddingRight={1} paddingBottom={1}>{status()}</box> : null }),
    ]
    void refresh()
    // Polling also recovers state after reconnects and changes in another TUI.
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      disposed = true
      controller.abort()
      clearInterval(timer)
      unregisterCommands()
      slots.forEach(stop => stop())
    }
  },
})
