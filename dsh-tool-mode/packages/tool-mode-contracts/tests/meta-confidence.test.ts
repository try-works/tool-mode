/** DECL-04 — the envelope can state every confidence category without inventing one. */
import assert from 'node:assert/strict'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'

import { TOOL_META_SCHEMA, type ConfidenceKind, type ToolMeta } from '../src/index.ts'

const validate = new Ajv2020({ strict: true, allErrors: true }).compile(TOOL_META_SCHEMA as object)

function meta(confidence?: { kind: ConfidenceKind; source: string }): Record<string, unknown> {
  return {
    contract: 'stt.transcribe',
    contractVersion: '1.0.0',
    implementationId: 'voz-onnx',
    extension: '@try-works/extension-desert-ant-voz',
    extensionVersion: '0.1.0',
    activationGeneration: 1,
    executionLocation: 'device',
    receiptId: 'receipt-1',
    warnings: [],
    ...confidence === undefined ? {} : { confidence },
  }
}

test('all four confidence categories validate in the output envelope', () => {
  const kinds: ConfidenceKind[] = ['vendor-reported', 'calibrated', 'ranking-logits', 'unavailable']
  for (const kind of kinds) {
    assert.equal(validate(meta({ kind, source: `test:${kind}` })), true, `${kind} must be representable`)
  }
})

test('absence is valid and means no confidence claim was made', () => {
  assert.equal(validate(meta()), true)
})

test('an unknown category or an empty source is refused rather than inferred', () => {
  assert.equal(validate(meta({ kind: 'guessed' as ConfidenceKind, source: 'host' })), false)
  assert.equal(validate(meta({ kind: 'calibrated', source: '' })), false)
})

test('the TypeScript envelope keeps confidence optional and typed', () => {
  const withoutConfidence: ToolMeta = meta() as unknown as ToolMeta
  assert.equal(withoutConfidence.confidence, undefined)
  const withConfidence: ToolMeta = meta({ kind: 'ranking-logits', source: 'cross-encoder' }) as unknown as ToolMeta
  assert.equal(withConfidence.confidence?.kind, 'ranking-logits')
})
