/**
 * Repeated-shape detection: a read-only report, never an automatic artifact.
 *
 * The test pins the two properties that matter: the shape is built from host
 * metadata only (no values), and two identical sequences are counted while a
 * one-off sequence is not.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildInvocationReceipt, type InvocationReceipt } from '../src/receipt.ts'
import { findRepeatedShapes } from '../src/repeated-shapes.ts'

function receipt(id: string, runId: string, contract: string, callId?: string): InvocationReceipt {
  return buildInvocationReceipt({
    receiptId: id,
    runId,
    parentReceiptId: runId,
    callId,
    argumentPaths: ['text'],
    contract,
    contractVersion: '1.0.0',
    implementationId: contract + '-impl',
    extension: '@try-works/test',
    extensionVersion: '0.1.0',
    modelIdentity: 'test',
    activationGeneration: 1,
    executionLocation: 'device',
    at: '2026-11-17T00:00:00.000Z',
  })
}

describe('repeated-shape report', () => {
  it('counts two identical call sequences and ignores a one-off', () => {
    const composition = (runId: string, callIds: string[]): InvocationReceipt[] => [
      buildInvocationReceipt({
        receiptId: runId,
        runId,
        contract: 'hosted.tool_mode_run',
        contractVersion: '1.0.0',
        implementationId: 'host',
        extension: '@try-works/dsh-tool-mode',
        extensionVersion: '0.5.82',
        modelIdentity: 'host',
        activationGeneration: 1,
        executionLocation: 'host',
        at: '2026-11-17T00:00:00.000Z',
        dataFlow: callIds.slice(1).map((callId, index) => ({
          from: callIds[index]!,
          to: callId,
          input: 'input',
          evidence: 'same-value',
        })),
      }),
      ...callIds.map(callId => receipt('r-' + runId + '-' + callId, runId, 'text.embed', callId)),
    ]
    const receipts = [
      ...composition('run-1', ['c1', 'c2']),
      ...composition('run-2', ['c3', 'c4']),
      ...composition('run-3', ['c5']),
    ]
    const shapes = findRepeatedShapes(receipts)
    assert.equal(shapes.length, 1)
    assert.equal(shapes[0]?.count, 2)
    assert.deepEqual(shapes[0]?.steps.map(step => step.contract), ['text.embed', 'text.embed'])
    // Wiring is present even though the fixture's dataFlow points at no input.
    assert.deepEqual(shapes[0]?.steps.map(step => step.arguments), [['text'], ['text']])
    assert.equal(JSON.stringify(shapes[0]).includes('secret'), false)
  })

  it('returns no report when every run is unique', () => {
    const receipts = [
      ...['run-a', 'run-b'].flatMap(runId => [
        buildInvocationReceipt({
          receiptId: runId, runId, contract: 'hosted.tool_mode_run', contractVersion: '1.0.0',
          implementationId: 'host', extension: '@try-works/dsh-tool-mode', extensionVersion: '0.5.82',
          modelIdentity: 'host', activationGeneration: 1, executionLocation: 'host',
        }),
        receipt('r-' + runId, runId, runId === 'run-a' ? 'text.embed' : 'text.rerank', 'c1'),
      ]),
    ]
    assert.deepEqual(findRepeatedShapes(receipts), [])
  })
})
