import { test } from 'node:test'
import assert from 'node:assert/strict'
import { completionDue, defaultSettings, requestDue, settingsFrom } from '../src/policy.js'

test('default timers and inclusive boundaries', () => {
  assert.equal(requestDue(defaultSettings, 1000, 180999), false)
  assert.equal(requestDue(defaultSettings, 1000, 181000), true)
  assert.equal(completionDue(defaultSettings, 1000, 1800999), false)
  assert.equal(completionDue(defaultSettings, 1000, 1801000), true)
})

test('unknown execution start suppresses timed completion, but away and zero allow it', () => {
  assert.equal(completionDue(defaultSettings, undefined, Date.now()), false)
  assert.equal(completionDue({ ...defaultSettings, away: true }, undefined, Date.now()), true)
  assert.equal(completionDue({ ...defaultSettings, completionMinMinutes: 0 }, undefined, Date.now()), true)
})

test('away bypasses both thresholds and turning it off restores the timers', () => {
  const away = settingsFrom({ away: true })
  assert.equal(requestDue(away, 1000, 1000), true)
  assert.equal(completionDue(away, 1000, 1001), true)
  const back = settingsFrom({ away: false }, away)
  assert.equal(requestDue(back, 1000, 1000), false)
  assert.equal(completionDue(back, 1000, 1001), false)
})

test('settings accept fractional minutes and partial updates without mutating defaults', () => {
  const configured = settingsFrom({ requestDelayMinutes: 0.5, completionMinMinutes: 15 })
  const saved = settingsFrom({ away: true }, configured)
  assert.deepEqual(saved, { requestDelayMinutes: 0.5, completionMinMinutes: 15, away: true })
  assert.equal(configured.away, false)
  assert.equal(defaultSettings.requestDelayMinutes, 3)
  assert.equal(requestDue(saved, 0, 1), true)
  assert.equal(requestDue(configured, 0, 29999), false)
  assert.equal(requestDue(configured, 0, 30000), true)
})

test('invalid timers and toggle values are rejected', () => {
  for (const key of ['requestDelayMinutes', 'completionMinMinutes']) {
    for (const value of [-1, NaN, Infinity, '3', null, 10081]) assert.throws(() => settingsFrom({ [key]: value }))
  }
  for (const value of [1, 'true', null]) assert.throws(() => settingsFrom({ away: value }))
})
