/**
 * BASE-06 — the MCP export allowlist is a separate control from native `models`.
 *
 * `undefined` preserves the pre-existing surface; an EMPTY allowlist exports no
 * inference tools; a named list admits exactly those names. Denied rows stay in
 * the surface as WITHHELD rows so `mcpStatus` can explain the absence.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyMcpExportPolicy, MCP_EXPORT_DENIED_REASON } from '../src/mcp/export-policy.ts'
import type { PublishedTool } from '../src/mcp/host-binding.ts'

function row(name: string): PublishedTool {
  return {
    toolName: name,
    // The policy does not read the contract; a structurally valid marker is enough.
    contract: { toolName: name } as never,
  }
}

describe('BASE-06 MCP export allowlist', () => {
  it('leaves the surface untouched when no allowlist is configured', () => {
    const published = [row('lang_detect'), row('text_embed')]
    const result = applyMcpExportPolicy(published, undefined)
    assert.deepEqual(result.map(entry => entry.toolName), ['lang_detect', 'text_embed'])
    assert.equal(result.some(entry => entry.notExportableReason !== undefined), false)
    const wildcard = applyMcpExportPolicy(published, ['*'])
    assert.deepEqual(wildcard.map(entry => entry.notExportableReason), [undefined, undefined])
  })

  it('exports no inference tools when the allowlist is empty', () => {
    const result = applyMcpExportPolicy([row('lang_detect'), row('text_embed')], [])
    assert.deepEqual(result.map(entry => entry.toolName), ['lang_detect', 'text_embed'])
    assert.equal(result.every(entry => entry.notExportableReason === MCP_EXPORT_DENIED_REASON), true)
  })

  it('admits exactly the named tools and withholds the rest with a reason', () => {
    const result = applyMcpExportPolicy([row('lang_detect'), row('text_embed')], ['lang_detect'])
    const byName = new Map(result.map(entry => [entry.toolName, entry]))
    assert.equal(byName.get('lang_detect')?.notExportableReason, undefined)
    assert.equal(byName.get('text_embed')?.notExportableReason, MCP_EXPORT_DENIED_REASON)
  })

  it('does not widen matches by case, prefix or duplicates', () => {
    const result = applyMcpExportPolicy([row('lang_detect')], ['LANG_DETECT', 'lang_detect_extra', 'lang_detect'])
    assert.equal(result[0]?.notExportableReason, undefined, 'the exact name is admitted')
    const denied = applyMcpExportPolicy([row('lang_detect')], ['LANG_DETECT'])
    assert.equal(denied[0]?.notExportableReason, MCP_EXPORT_DENIED_REASON)
  })
})
