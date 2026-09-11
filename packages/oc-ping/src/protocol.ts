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
  if (form.fields.some(field => field.type === 'external')) throw new Error('Complete this question in OpenCode.')
  if (form.fields.length === 1) {
    const field = form.fields[0]
    return { [field.key]: fieldAnswer(field, text) }
  }
  const lines = text.trim().replace(/\r/g, '').split('\n')
  if (lines.length !== form.fields.length) throw new Error(`Reply with ${form.fields.length} answers, one per line.`)
  const result: FormAnswer = {}
  form.fields.forEach((field, index) => {
    if (field.type === 'external') throw new Error('Complete this question in OpenCode.')
    const answer = lines[index].trim()
    if (answer === '-') {
      if (field.required) throw new Error(`${field.title ?? field.key} is required.`)
      return
    }
    result[field.key] = fieldAnswer(field, answer)
  })
  return result
}

function fieldAnswer(field: FormInfo['fields'][number], text: string): FormAnswer[string] {
  switch (field.type) {
    case 'external': throw new Error('Complete this question in OpenCode.')
    case 'boolean': {
      if (!/^(true|false|yes|no)$/i.test(text.trim())) throw new Error('Reply yes or no.')
      return /^(true|yes)$/i.test(text.trim())
    }
    case 'number': case 'integer': {
      const value = Number(text)
      if (!text.trim() || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) throw new Error('Reply with a valid number.')
      return value
    }
    case 'multiselect': return text.split(',').map(v => optionValue(field.options, v.trim())).filter(Boolean)
    case 'string': return field.options?.length ? optionValue(field.options, text.trim()) : text
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
    const lines = [multiple ? `${fieldIndex + 1}. ${heading}` : heading, field.description?.trim()]
      .filter((line): line is string => Boolean(line))
    if ('options' in field && field.options?.length) {
      lines.push(...field.options.map((option, optionIndex) => `${optionIndex + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`))
    }
    return lines.join('\n')
  })
  return [form.title.trim(), ...fields].filter(Boolean).join('\n\n')
}

export function questionReplyHint(form: FormInfo): string {
  if (form.fields.some(field => field.type === 'external')) return 'Complete this question in OpenCode\nCancel: reply with /cancel'
  if (form.fields.length > 1) return `Reply with ${form.fields.length} answers, one per line\nUse - to skip an optional question\nCancel: reply with /cancel`
  const field = form.fields[0]
  if ('options' in field && field.options?.length) {
    const example = field.type === 'multiselect' ? '1,3' : '1'
    return `Reply to this message with ${example}\nCancel: reply with /cancel`
  }
  return `Reply to this message with your answer\nCancel: reply with /cancel`
}
