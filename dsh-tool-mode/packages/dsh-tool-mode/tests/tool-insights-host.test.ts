/**
 * S10 — host integration for Tool Insights (plan §4 S10).
 *
 * Mounts the REAL plugin and drives the ADDITIVE Remote methods through the provided
 * `modelTools` service. The session/extension services are fakes: the point is the
 * host half's wiring (projection registration, report aggregation, inventory, MCP
 * status), not the harness services themselves. The accounting hook is exercised over
 * the real MCP host binding, with its ledger row.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'

import * as plugin from '../src/index.ts'
import type { ModelToolsRemote } from '../src/extensions-api.ts'
import { foldToolUsageEvent, initToolUsageState, type ToolUsageEvent, type ToolUsageState } from '../src/tool-usage-projection.ts'
import { createMcpHost } from '../src/mcp/host-binding.ts'
import { McpUsageLedger, recordFromAccounting } from '../src/mcp-usage.ts'
import { cleanup, isolatedStateFile, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

/** One synthetic call/result pair for the fake projection state. */
function sessionState(): ToolUsageState {
  const before = Date.now()
  const events: ToolUsageEvent[] = [
    { type: 'request/header', time: before - 3, data: { header: { config: { provider: 'test', model: 'model-a' } } } },
    { type: 'tool/call', time: before - 2, data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' } },
    { type: 'tool/result', time: before - 1, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'c1' }, content: [] } } },
  ]
  let state = initToolUsageState()
  for (const event of events) state = foldToolUsageEvent(state, event)
  return state
}

/** Mount the plugin with a fake session store and projection registry. */
async function mountWithFakeSessions(state: ToolUsageState): Promise<{
  ctx: Context
  registered: { key?: string; stateVersion?: number }
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  const registered: { key?: string; stateVersion?: number } = {}
  ctx.provide('sessions', {
    list: () => [{ id: 'fake-session', header: { cwd: 'D:/work/insights' } }],
  })
  ctx.provide('sessionProjections', {
    register: (definition: { key: string; stateVersion: number }) => {
      registered.key = definition.key
      registered.stateVersion = definition.stateVersion
      return () => {}
    },
    stateOf: (_session: unknown, key: string) => key === 'toolModeUsage' ? state : undefined,
  })
  const extensionStore = tempDir()
  await ctx.plugin(plugin, { stateFile: isolatedStateFile(), extensionStore })
  return { ctx, registered }
}

