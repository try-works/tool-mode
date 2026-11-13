/**
 * Custom-tool draft validation.
 *
 * Validation is deliberately split from compilation: a draft may be incomplete
 * and is returned as a list of field issues, while only a validated draft can be
 * compiled or persisted. No network, filesystem or model work happens here.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/schema
 */

import type {
  CompositeExecution,
  CompositeStep,
  CustomToolDraft,
  CustomToolExecution,
  CustomToolExample,
  CustomToolIssue,
  CustomToolPolicy,
  CustomToolValidation,
  HttpExecution,
  HttpHeaderValue,
  PromptExecution,
} from './types.ts'

const ID_PATTERN = /^custom\.[a-z0-9][a-z0-9-]*$/
const NAME_PATTERN = /^custom_[a-z0-9][a-z0-9_]*$/
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

/** A validated record failure carrying every issue, not just the first. */
export class CustomToolSchemaError extends Error {
  override readonly name = 'CustomToolSchemaError'
  readonly issues: readonly CustomToolIssue[]

  constructor(issues: readonly CustomToolIssue[]) {
    super(issues.map(issue => `${issue.path}: ${issue.message}`).join('; '))
    this.issues = issues
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Validate an object-shaped JSON Schema used for tool arguments. */
function schemaIssues(value: unknown, path: string, issues: CustomToolIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be a JSON Schema object' })
    return
  }
  if (value['type'] !== 'object') {
    issues.push({ path: `${path}.type`, message: 'must be "object" for tool arguments' })
  }
  const properties = value['properties']
  if (properties !== undefined && !isRecord(properties)) {
    issues.push({ path: `${path}.properties`, message: 'must be an object' })
  }
  const required = value['required']
  if (required !== undefined) {
    if (!Array.isArray(required) || required.some(item => typeof item !== 'string')) {
      issues.push({ path: `${path}.required`, message: 'must be an array of property names' })
    } else if (isRecord(properties)) {
      for (const name of required) {
        if (!(name in properties)) issues.push({ path: `${path}.required`, message: `unknown property ${JSON.stringify(name)}` })
      }
    }
  }
}

function validateHttp(value: unknown, issues: CustomToolIssue[]): HttpExecution | undefined {
  if (!isRecord(value)) {
    issues.push({ path: 'execution.http', message: 'must be an object' })
    return undefined
  }
  const method = value['method']
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method))) {
    issues.push({ path: 'execution.http.method', message: 'must be GET, POST, PUT, PATCH or DELETE' })
  }
  const url = value['url']
  if (!nonEmptyString(url)) {
    issues.push({ path: 'execution.http.url', message: 'must be a non-empty URL template' })
  } else {
    const literal = url.replace(/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/g, 'x')
    try {
      const parsed = new URL(literal)
      if (parsed.protocol !== 'https:') issues.push({ path: 'execution.http.url', message: 'must use https' })
      if (parsed.username !== '' || parsed.password !== '') issues.push({ path: 'execution.http.url', message: 'must not embed credentials' })
    } catch {
      issues.push({ path: 'execution.http.url', message: 'must be a valid absolute https URL' })
    }
  }
  const headers: Record<string, HttpHeaderValue> = {}
  if (value['headers'] !== undefined) {
    if (!isRecord(value['headers'])) {
      issues.push({ path: 'execution.http.headers', message: 'must be an object' })
    } else {
      for (const [name, header] of Object.entries(value['headers'])) {
        if (typeof header === 'string') headers[name] = header
        else if (isRecord(header) && nonEmptyString(header['secret'])) headers[name] = { secret: header['secret'] }
        else issues.push({ path: `execution.http.headers.${name}`, message: 'must be a string or { secret: "NAME" }' })
      }
    }
  }
  let bodyTemplate: string | undefined
  if (value['bodyTemplate'] !== undefined) {
    if (typeof value['bodyTemplate'] !== 'string') issues.push({ path: 'execution.http.bodyTemplate', message: 'must be a string' })
    else bodyTemplate = value['bodyTemplate']
  }
  let extract: string | undefined
  if (value['extract'] !== undefined) {
    if (typeof value['extract'] !== 'string') issues.push({ path: 'execution.http.extract', message: 'must be a dot path string' })
    else extract = value['extract']
  }
  return {
    method: method as HttpExecution['method'],
    url: typeof url === 'string' ? url.trim() : '',
    headers,
    ...bodyTemplate === undefined ? {} : { bodyTemplate },
    ...extract === undefined ? {} : { extract },
  }
}

