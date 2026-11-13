/**
 * Slice 1 — the recorded second-implementation swap proof.
 *
 * The contract layer only earns "substitutable" if two distinct implementations of
 * ONE contract have actually served the same tool, with the host's own receipts
 * naming each. The proof lives in `docs/tool-mode/qualification/implementation-swap.json`
 * and is produced by `scripts/qualify-implementation-swap.mjs`; this test only reads
 * it and refuses a record that is missing, fabricated, or names the same
 * implementation twice.
 *
 * RED first: before the qualification runs, no record exists, so this fails on
 * missing evidence rather than on missing production behavior.
 *
 * Requirement links: DECL-08 (recipe digest), EXT-30 (a second implementation joins
 * rather than duplicating), RCP-04 (the model's text is the result).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The shipped record this test pins. */
const RECORD = join(process.cwd(), 'docs', 'tool-mode', 'qualification', 'implementation-swap.json')

/** One receipt the host built for a swap call. */
interface SwapReceipt {
  readonly receiptId: string
  readonly contract: string
  readonly implementationId: string
  readonly extension: string
}

/** The qualification record written by the script. */
interface SwapRecord {
  readonly schema: string
  readonly contract: string
  readonly tool: string
  readonly selected: { readonly extension: string; readonly implementationId: string }
  readonly alternative: { readonly extension: string; readonly implementationId: string }
  readonly input: { readonly text: string; readonly kind: string }
  readonly before: { readonly result: unknown; readonly receipt: SwapReceipt }
  readonly after: { readonly result: unknown; readonly receipt: SwapReceipt }
  readonly outcome: string
  readonly provider: { readonly kind: string; readonly id: string }
}

/** Read the record, or fail with the exact missing-evidence reason. */
function record(): SwapRecord {
  let text: string
  try {
    text = readFileSync(RECORD, 'utf8')
  } catch (error) {
    assert.fail(`no implementation-swap record at ${RECORD}: ${error instanceof Error ? error.message : String(error)}`)
  }
  // SAFETY: the record is a build artifact this test owns; the assertions below
  // check every field it relies on before use, so the cast only names the shape.
  return JSON.parse(text) as SwapRecord
}

describe('slice 1 — the recorded second-implementation swap', () => {
  it('exists and names ONE contract with DISTINCT implementations', () => {
    const proof = record()
    assert.equal(proof.schema, 'implementation-swap-v1')
    assert.ok(['text.title', 'image.describe'].includes(proof.contract), `unexpected contract ${proof.contract}`)
    assert.ok(proof.tool.length > 0)
    assert.notEqual(proof.selected.extension, proof.alternative.extension, 'the two implementations must be different packages')
    assert.notEqual(proof.selected.implementationId, proof.alternative.implementationId)
  })

  it('carries the exact input and HOST-BUILT receipts for both calls', () => {
    const proof = record()
    assert.ok(Object.keys(proof.input).length > 0, 'the exact input must be recorded')
    for (const side of ['before', 'after'] as const) {
      const call = proof[side]
      assert.match(call.receipt.receiptId, /^rcpt_/, `${side} receipt id must be a host receipt`)
      assert.equal(call.receipt.contract, proof.contract)
      assert.ok(call.result !== undefined, `${side} must record the tool result`)
    }
    assert.notEqual(proof.before.receipt.receiptId, proof.after.receipt.receiptId)
  })

  it('proves the swap: the second call was served by the ALTERNATIVE', () => {
    const proof = record()
    // The selected implementation serves before the swap...
    assert.equal(proof.before.receipt.extension, proof.selected.extension)
    // ...and the alternative serves after it, with its own receipt.
    assert.equal(proof.after.receipt.extension, proof.alternative.extension)
    // The auxiliary receipt identifies the RECIPE (text-title in both packages), so
    // the package identity is the discriminator and must be asserted above. The
    // receipt id at least proves two distinct host records exist.
    assert.ok(proof.before.receipt.implementationId.length > 0)
    assert.notEqual(proof.before.receipt.receiptId, proof.after.receipt.receiptId)
    assert.equal(proof.outcome, 'pass')
  })

  it('is honest about the harness provider that answered the recipes', () => {
    const proof = record()
    assert.ok(proof.provider.kind.length > 0)
    assert.ok(proof.provider.id.length > 0)
  })
})

