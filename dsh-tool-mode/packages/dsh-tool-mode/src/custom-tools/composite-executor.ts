/**
 * Composite custom-tool executor.
 *
 * A bounded sequential pipeline over existing tools. It never loops, never calls
 * itself, and requires an explicit approval seam for steps marked destructive.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/composite-executor
 */

import type { CustomToolExecContext } from './compile.ts'
import type { CustomToolRecord } from './types.ts'

/** A named composite-execution refusal. */
export class CustomToolCompositeError extends Error {
  override readonly name = 'CustomToolCompositeError'
  readonly code:
    | 'custom-tool-composite-unavailable'
    | 'custom-tool-composite-step-invalid'
    | 'custom-tool-composite-approval-denied'
    | 'custom-tool-composite-failed'

  constructor(code: CustomToolCompositeError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

/** One call into the real tool registry. */
export type CompositeToolCall = (
  name: string,
  args: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) => Promise<unknown>

/** Optional approval for a destructive step. */
export type CompositeApproval = (step: { readonly tool: string; readonly index: number }) => Promise<boolean>

/** Composite executor seams. */
export interface CompositeExecutorDeps {
  readonly callTool?: CompositeToolCall
  readonly approve?: CompositeApproval
  /** The tool name owning this record; self-calls are refused. */
  readonly selfName?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current)) current = current[Number(segment)]
    else if (typeof current === 'object' && current !== null) current = (current as Record<string, unknown>)[segment]
    else return undefined
  }
  return current
}

/** Resolve `{{arg}}`, `{{steps.N.result}}` and `{{steps.N.result.path}}`. */
function interpolate(template: string, args: Readonly<Record<string, unknown>>, results: readonly unknown[]): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_whole, expression: string) => {
    const trimmed = expression.trim()
    if (trimmed.startsWith('steps.')) {
      const segments = trimmed.split('.')
      const index = Number(segments[1])
      if (!Number.isInteger(index) || index < 0 || index >= results.length) {
        throw new CustomToolCompositeError('custom-tool-composite-step-invalid', `${trimmed} does not name a previous step`)
      }
      const value = readPath(results[index], segments.slice(3))
      if (value === undefined) {
        throw new CustomToolCompositeError('custom-tool-composite-step-invalid', `${trimmed} resolved to no value`)
      }
      return typeof value === 'string' ? value : JSON.stringify(value)
    }
    const value = args[trimmed]
    if (value === undefined) {
      throw new CustomToolCompositeError('custom-tool-composite-step-invalid', `argument ${JSON.stringify(trimmed)} is missing`)
    }
    return String(value)
  })
}

/**
 * Execute one composite tool.
 * @param record - validated composite record.
 * @param args - arguments.
 * @param context - cancellation.
 * @param deps - registry and approval seams.
 * @returns the selected final value.
 */
export async function executeCompositeCustomTool(
  record: CustomToolRecord,
  args: Readonly<Record<string, unknown>>,
  context: CustomToolExecContext,
  deps: CompositeExecutorDeps = {},
): Promise<unknown> {
  if (record.execution.kind !== 'composite') {
    throw new CustomToolCompositeError('custom-tool-composite-step-invalid', `${record.id} is not a composite tool`)
  }
  if (deps.callTool === undefined) {
    throw new CustomToolCompositeError('custom-tool-composite-unavailable', 'no tool dispatcher is mounted for composite tools')
  }
  const results: unknown[] = []
  const selfName = deps.selfName ?? record.name
  for (const [index, step] of record.execution.composite.steps.entries()) {
    if (step.tool === selfName) {
      throw new CustomToolCompositeError('custom-tool-composite-step-invalid', `${record.id} may not call itself`)
    }
    if (step.requiresApproval === true) {
      if (deps.approve === undefined) {
        throw new CustomToolCompositeError('custom-tool-composite-approval-denied', `step ${index} (${step.tool}) requires approval, but no approval surface is mounted`)
      }
      if (!await deps.approve({ tool: step.tool, index })) {
        throw new CustomToolCompositeError('custom-tool-composite-approval-denied', `step ${index} (${step.tool}) was not approved`)
      }
    }
    const stepArgs: Record<string, unknown> = {}
    for (const [key, template] of Object.entries(step.args)) {
      stepArgs[key] = interpolate(template, args, results)
    }
    try {
      results.push(await deps.callTool(step.tool, stepArgs, context.signal))
    } catch (error) {
      throw new CustomToolCompositeError('custom-tool-composite-failed', `step ${index} (${step.tool}) failed`, { cause: error })
    }
  }
  const output = record.execution.composite.output
  if (output === undefined) return results[results.length - 1]
  if (output.startsWith('steps.')) {
    const segments = output.split('.')
    const index = Number(segments[1])
    if (!Number.isInteger(index) || index < 0 || index >= results.length) {
      throw new CustomToolCompositeError('custom-tool-composite-step-invalid', `${output} does not name a previous step`)
    }
    const value = readPath(results[index], segments.slice(3))
    return value
  }
  return interpolate(output, args, results)
}

export { asRecord }
