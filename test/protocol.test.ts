import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FormInfo } from '@opencode/client'
import { describeForm, formAnswer, permissionReply, questionReplyHint } from '../src/protocol.js'

const form = (fields: FormInfo['fields']): FormInfo => ({ id: 'frm_test', sessionID: 'ses_test', title: 'Choose a database', fields })

test('permission replies require an explicit supported decision', () => {
  assert.equal(permissionReply(' ALLOW '), 'once')
  assert.equal(permissionReply('always'), 'always')
  assert.equal(permissionReply('deny'), 'reject')
  for (const input of ['yes', 'allow everything', '', 'probably', 'allow\ndeny']) assert.throws(() => permissionReply(input))
})

test('text, boolean and numeric questions retain native form types', () => {
  assert.deepEqual(formAnswer(form([{ key: 'answer', type: 'string' }]), 'Postgres'), { answer: 'Postgres' })
  assert.deepEqual(formAnswer(form([{ key: 'answer', type: 'boolean' }]), 'no'), { answer: false })
  assert.deepEqual(formAnswer(form([{ key: 'answer', type: 'integer' }]), '42'), { answer: 42 })
  for (const input of ['', 'NaN', 'Infinity', '3.5']) assert.throws(() => formAnswer(form([{ key: 'answer', type: 'integer' }]), input))
})

test('multi-select and multi-field questions produce keyed answers', () => {
  assert.deepEqual(formAnswer(form([{ key: 'db', type: 'multiselect', options: [{ value: 'pg', label: 'Postgres' }, { value: 'sqlite', label: 'SQLite' }] }]), '1, SQLite'), { db: ['pg', 'sqlite'] })
  const f = form([{ key: 'db', type: 'string' }, { key: 'replicas', type: 'integer' }])
  assert.deepEqual(formAnswer(f, '{"db":"pg","replicas":2}'), { db: 'pg', replicas: 2 })
  assert.throws(() => formAnswer(f, 'pg'))
  assert.throws(() => formAnswer(f, '{"unrelated":"pg"}'))
  assert.throws(() => formAnswer(f, '{"db":{"nested":true}}'))
})

test('external fields cannot be answered through a text reply', () => {
  const f = form([{ key: 'oauth', type: 'external', url: 'https://example.com' }])
  assert.throws(() => formAnswer(f, 'yes'))
  assert.throws(() => formAnswer(f, '{"oauth":"yes"}'))
})

test('question text includes actual option values for valid replies', () => {
  const f = form([{ key: 'db', title: 'Database', description: 'Pick one', type: 'string', options: [{ value: 'pg', label: 'PostgreSQL' }] }])
  const text = describeForm(f)
  assert.doesNotMatch(text, /db \(string\)/)
  assert.match(text, /Database\nPick one\n1\. PostgreSQL/)
  assert.equal(questionReplyHint(f), 'Reply to this message with 1\nCancel: reply with /cancel')
  assert.deepEqual(formAnswer(f, '1'), { db: 'pg' })
  assert.deepEqual(formAnswer(f, 'PostgreSQL'), { db: 'pg' })
})
