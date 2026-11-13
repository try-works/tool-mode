/**
 * Prompt custom-tool executor.
 *
 * A prompt tool is deliberately not a workflow or an agent: it performs exactly
 * one model call with a template and returns text. The model provider is an
 * injected seam; this module never resolves credentials, tools or files.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/prompt-executor
 */

import type { CustomToolExecContext } from './compile.ts'
import type { CustomToolRecord } from './types.ts'

/** A named prompt-execution refusal. */
export class CustomToolPromptError extends Error {
  override readonly name = 'CustomToolPromptError'
  readonly code:
    | 'custom-tool-prompt-unavailable'
    | 'custom-tool-prompt-template-invalid'
    | 'custom-tool-prompt-failed'

  constructor(code: CustomToolPromptError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

/** The one model call a prompt tool may make. */
export interface PromptRunInput {
  readonly prompt: string
  readonly model?: string
  readonly maxOutputTokens?: number
  readonly signal: AbortSignal
}

/** Prompt executor seams. */
export interface PromptExecutorDeps {
  /** Absent means the deployment composes no model provider. */
  readonly runPrompt?: (input: PromptRunInput) => Promise<string>
}

const TEMPLATE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g

function interpolate(template: string, args: Readonly<Record<string, unknown>>): string {
  return template.replace(TEMPLATE, (_whole, name: string) => {
    const value = args[name]
    if (value === undefined) {
      throw new CustomToolPromptError('custom-tool-prompt-template-invalid', `argument ${JSON.stringify(name)} is missing`)
    }
    return String(value)
  })
}

/**
 * Execute one prompt tool.
 * @param record - validated prompt record.
 * @param args - arguments.
 * @param context - cancellation.
 * @param deps - model seam.
 * @returns the model text.
 */
export async function executePromptCustomTool(
  record: CustomToolRecord,
  args: Readonly<Record<string, unknown>>,
  context: CustomToolExecContext,
  deps: PromptExecutorDeps = {},
): Promise<string> {
  if (record.execution.kind !== 'prompt') {
    throw new CustomToolPromptError('custom-tool-prompt-template-invalid', `${record.id} is not a prompt tool`)
  }
  if (deps.runPrompt === undefined) {
    throw new CustomToolPromptError('custom-tool-prompt-unavailable', 'no model provider is composed for prompt tools')
  }
  const prompt = interpolate(record.execution.prompt.template, args)
  try {
    return await deps.runPrompt({
      prompt,
      ...record.execution.prompt.model === undefined ? {} : { model: record.execution.prompt.model },
      ...record.execution.prompt.maxOutputTokens === undefined ? {} : { maxOutputTokens: record.execution.prompt.maxOutputTokens },
      signal: context.signal,
    })
  } catch (error) {
    if (error instanceof CustomToolPromptError) throw error
    throw new CustomToolPromptError('custom-tool-prompt-failed', `the prompt tool failed`, { cause: error })
  }
}
