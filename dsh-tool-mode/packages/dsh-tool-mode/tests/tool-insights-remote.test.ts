/**
 * S6 — the additive Tool Insights Remote methods (plan §3.5, S6).
 *
 * The wire contract is `remote/spec.mjs`: descriptors, strict codecs and the generated
 * artifacts all come from it. This test pins the five additive methods, the optional
 * `query` parameter, the strict codecs (including field stripping) and the compatibility
 * rule: a service without the new optional methods still binds.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { bindModelToolsRemote, provideModelToolsService } from '../src/extensions-remote.ts'
import type { ModelToolsRemote } from '../src/extensions-api.ts'
import { METHOD_SPECS, descriptorsFromModelToolsSpecs, parseModelToolsValue, PACKAGE, SERVICE, NAMESPACE } from '../remote/spec.mjs'
import { buildUsageReport, rangeWindow } from '../src/tool-usage-report.ts'
import { initToolUsageState } from '../src/tool-usage-projection.ts'

const NEW_METHODS = ['toolSources', 'toolInventory', 'mcpStatus', 'mcpCalls', 'toolUsageReport']

/** The base service an older host provides. */
function baseService(): ModelToolsRemote {
  const unused = async (): Promise<never> => { throw new Error('not called') }
  return {
    describe: unused,
    install: unused,
    enable: unused,
    disable: unused,
    prepare: unused,
  }
}

describe('S6 descriptors and codecs', () => {
  it('declares the five additive methods with an optional query parameter', () => {
    const methods = METHOD_SPECS.map(spec => spec.method)
    for (const method of [...NEW_METHODS, 'describe', 'installExtension']) {
      assert.equal(methods.includes(method), true, `missing method ${method}`)
    }
    const descriptors = descriptorsFromModelToolsSpecs(PACKAGE, SERVICE, NAMESPACE, METHOD_SPECS)
    for (const method of NEW_METHODS) {
      assert.equal(descriptors.some(descriptor => descriptor.method === method), true, `missing descriptor ${method}`)
    }
    for (const method of ['mcpCalls', 'toolUsageReport']) {
      const spec = METHOD_SPECS.find(candidate => candidate.method === method)
      const query = spec?.parameters[0]
      assert.equal(query?.name, 'query')
      assert.equal(query?.acceptsUndefined, true)
      assert.equal(query?.schema.kind, 'optional')
    }
  })

  it('parses a realistic usage report and strips undeclared fields', () => {
    const report = buildUsageReport([], rangeWindow('7d', 1_700_000_000_000))
    const spec = METHOD_SPECS.find(candidate => candidate.method === 'toolUsageReport')
    assert.ok(spec !== undefined)
    const parsed = parseModelToolsValue(spec.result.schema, { ...report, injected: 'nope' })
    assert.equal(parsed.injected, undefined, 'the strict boundary drops unknown fields')
    assert.equal(parsed.range, '7d')
    assert.equal(parsed.histogramScope, 'retained')
    assert.throws(() => parseModelToolsValue(spec.result.schema, { ...report, range: '90d' }), /matched no union variant/)
  })

  it('validates an empty inventory page and an MCP status', () => {
    const inventory = METHOD_SPECS.find(candidate => candidate.method === 'toolInventory')
    assert.ok(inventory !== undefined)
    assert.deepEqual(parseModelToolsValue(inventory.result.schema, { tools: [] }), { tools: [] })
    const status = METHOD_SPECS.find(candidate => candidate.method === 'mcpStatus')
    assert.ok(status !== undefined)
    const parsed = parseModelToolsValue(status.result.schema, {
      enabled: false,
      listening: false,
      endpoint: null,
      configured: null,
      transport: 'http',
      auth: { scheme: 'none', mode: 'none', tokenFile: null },
      uptimeMs: 0,
      clients: [],
      exposed: [],
      withheld: [],
      exposedCount: 0,
      withheldCount: 0,
    })
    assert.equal(parsed.listening, false)
  })
})

describe('S6 compatibility', () => {
  it('binds a host service that predates Tool Insights', () => {
    const service = baseService()
    assert.doesNotThrow(() => bindModelToolsRemote(service))
    assert.equal(Object.hasOwn(service, 'typertRemote'), true)
  })

  it('binds a host service that implements the additive methods', () => {
    const state = initToolUsageState()
    const report = buildUsageReport([{ sessionId: 's', workspace: null, state }], rangeWindow('7d', 1))
    const service: ModelToolsRemote = {
      ...baseService(),
      toolSources: async () => ({ tools: [] }),
      toolInventory: async () => ({ tools: [] }),
      mcpStatus: async () => ({
        enabled: false, listening: false, endpoint: null, configured: null, transport: 'http',
        auth: { scheme: 'none', mode: 'none', tokenFile: null }, uptimeMs: 0, clients: [],
        exposed: [], withheld: [], exposedCount: 0, withheldCount: 0,
      }),
      mcpCalls: async () => ({ calls: [], total: 0, page: 1, pageSize: 50, clients: [] }),
      toolUsageReport: async () => report,
    }
    assert.doesNotThrow(() => bindModelToolsRemote(service))
    assert.equal(typeof service.toolUsageReport, 'function')
  })
})