describe('S10 host wiring', () => {
  it('registers the projection and serves toolSources/toolInventory/toolUsageReport', async () => {
    const { ctx, registered } = await mountWithFakeSessions(sessionState())
    assert.equal(registered.key, 'toolModeUsage')
    assert.equal(registered.stateVersion, 1)

    const service = ctx.get('modelTools') as ModelToolsRemote
    const sources = await service.toolSources!()
    assert.equal(sources.tools.some(tool => tool.name === 'model_tools'), true)
    assert.equal(sources.tools.find(tool => tool.name === 'model_tools')?.kind, 'tool-mode')

    const inventory = await service.toolInventory!()
    assert.equal(inventory.tools.some(tool => tool.name === 'model_tools'), true)
    assert.equal(inventory.tools.find(tool => tool.name === 'model_tools')?.mcpExposed, false)

    const report = await service.toolUsageReport!({ range: '7d' })
    assert.equal(report.calls, 1)
    assert.equal(report.workspaces[0]?.workspace, 'D:/work/insights')
    assert.equal(report.tools[0]?.name, 'read')
  })

  it('serves toolInventory without waiting for stored-history backfill', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    ctx.provide('sessions', { list: () => [] })
    ctx.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => undefined,
    })
    ctx.provide('sessionPersistence', {
      // A large profile's backfill must never block the inventory read.
      list: () => new Promise(() => {}),
    })
    await ctx.plugin(plugin, { stateFile: isolatedStateFile(), extensionStore: tempDir() })
    const service = ctx.get('modelTools') as ModelToolsRemote
    const inventory = await Promise.race([
      service.toolInventory!(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('toolInventory waited for backfill')), 500)),
    ])
    assert.equal(inventory.tools.some(tool => tool.name === 'model_tools'), true)
    assert.equal(inventory.tools.find(tool => tool.name === 'model_tools')?.mcpExposed, false)
  })

  it('bounds a report when the stored-session list itself hangs', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    ctx.provide('sessions', { list: () => [] })
    ctx.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => undefined,
    })
    ctx.provide('sessionPersistence', { list: () => new Promise(() => {}) })
    await ctx.plugin(plugin, { stateFile: isolatedStateFile(), extensionStore: tempDir() })
    const service = ctx.get('modelTools') as ModelToolsRemote
    const report = await Promise.race([
      service.toolUsageReport!({ range: 'all' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('report waited for a hung session list')), 1500)),
    ])
    assert.equal(report.range, 'all')
    assert.equal(report.calls, 0)
  })

  it('bounds a report when a stored read hangs', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    ctx.provide('sessions', { list: () => [] })
    ctx.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => undefined,
    })
    ctx.provide('sessionPersistence', {
      list: async () => [{ header: { id: 'slow-session', cwd: 'D:/work/slow' }, revision: 'r1' }],
      open: async () => ({
        inheritedEventCount: 0,
        read: () => new Promise(() => {}),
        close: async () => {},
      }),
    })
    await ctx.plugin(plugin, { stateFile: isolatedStateFile(), extensionStore: tempDir() })
    const service = ctx.get('modelTools') as ModelToolsRemote
    const report = await Promise.race([
      service.toolUsageReport!({ range: '7d' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('report waited for a hung stored read')), 1500)),
    ])
    assert.equal(report.range, '7d')
    assert.equal(report.calls, 0)
  })

  it('does not materialize uncached live sessions for toolInventory', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    ctx.provide('sessions', {
      list: () => Array.from({ length: 200 }, (_, index) => ({ id: `s-${index}`, header: { cwd: 'D:/work/many' } })),
    })
    ctx.provide('sessionProjections', {
      register: () => () => {},
      cachedSnapshot: () => undefined,
      stateOf: () => { throw new Error('stateOf must not be called for an uncached session') },
    })
    await ctx.plugin(plugin, { stateFile: isolatedStateFile(), extensionStore: tempDir() })
    const service = ctx.get('modelTools') as ModelToolsRemote
    const inventory = await Promise.race([
      service.toolInventory!(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('toolInventory materialized sessions')), 1000)),
    ])
    assert.equal(inventory.tools.some(tool => tool.name === 'model_tools'), true)
  })

  it('backfills a stored session that has no live projection cell', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    ctx.provide('sessions', { list: () => [] })
    ctx.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => undefined,
      restore: () => ({
        snapshot: { asOfSeq: 0, values: { toolModeUsage: { calls: 1 } } },
        checkpoint: { toolModeUsage: { ver: 1, seq: 0, val: sessionState() } },
      }),
    })
    const closed: string[] = []
    ctx.provide('sessionPersistence', {
      list: async () => [{ header: { id: 'stored-session', cwd: 'D:/work/stored' }, revision: 'r1' }],
      open: async (id: string) => ({
        inheritedEventCount: 0,
        read: async () => ({ events: [{} as never] }),
        close: async () => { closed.push(id) },
      }),
    })
    await ctx.plugin(plugin, { stateFile: isolatedStateFile(), extensionStore: tempDir() })
    const service = ctx.get('modelTools') as ModelToolsRemote
    // The first read starts the background warm; a later read serves its cache.
    const first = await service.toolUsageReport!({ range: '30d' })
    assert.equal(first.calls, 0)
    await new Promise(resolve => setTimeout(resolve, 50))
    const report = await service.toolUsageReport!({ range: '30d' })
    assert.equal(report.calls, 1)
    assert.equal(report.workspaces[0]?.workspace, 'D:/work/stored')
    assert.deepEqual(closed, ['stored-session'])
  })

  it('degrades to an empty report when the optional services are absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(plugin, { stateFile: isolatedStateFile(), extensionStore: tempDir() })
    const service = ctx.get('modelTools') as ModelToolsRemote
    const report = await service.toolUsageReport!({ range: '30d' })
    assert.equal(report.calls, 0)
    assert.equal(report.range, '30d')
  })

  it('reports a disabled MCP surface without a fabricated endpoint', async () => {
    const { ctx } = await mountWithFakeSessions(sessionState())
    const service = ctx.get('modelTools') as ModelToolsRemote
    const status = await service.mcpStatus!()
    assert.equal(status.enabled, false)
    assert.equal(status.listening, false)
    assert.equal(status.endpoint, null)
    const calls = await service.mcpCalls!({ page: 1, pageSize: 10 })
    assert.equal(calls.total, 0)
  })

  it('carries the tool name into external accounting and persists one ledger row', async () => {
    const file = join(tempDir(), 'mcp-usage.jsonl')
    const ledger = new McpUsageLedger(file, { maxRows: 100 })
    const accounted: Array<{ tool: string; receipt: string }> = []
    const host = createMcpHost({
      serverInfo: { name: 'test', version: '0.0.0' },
      surface: {
        published: [{
          toolName: 'read',
          contract: {
            contract: '@test/read',
            description: 'read a file',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          },
        }],
        execute: async () => ({ isError: false, value: { text: 'ok', meta: { receiptId: 'native-1' } } }),
      },
      onAccounted: (accounting, toolName) => {
        accounted.push({ tool: toolName, receipt: accounting.receiptId })
        // The host's own hook does exactly this (index.ts): append the bounded row.
        ledger.record(recordFromAccounting(toolName, accounting))
      },
    })
    // The hook's ledger wiring is the host's; this assertion pins the NAME it receives.
    const outcome = await host.callTool('read', {}, new AbortController().signal)
    assert.equal(outcome.isError, undefined)
    assert.deepEqual(accounted, [{ tool: 'read', receipt: 'native-1' }])
    const page = ledger.read({ page: 1, pageSize: 10 })
    assert.equal(page.total, 1)
    assert.equal(page.calls[0]?.tool, 'read')
    assert.equal(page.calls[0]?.receiptId, 'native-1')
  })
})
