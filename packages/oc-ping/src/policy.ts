export type Settings = { requestDelayMinutes: number; completionMinMinutes: number; away: boolean }
export const defaultSettings: Settings = { requestDelayMinutes: 3, completionMinMinutes: 30, away: false }

export function settingsFrom(value: unknown, base = defaultSettings): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('oc-ping: settings must be an object.')
  const input = value as Record<string, unknown>
  const result = { ...base }
  for (const key of ['requestDelayMinutes', 'completionMinMinutes'] as const) {
    if (input[key] === undefined) continue
    const n = input[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10080) throw new Error(`oc-ping: ${key} must be between 0 and 10080 minutes.`)
    result[key] = n
  }
  if (input.away !== undefined) {
    if (typeof input.away !== 'boolean') throw new Error('oc-ping: away must be a boolean.')
    result.away = input.away
  }
  return result
}

export const requestDue = (settings: Settings, created: number, now: number) =>
  settings.away || now - created >= settings.requestDelayMinutes * 60_000

export const completionDue = (settings: Settings, started: number | undefined, completed: number) =>
  settings.away || settings.completionMinMinutes === 0 || (started !== undefined && completed - started >= settings.completionMinMinutes * 60_000)
