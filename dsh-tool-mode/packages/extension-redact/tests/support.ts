/**
 * Test helpers shared by the redact unit suites.
 *
 * Everything here is a fake: no tokenizer file, no model, no Wasm.
 *
 * @module tests/support
 */

import { Effect } from 'effect'

import type { LitertFeed, LitertSessionApi } from '@try-works/tool-mode-runtime-litert'

import type { RedactTokens, RedactTokenizer } from '../src/tokenizer.ts'

/** A tokenizer that always returns the supplied tokens. */
export function tokenizerFor(tokens: RedactTokens): RedactTokenizer {
  return { encode: async () => tokens }
}

/** A session whose outputs are computed synchronously from the feeds it receives. */
export function sessionFor(
  inputNames: readonly string[],
  produce: (feeds: Readonly<Record<string, LitertFeed>>) => Readonly<Record<string, Float32Array>>,
): LitertSessionApi {
  return {
    inputNames,
    run: (feeds) => Effect.sync(() => produce(feeds)),
  }
}

/** Build a row-major logits buffer with one high-scoring label per selected token row. */
export function logits(
  labels: readonly string[],
  rows: number,
  predictions: readonly { readonly row: number; readonly label: string }[],
): Float32Array {
  const out = new Float32Array(rows * labels.length)
  for (const prediction of predictions) {
    const index = labels.indexOf(prediction.label)
    if (index < 0) throw new Error('test prediction names an unknown label: ' + prediction.label)
    out[prediction.row * labels.length + index] = 12
  }
  return out
}

/** Resolve the failure an effect produces, or throw when it succeeds. */
export async function failureOf<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  try {
    await Effect.runPromise(effect)
  } catch (error) {
    return error as E
  }
  throw new Error('expected the effect to fail, but it succeeded')
}

/** A tag/message view of an unknown failure value. */
export function failureFields(value: unknown): { _tag?: string; message?: string; phase?: string } {
  if (typeof value !== 'object' || value === null) return {}
  const record = value as { _tag?: unknown; message?: unknown; phase?: unknown }
  return {
    ...(typeof record._tag === 'string' ? { _tag: record._tag } : {}),
    ...(typeof record.message === 'string' ? { message: record.message } : {}),
    ...(typeof record.phase === 'string' ? { phase: record.phase } : {}),
  }
}
