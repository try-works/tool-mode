/**
 * Authored-artifact identity on invocation receipts.
 *
 * A receipt answers "what ran" for a call; when that call created or used an
 * authored artifact, the session and artifact identity must travel with it so the
 * artifact can be audited later. They are OPTIONAL: a call with no artifact keeps
 * a receipt with no invented identity, and no receipt ever carries the authored
 * program body (the builder has no such parameter at all).
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildInvocationReceipt } from '../src/receipt.ts'

/** The minimal host-resolved provenance for one call. */
type ReceiptInput = Parameters<typeof buildInvocationReceipt>[0]

/** A base receipt input with no artifact identity. */
function base(): ReceiptInput {
  return {
    receiptId: 'rcpt_artifact_1',
    contract: 'text.language_detect',
    contractVersion: '1.0.0',
    implementationId: 'tongue',
    extension: '@try-works/extension-desert-ant-tongue',
    extensionVersion: '1.0.0',
    modelIdentity: 'tongue',
    activationGeneration: 2,
    executionLocation: 'host',
  }
}

test('session and artifact identity are copied through when supplied', () => {
  const receipt = buildInvocationReceipt({
    ...base(),
    sessionId: 'session-1',
    rootSessionId: 'root-1',
    artifactScope: 'tool',
    artifactName: 'agent_echo',
    artifactDigest: 'sha256:abc123',
  })
  assert.equal(receipt.sessionId, 'session-1')
  assert.equal(receipt.rootSessionId, 'root-1')
  assert.equal(receipt.artifactScope, 'tool')
  assert.equal(receipt.artifactName, 'agent_echo')
  assert.equal(receipt.artifactDigest, 'sha256:abc123')
})

test('absent identity fields stay absent instead of being invented', () => {
  const receipt = buildInvocationReceipt(base())
  for (const key of ['sessionId', 'rootSessionId', 'artifactScope', 'artifactName', 'artifactDigest']) {
    assert.equal(Object.hasOwn(receipt, key), false, key + ' must not appear without a value')
  }
})

test('a receipt never carries a program body', () => {
  const program = 'const PROGRAM_BODY_MARKER = "leak-me"; return await tools.lang_detect({ text: "hi" })'
  const receipt = buildInvocationReceipt({
    ...base(),
    artifactScope: 'tool',
    artifactName: 'agent_echo',
    artifactDigest: 'sha256:def456',
  })
  const serialized = JSON.stringify(receipt)
  assert.equal(Object.hasOwn(receipt, 'program'), false)
  assert.equal(serialized.includes('PROGRAM_BODY_MARKER'), false)
  assert.equal(serialized.includes(program), false)
  for (const key of ['code', 'body', 'program']) {
    assert.equal(Object.hasOwn(receipt, key), false, key + ' must not be part of a receipt')
  }
})
