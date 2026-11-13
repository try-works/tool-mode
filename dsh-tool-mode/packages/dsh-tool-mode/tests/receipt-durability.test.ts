/**
 * Slice 2 — durable invocation receipts (task-37).
 *
 * `index.ts` keeps a bounded in-memory ring, so a restart lost every receipt. The
 * store below persists them next to the configured state file, atomically and
 * bounded, and quarantines malformed data instead of silently treating it as empty.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createFileReceiptStore,
  receiptCounterFloor,
  receiptStorePathFor,
} from '../src/receipt-store.ts'
import { MAX_RETAINED_RECEIPTS, type InvocationReceipt } from '../src/receipt.ts'
import { callTool, cleanup, mountPluginWithTongue } from './helpers.ts'

const dirs: string[] = []
after(async () => {
  await cleanup()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function receiptFor(receiptId: string): InvocationReceipt {
  return {
    receiptId,
    contract: 'text.language_detect',
    contractVersion: '1.0.0',
    implementationId: 'tongue',
    extension: '@try-works/extension-desert-ant-tongue',
    extensionVersion: '0.0.1',
    extensionContentDigest: null,
    dependencyLockDigest: null,
    modelIdentity: 'tongue',
    recipeVersion: null,
    activationGeneration: 1,
    executionLocation: 'host',
    warnings: [],
  }
}

function dir(): string {
  const created = mkdtempSync(join(tmpdir(), 'receipt-durability-'))
  dirs.push(created)
  return created
}

/** The receipts array a management `receipts` action returns. */
function receiptsOf(result: { readonly value?: unknown }): Array<{ readonly receiptId: string }> {
  // SAFETY: the receipts action's documented result carries a receipts array; this
  // helper is the test's single boundary read of that shape.
  const value = result.value as { readonly receipts?: Array<{ readonly receiptId: string }> }
  return value.receipts ?? []
}

describe('durable receipt store', () => {
  it('survives a new store instance at the same path', () => {
    const path = receiptStorePathFor(join(dir(), 'state.json'))
    const first = createFileReceiptStore(path)
    first.append(receiptFor('rcpt_000001'))

    const second = createFileReceiptStore(path)
    assert.deepEqual(second.records.map(receipt => receipt.receiptId), ['rcpt_000001'])
  })

  it('stays bounded at MAX_RETAINED_RECEIPTS and keeps the newest', () => {
    const path = receiptStorePathFor(join(dir(), 'state.json'))
    const store = createFileReceiptStore(path)
    for (let index = 0; index <= MAX_RETAINED_RECEIPTS + 4; index += 1) {
      store.append(receiptFor(`rcpt_${(index + 1).toString(36).padStart(6, '0')}`))
    }

    const reloaded = createFileReceiptStore(path)
    assert.equal(reloaded.records.length, MAX_RETAINED_RECEIPTS)
    const ids = reloaded.records.map(receipt => receipt.receiptId)
    assert.equal(ids.includes('rcpt_000001'), false, 'the oldest receipts are dropped')
    assert.equal(ids.at(-1), `rcpt_${(MAX_RETAINED_RECEIPTS + 5).toString(36).padStart(6, '0')}`)
  })

  it('quarantines malformed store data instead of treating it as empty', () => {
    const path = receiptStorePathFor(join(dir(), 'state.json'))
    writeFileSync(path, '{not valid json')
    const quarantined: string[] = []
    const store = createFileReceiptStore(path, {
      onQuarantine: diagnostic => quarantined.push(diagnostic.quarantinePath),
    })

    assert.deepEqual(store.records, [])
    assert.equal(store.quarantinePath === undefined, false, 'the store records where the bad data went')
    assert.equal(existsSync(store.quarantinePath!), true)
    assert.equal(readFileSync(store.quarantinePath!, 'utf8'), '{not valid json')
    assert.deepEqual(quarantined, [store.quarantinePath])
    assert.equal(existsSync(path), false, 'the malformed file is moved aside, not silently overwritten')
  })

  it('continues ids across a restart and keeps the persisted receipt readable', async () => {
    const stateFile = join(dir(), 'state.json')

    const first = await mountPluginWithTongue({ stateFile })
    const firstCall = await callTool(first, 'lang_detect', { text: 'hallo wereld' })
    assert.equal(firstCall.isError, false, JSON.stringify(firstCall))
    const firstReceipts = await callTool(first, 'model_tools', { action: 'receipts' })
    assert.equal(firstReceipts.isError, false, JSON.stringify(firstReceipts))
    const firstIds = receiptsOf(firstReceipts).map(receipt => receipt.receiptId)
    assert.ok(firstIds.length > 0)
    const firstId = firstIds[0]!
    await first.fiber.dispose()

    const second = await mountPluginWithTongue({ stateFile })
    const afterRestart = await callTool(second, 'model_tools', { action: 'receipts' })
    const afterIds = receiptsOf(afterRestart).map(receipt => receipt.receiptId)
    assert.ok(afterIds.includes(firstId), `the persisted receipt ${firstId} must survive; got ${afterIds.join(', ')}`)

    const secondCall = await callTool(second, 'lang_detect', { text: 'bonjour le monde' })
    assert.equal(secondCall.isError, false, JSON.stringify(secondCall))
    const third = await callTool(second, 'model_tools', { action: 'receipts' })
    const thirdIds = receiptsOf(third).map(receipt => receipt.receiptId)
    const newId = thirdIds.find(id => !afterIds.includes(id))
    assert.equal(newId === undefined, false, 'the new call records a new receipt')
    assert.equal(newId === firstId, false, 'a post-restart receipt id must not repeat the first id')

    const floor = receiptCounterFloor(createFileReceiptStore(receiptStorePathFor(stateFile)).records)
    assert.ok(floor >= Number.parseInt(firstId.slice('rcpt_'.length), 36))
    await second.fiber.dispose()
  })
})
