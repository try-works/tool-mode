/**
 * Compile a validated custom-tool record into a real DSH tool definition.
 *
 * The authoring record is data; this module is the only place that turns it into
 * the executable definition the registry consumes. Executors are injected so the
 * HTTP/prompt/composite slices can be tested independently.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/compile
 */

import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { projectSchemaToDsh } from '@try-works/tool-mode-contracts'
import type { CustomToolRecord } from './types.ts'

/** Execution context a custom-tool executor needs. */
export interface CustomToolExecContext {
  readonly signal: AbortSignal
}

/** The executor contract shared by all three kinds. */
export type CustomToolExecutor = (
  record: CustomToolRecord,
  args: Readonly<Record<string, unknown>>,
  context: CustomToolExecContext,
) => Promise<unknown>

/**
 * Compile one record. Validation is the caller's responsibility; the store and
 * save path validate before calling this.
 * @param record - validated authoring record.
 * @param execute - kind-specific executor.
 * @returns the definition accepted by `ctx.tools.register`.
 */
export function compileCustomTool(record: CustomToolRecord, execute: CustomToolExecutor) {
  const outputSchema = record.outputSchema === undefined
    ? undefined
    : {
        type: 'object',
        properties: projectSchemaToDsh(record.outputSchema).parameters,
        additionalProperties: false,
      }
  const parameters = projectSchemaToDsh(record.parameters).parameters
  const declaredOutput = outputSchema === undefined
    ? { type: 'object', additionalProperties: true }
    : outputSchema
  return defineTool({
    name: record.name,
    description: record.description,
    parameters: parameters as unknown as ParameterSchemaSpec,
    output: {
      schema: declaredOutput as unknown as ValueSchemaSpec,
      render: (_args: unknown, value: unknown) => [{
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value),
      }],
    },
    timeoutMs: record.policy.timeoutMs,
    async execute(args, exec) {
      const value = await execute(record, args as Readonly<Record<string, unknown>>, { signal: exec.signal })
      // With no declared output schema the registry advertises an open object.
      // Preserve a scalar/list result inside that envelope instead of dropping it.
      if (outputSchema === undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        return { result: value } as never
      }
      return value as never
    },
    presentCall() {
      return {
        card: 'generic',
        title: record.title,
        kind: record.policy.readOnly ? 'read' : 'execute',
      }
    },
  })
}
