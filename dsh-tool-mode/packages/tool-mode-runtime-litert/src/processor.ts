/**
 * The processor seam between the declarative recipe factory and one model's JSON contract.
 *
 * A recipe names a processor id; the engine package owns the processors it implements. Each
 * processor validates the tool input, maps it onto tensors, drives LitertSession, and returns
 * exactly the keys its tool schema declares. The factory knows nothing about any one model.
 */

import type { Effect } from 'effect'

import type { InvocationContextV1, JsonObject } from '@try-works/tool-mode-extension-sdk'
import {
  InferenceFailed,
  InvalidInput,
  RuntimeUnavailable,
} from '@try-works/tool-mode-runtime-core'

import { describeCause } from './errors.ts'
import type { LitertSession } from './runtime.ts'

/** The recipe limits in force for one invocation. */
export interface ProcessorLimits {
  readonly maxInputBytes: number
  readonly timeoutMs: number
}

/** One tool invocation, already carrying the host-granted call context. */
export interface ProcessorInvocation {
  readonly input: Readonly<JsonObject>
  readonly context: InvocationContextV1
  readonly limits: ProcessorLimits
  /**
   * The verified asset-set directory the model artifact was resolved from. Processors whose
   * deployment ships sibling files (the ear mel bank and language list) read them here; the
   * files are part of the same host-verified asset set as the model.
   */
  readonly assetDirectory: string
}

/** One model's processor: the recipe selects it by id. */
export interface RecipeProcessor {
  readonly id: string
  readonly features: readonly string[]
  readonly invoke: (
    invocation: ProcessorInvocation,
  ) => Effect.Effect<JsonObject, InvalidInput | InferenceFailed | RuntimeUnavailable, LitertSession>
}

/** Render a typed failure, or any thrown value, as one readable sentence. */
export function describeFailure(cause: unknown): string {
  if (cause instanceof InvalidInput) return cause.field + ': ' + cause.message
  if (cause instanceof InferenceFailed) return cause.phase + ': ' + cause.message
  if (cause instanceof RuntimeUnavailable) return cause.reason
  if (cause instanceof Error) return cause.message.length > 0 ? cause.message : cause.name
  return describeCause(cause)
}

/** The JSON byte size of a tool input. */
export function inputBytes(input: Readonly<JsonObject>): number {
  return Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8')
}

/** Refuse an input over the recipe's byte ceiling. */
export function inputCeilingFailure(input: Readonly<JsonObject>, limits: ProcessorLimits): InvalidInput | undefined {
  const bytes = inputBytes(input)
  if (bytes <= limits.maxInputBytes) return undefined
  return new InvalidInput({
    field: 'input',
    message: 'the input is ' + String(bytes) + ' bytes, over the ' + String(limits.maxInputBytes) + '-byte input limit',
  })
}

/** Refuse any input key outside the tool schema's closed key set. */
export function closedKeyFailure(
  input: Readonly<JsonObject>,
  allowed: ReadonlySet<string>,
  accepts: string,
): InvalidInput | undefined {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      return new InvalidInput({
        field: key,
        message: 'the input accepts only ' + accepts + '; received ' + JSON.stringify(key),
      })
    }
  }
  return undefined
}
