/**
 * model_tools receipts render (0.5.112 live defect).
 *
 * The receipts action returns { models: [], installed, runnable, receipts: [...] }.
 * The shared renderer treated every action as a model list and printed
 * "9 of 0 catalogued models are installed as tools" while ignoring the receipts.
 *
 * @module tests/model-tools-receipts-render
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mountPluginWithTongue, callTool, resultText } from './helpers.ts'

describe('model_tools receipts render', () => {
  it('never claims "N of 0 catalogued models" and shows the receipts', async () => {
    const ctx = await mountPluginWithTongue()
    // A discovery call records a receipt for the window.
    await callTool(ctx, 'tool_mode_list', {})
    const receipts = await callTool(ctx, 'model_tools', { action: 'receipts' })
    assert.equal(receipts.isError, false, resultText(receipts))
    const text = resultText(receipts)
    assert.ok(!text.includes('of 0 catalogued models'), 'a receipts payload has no model list: ' + text)
    assert.match(text, /receipt/i, 'the receipts action must render receipts: ' + text)
    assert.match(text, /rcpt_/, 'the rendered receipts must carry their ids: ' + text)
  })

  it('still renders the model inventory for the list action', async () => {
    const ctx = await mountPluginWithTongue()
    const listed = await callTool(ctx, 'model_tools', { action: 'list' })
    assert.equal(listed.isError, false, resultText(listed))
    assert.match(resultText(listed), /of 18 catalogued models are installed as tools/)
  })
})