function validatePrompt(value: unknown, issues: CustomToolIssue[]): PromptExecution | undefined {
  if (!isRecord(value)) {
    issues.push({ path: 'execution.prompt', message: 'must be an object' })
    return undefined
  }
  if (!nonEmptyString(value['template'])) issues.push({ path: 'execution.prompt.template', message: 'must be a non-empty template' })
  let model: string | undefined
  if (value['model'] !== undefined) {
    if (!nonEmptyString(value['model'])) issues.push({ path: 'execution.prompt.model', message: 'must be a non-empty model id' })
    else model = value['model']
  }
  let maxOutputTokens: number | undefined
  if (value['maxOutputTokens'] !== undefined) {
    if (typeof value['maxOutputTokens'] !== 'number' || !Number.isInteger(value['maxOutputTokens'])
      || value['maxOutputTokens'] < 1 || value['maxOutputTokens'] > 8192) {
      issues.push({ path: 'execution.prompt.maxOutputTokens', message: 'must be an integer between 1 and 8192' })
    } else maxOutputTokens = value['maxOutputTokens']
  }
  return {
    template: typeof value['template'] === 'string' ? value['template'] : '',
    ...model === undefined ? {} : { model },
    ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
  }
}

function validateComposite(value: unknown, issues: CustomToolIssue[]): CompositeExecution | undefined {
  if (!isRecord(value) || !Array.isArray(value['steps'])) {
    issues.push({ path: 'execution.composite.steps', message: 'must be an array of steps' })
    return undefined
  }
  if (value['steps'].length === 0) issues.push({ path: 'execution.composite.steps', message: 'must contain at least one step' })
  if (value['steps'].length > 10) issues.push({ path: 'execution.composite.steps', message: 'may contain at most 10 steps' })
  const steps: CompositeStep[] = []
  value['steps'].forEach((raw, index) => {
    if (!isRecord(raw)) {
      issues.push({ path: `execution.composite.steps.${index}`, message: 'must be an object' })
      return
    }
    const tool = raw['tool']
    if (!nonEmptyString(tool) || !TOOL_NAME_PATTERN.test(tool)) {
      issues.push({ path: `execution.composite.steps.${index}.tool`, message: 'must be a valid tool name' })
    }
    const args: Record<string, string> = {}
    if (raw['args'] !== undefined) {
      if (!isRecord(raw['args'])) issues.push({ path: `execution.composite.steps.${index}.args`, message: 'must be an object of string templates' })
      else {
        for (const [key, arg] of Object.entries(raw['args'])) {
          if (typeof arg !== 'string') issues.push({ path: `execution.composite.steps.${index}.args.${key}`, message: 'must be a string template' })
          else args[key] = arg
        }
      }
    }
    const requiresApproval = raw['requiresApproval']
    if (requiresApproval !== undefined && typeof requiresApproval !== 'boolean') {
      issues.push({ path: `execution.composite.steps.${index}.requiresApproval`, message: 'must be boolean' })
    }
    if (typeof tool === 'string') {
      steps.push({
        tool,
        args,
        ...requiresApproval === true ? { requiresApproval: true } : {},
      })
    }
  })
  let output: string | undefined
  if (value['output'] !== undefined) {
    if (typeof value['output'] !== 'string') issues.push({ path: 'execution.composite.output', message: 'must be a string template' })
    else output = value['output']
  }
  return { steps, ...output === undefined ? {} : { output } }
}

function validateExecution(value: unknown, issues: CustomToolIssue[]): CustomToolExecution | undefined {
  if (!isRecord(value)) {
    issues.push({ path: 'execution', message: 'must be an object' })
    return undefined
  }
  switch (value['kind']) {
    case 'http': {
      const http = validateHttp(value['http'], issues)
      return http === undefined ? undefined : { kind: 'http', http }
    }
    case 'prompt': {
      const prompt = validatePrompt(value['prompt'], issues)
      return prompt === undefined ? undefined : { kind: 'prompt', prompt }
    }
    case 'composite': {
      const composite = validateComposite(value['composite'], issues)
      return composite === undefined ? undefined : { kind: 'composite', composite }
    }
    default:
      issues.push({ path: 'execution.kind', message: 'must be http, prompt or composite' })
      return undefined
  }
}

function normalizeOrigins(value: unknown, issues: CustomToolIssue[]): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    issues.push({ path: 'policy.networkOrigins', message: 'must be an array of origins' })
    return []
  }
  const origins: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') {
      issues.push({ path: 'policy.networkOrigins', message: 'every origin must be a string' })
      continue
    }
    try {
      const parsed = new URL(raw)
      if (parsed.protocol !== 'https:' || parsed.origin !== raw.replace(/\/$/, '')) {
        issues.push({ path: 'policy.networkOrigins', message: `${JSON.stringify(raw)} must be an exact https origin` })
      } else origins.push(parsed.origin)
    } catch {
      issues.push({ path: 'policy.networkOrigins', message: `${JSON.stringify(raw)} is not an absolute origin` })
    }
  }
  return [...new Set(origins)]
}

