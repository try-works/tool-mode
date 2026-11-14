/**
 * Shared helpers for the runtime-core tests.
 *
 * These tests are pure: they build layers and run Effects in-process. No model
 * runs, no network is touched and nothing is written outside a temp directory
 * created by {@link withTempDir}.
 *
 * @module tests/support
 */

/*
 * These are test-boundary helpers: they catch arbitrary rejection values and
 * serialise arbitrary fixtures, so `unknown` is the honest type here. Every
 * concrete assertion happens in the test that knows what it expects.
 */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CatalogEntry } from '../src/ports.ts'

/**
 * Run a promise that is expected to fail and return the failure value.
 *
 * `Effect.runPromise` rejects with the failure value when the error is an
 * `Error` (every `Schema.TaggedError` is), so this is the shortest way to
 * assert on a typed failure channel without digging into `Exit`.
 *
 * @param promise - the derived promise
 * @returns the rejection value
 */
export async function failureOf<A>(promise: Promise<A>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail('expected the effect to fail, but it succeeded')
}

/**
 * Run a test body with a fresh temp directory that is always removed again.
 *
 * @param use - the body
 * @returns whatever the body returns
 */
export async function withTempDir<A>(use: (dir: string) => Promise<A>): Promise<A> {
  const dir = await mkdtemp(join(tmpdir(), 'tool-mode-runtime-core-'))
  try {
    return await use(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Write a JSON document, creating the parent directory if needed.
 *
 * @param path - destination file
 * @param value - the value to serialise
 */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

/**
 * A complete, valid catalog entry with per-test overrides.
 *
 * @param overrides - fields to replace
 * @returns the entry
 */
export function sampleEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'redact',
    version: '1.0.0',
    digest: 'sha256:model-digest',
    format: 'tflite',
    artifact: {
      assetSet: 'redact',
      fileName: 'redact.tflite',
      sha256: 'a'.repeat(64),
      bytes: 1_048_576,
    },
    processor: { id: 'redact-wordpiece', version: '1.0.0' },
    accelerators: ['cpu'],
    limits: { maxInputBytes: 65_536, timeoutMs: 5_000 },
    ...overrides,
  }
}
