/**
 * R8 store integration: the surface verifiability claim must survive the real JSON
 * authoring store, not only a fake row. The digest cannot render a claim the store drops.
 *
 * @module tests/verifiability-store
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join } from 'node:path'

import { createAgentAuthoringStore, type ArtifactScopeContext } from '../src/agent-authoring.ts'
import { tempDir } from './helpers.ts'

const SCOPE: ArtifactScopeContext = { scope: 'workspace', scopeKey: 'workspace-r8', workspaceKey: 'workspace-r8' }

describe('R8 — the real store persists the verifiability claim', () => {
  it('writes, reloads and lists aggregate/per-item without inventing a claim', () => {
    const file = join(tempDir(), 'agent-authoring.json')
    const store = createAgentAuthoringStore({ file })
    store.saveTool({
      name: 'agent_aggregate', description: 'Counts.', inputSchema: { type: 'object', properties: {} },
      program: 'return 1', tools: [], verifiability: 'aggregate',
    }, SCOPE)
    store.saveTool({
      name: 'agent_per_item', description: 'Labels.', inputSchema: { type: 'object', properties: {} },
      program: 'return 2', tools: [], verifiability: 'per-item',
    }, SCOPE)
    store.saveTool({
      name: 'agent_unknown', description: 'No claim.', inputSchema: { type: 'object', properties: {} },
      program: 'return 3', tools: [],
    }, SCOPE)

    const reloaded = createAgentAuthoringStore({ file })
    assert.equal(reloaded.getTool('agent_aggregate', SCOPE)?.verifiability, 'aggregate')
    assert.equal(reloaded.getTool('agent_per_item', SCOPE)?.verifiability, 'per-item')
    assert.equal(reloaded.getTool('agent_unknown', SCOPE)?.verifiability, undefined)
    const rows = reloaded.listTools(SCOPE)
    assert.equal(rows.find(row => row.name === 'agent_aggregate')?.verifiability, 'aggregate')
    assert.equal(rows.find(row => row.name === 'agent_per_item')?.verifiability, 'per-item')
    assert.equal(rows.find(row => row.name === 'agent_unknown')?.verifiability, undefined)
  })
})