/** Validate and normalize one draft. */
export function validateCustomToolDraft(raw: unknown): CustomToolValidation {
  const issues: CustomToolIssue[] = []
  if (!isRecord(raw)) return { ok: false, issues: [{ path: '', message: 'draft must be an object' }] }

  const id = raw['id']
  if (!nonEmptyString(id) || !ID_PATTERN.test(id)) {
    issues.push({ path: 'id', message: 'must look like custom.<lowercase-slug>' })
  }
  const name = raw['name']
  if (!nonEmptyString(name) || !NAME_PATTERN.test(name)) {
    issues.push({ path: 'name', message: 'must look like custom_<lowercase_slug>' })
  }
  if (typeof id === 'string' && typeof name === 'string') {
    const expected = `custom_${id.slice('custom.'.length).replaceAll('-', '_')}`
    if (name !== expected) issues.push({ path: 'name', message: `must be ${expected}` })
  }
  if (!nonEmptyString(raw['title'])) issues.push({ path: 'title', message: 'must be a non-empty title' })
  if (!nonEmptyString(raw['description'])) issues.push({ path: 'description', message: 'must explain when the agent should use the tool' })
  schemaIssues(raw['parameters'], 'parameters', issues)
  if (raw['outputSchema'] !== undefined) schemaIssues(raw['outputSchema'], 'outputSchema', issues)

  const execution = validateExecution(raw['execution'], issues)
  if (execution?.kind === 'http' && execution.http.url !== '') {
    // The runtime executor enforces the origin allowlist and DNS checks; the
    // draft only states that the allowlist is present.
    if (!Array.isArray((raw['policy'] as Record<string, unknown> | undefined)?.['networkOrigins'])
      || ((raw['policy'] as Record<string, unknown>)['networkOrigins'] as unknown[]).length === 0) {
      issues.push({ path: 'policy.networkOrigins', message: 'HTTP tools require at least one exact https origin' })
    }
  }

  if (!isRecord(raw['policy'])) {
    issues.push({ path: 'policy', message: 'must be an object' })
  }
  const timeout = isRecord(raw['policy']) ? raw['policy']['timeoutMs'] : undefined
  if (timeout !== undefined && (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000)) {
    issues.push({ path: 'policy.timeoutMs', message: 'must be an integer between 1000 and 120000' })
  }
  if (isRecord(raw['policy'])) {
    for (const key of ['readOnly', 'agentExpose', 'mcpExpose'] as const) {
      const value = raw['policy'][key]
      if (value !== undefined && typeof value !== 'boolean') {
        issues.push({ path: `policy.${key}`, message: 'must be boolean' })
      }
    }
    normalizeOrigins(raw['policy']['networkOrigins'], issues)
  }

  const examples: CustomToolExample[] = []
  if (raw['examples'] !== undefined) {
    if (!Array.isArray(raw['examples'])) issues.push({ path: 'examples', message: 'must be an array' })
    else {
      raw['examples'].slice(0, 10).forEach((entry, index) => {
        if (!isRecord(entry)) {
          issues.push({ path: `examples.${index}`, message: 'must be an object' })
          return
        }
        const title = entry['title']
        const args = entry['arguments']
        if (!nonEmptyString(title)) issues.push({ path: `examples.${index}.title`, message: 'must be a non-empty title' })
        if (!isRecord(args)) issues.push({ path: `examples.${index}.arguments`, message: 'must be an object' })
        else examples.push({ title: typeof title === 'string' ? title : '', arguments: args })
      })
    }
  }

  if (issues.length > 0 || execution === undefined) return { ok: false, issues }
  return {
    ok: true,
    issues: [],
  }
}

/**
 * Validate and normalize a draft, throwing one named error with every issue.
 * @param raw - unknown decoded JSON.
 * @returns the normalized draft.
 * @throws CustomToolSchemaError when any field is invalid.
 */
export function normalizeCustomToolDraft(raw: unknown): CustomToolDraft {
  const verdict = validateCustomToolDraft(raw)
  if (!verdict.ok) throw new CustomToolSchemaError(verdict.issues)
  // SAFETY: validateCustomToolDraft checked every field this rebuild reads.
  const record = raw as Record<string, unknown>
  const execution = validateExecution(record['execution'], [])
  if (execution === undefined) throw new CustomToolSchemaError([{ path: 'execution', message: 'invalid execution' }])
  const policyRaw = isRecord(record['policy']) ? record['policy'] : {}
  const policy: CustomToolPolicy = {
    timeoutMs: typeof policyRaw['timeoutMs'] === 'number' ? policyRaw['timeoutMs'] : 15_000,
    readOnly: policyRaw['readOnly'] === true,
    networkOrigins: normalizeOrigins(policyRaw['networkOrigins'], []),
    agentExpose: policyRaw['agentExpose'] !== false,
    mcpExpose: policyRaw['mcpExpose'] === true,
  }
  const examplesRaw = Array.isArray(record['examples']) ? record['examples'] : []
  const examples: CustomToolExample[] = []
  for (const entry of examplesRaw.slice(0, 10)) {
    if (!isRecord(entry) || !isRecord(entry['arguments'])) continue
    examples.push({
      title: typeof entry['title'] === 'string' ? entry['title'] : '',
      arguments: entry['arguments'],
    })
  }
  return {
    id: String(record['id']),
    name: String(record['name']),
    title: String(record['title']),
    description: String(record['description']),
    parameters: record['parameters'] as Readonly<Record<string, unknown>>,
    ...record['outputSchema'] === undefined
      ? {}
      : { outputSchema: record['outputSchema'] as Readonly<Record<string, unknown>> },
    execution,
    policy,
    examples,
  }
}
