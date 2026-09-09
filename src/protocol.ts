import type { FormAnswer, FormInfo } from '@opencode/client'

export function permissionReply(text: string): 'once' | 'always' | 'reject' {
  switch (text.trim().toLowerCase()) {
    case 'allow': case 'once': return 'once'
    case 'always': return 'always'
    case 'deny': case 'reject': return 'reject'
    default: throw new Error('Reply allow, always, or deny.')
  }
}

export function formAnswer(form: FormInfo, text: string): FormAnswer {
  // JSON supports multi-field and conditional forms without guessing field order.
  if (text.trim().startsWith('{')) {
    const answer: unknown = JSON.parse(text)
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new Error('Expected a JSON object.')
    const result: FormAnswer = {}
    for (const [key, value] of Object.entries(answer)) {
      if (!form.fields.some(f => f.key === key && f.type !== 'external')) throw new Error(`Unknown field: ${key}`)
      if (!(typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (Array.isArray(value) && value.every(v => typeof v === 'string')))) throw new Error(`Invalid value for ${key}`)
      result[key] = value
    }
    return result
  }
  if (form.fields.length !== 1) throw new Error('Reply with a JSON object using the field keys shown.')
  const field = form.fields[0]
  switch (field.type) {
    case 'external': throw new Error('Complete this question in OpenCode.')
    case 'boolean': {
      if (!/^(true|false|yes|no)$/i.test(text.trim())) throw new Error('Reply yes or no.')
      return { [field.key]: /^(true|yes)$/i.test(text.trim()) }
    }
    case 'number': case 'integer': {
      const value = Number(text)
      if (!text.trim() || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) throw new Error('Reply with a valid number.')
      return { [field.key]: value }
    }
    case 'multiselect': return { [field.key]: text.split(',').map(v => v.trim()).filter(Boolean) }
    case 'string': return { [field.key]: text }
  }
}

export function describeForm(form: FormInfo): string {
  return [form.title, ...form.fields.map(f => {
    const options = 'options' in f ? f.options?.map(o => `${o.value}: ${o.label}`).join(', ') : undefined
    return `${f.key} (${f.type}): ${f.title ?? ''}${f.description ? ` — ${f.description}` : ''}${options ? `\nChoices: ${options}` : ''}`
  })].join('\n')
}

export function parseReply(text: string) {
  const match = /^([a-f0-9]{8})\s+([\s\S]+)$/i.exec(text.trim())
  return match ? { code: match[1].toLowerCase(), text: match[2] } : undefined
}
