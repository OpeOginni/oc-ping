import { Rpc } from '@opencode/plugin/rpc'

const settings = {
  type: 'object',
  properties: {
    requestDelayMinutes: { type: 'number', minimum: 0, maximum: 10080 },
    completionMinMinutes: { type: 'number', minimum: 0, maximum: 10080 },
    away: { type: 'boolean' },
  },
  additionalProperties: false,
} as const

export const Ping = Rpc.define({
  id: 'oc-ping',
  events: {},
  methods: {
    get: { input: { type: 'object', additionalProperties: false }, output: settings },
    update: { input: settings, output: settings },
    toggle: { input: { type: 'object', additionalProperties: false }, output: settings },
  },
})
