/**
 * Kind dispatch for custom tools.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/dispatch
 */

import type { CustomToolExecContext, CustomToolExecutor } from './compile.ts'
import { executeCompositeCustomTool, type CompositeExecutorDeps } from './composite-executor.ts'
import { executeHttpCustomTool, type HttpExecutorDeps } from './http-executor.ts'
import { executePromptCustomTool, type PromptExecutorDeps } from './prompt-executor.ts'
import type { CustomToolRecord } from './types.ts'

/** One deps object for all three kinds. */
export interface CustomToolDispatchDeps {
  readonly http?: HttpExecutorDeps
  readonly prompt?: PromptExecutorDeps
  readonly composite?: CompositeExecutorDeps
}

/**
 * Execute a record according to its validated kind.
 * @param record - validated record.
 * @param args - model-supplied arguments.
 * @param context - cancellation.
 * @param deps - kind-specific seams.
 * @returns the canonical result value.
 */
export async function executeCustomTool(
  record: CustomToolRecord,
  args: Readonly<Record<string, unknown>>,
  context: CustomToolExecContext,
  deps: CustomToolDispatchDeps = {},
): Promise<unknown> {
  switch (record.execution.kind) {
    case 'http':
      return executeHttpCustomTool(record, args, context, deps.http ?? {})
    case 'prompt':
      return executePromptCustomTool(record, args, context, deps.prompt ?? {})
    case 'composite':
      return executeCompositeCustomTool(record, args, context, {
        ...deps.composite,
        selfName: record.name,
      })
  }
}

/** Adapt dispatch deps into the registrar's executor signature. */
export function customToolExecutor(deps: CustomToolDispatchDeps): CustomToolExecutor {
  return (record, args, context) => executeCustomTool(record, args, context, deps)
}
