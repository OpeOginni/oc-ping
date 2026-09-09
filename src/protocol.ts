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
    case 'multiselect': return { [field.key]: text.split(',').map(v => optionValue(field.options, v.trim())).filter(Boolean) }
    case 'string': return { [field.key]: field.options?.length ? optionValue(field.options, text.trim()) : text }
  }
}

function optionValue(options: ReadonlyArray<{ value: string; label: string }>, answer: string): string {
  const index = Number(answer)
  if (/^\d+$/.test(answer) && index >= 1 && index <= options.length) return options[index - 1].value
  const option = options.find(item => item.value.toLowerCase() === answer.toLowerCase() || item.label.toLowerCase() === answer.toLowerCase())
  if (!option) throw new Error('Reply with a listed option number, value, or label.')
  return option.value
}

export function describeForm(form: FormInfo): string {
  const multiple = form.fields.length > 1
  const fields = form.fields.map((field, fieldIndex) => {
    const heading = field.title?.trim() || (multiple ? field.key : '')
    const lines = [multiple ? `${fieldIndex + 1}. ${heading} [${field.key}]` : heading, field.description?.trim()]
      .filter((line): line is string => Boolean(line))
    if ('options' in field && field.options?.length) {
      lines.push(...field.options.map((option, optionIndex) => `${optionIndex + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`))
    }
    return lines.join('\n')
  })
  return [form.title.trim(), ...fields].filter(Boolean).join('\n\n')
}

export function questionReplyHint(form: FormInfo, code: string): string {
  if (form.fields.length > 1) return `Reply: ${code} {"fieldKey":"answer"}\nCancel: ${code} /cancel`
  const field = form.fields[0]
  if ('options' in field && field.options?.length) {
    const example = field.type === 'multiselect' ? '1,3' : '1'
    return `Reply: ${code} ${example}\nCancel: ${code} /cancel`
  }
  return `Reply: ${code} <answer>\nCancel: ${code} /cancel`
}

export function parseReply(text: string) {
  const match = /^([a-f0-9]{8})\s+([\s\S]+)$/i.exec(text.trim())
  return match ? { code: match[1].toLowerCase(), text: match[2] } : undefined
}
