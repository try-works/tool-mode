/**
 * T1-T12 acceptance for artifact scoping (research plan 2026-11-17).
 *
 * The tests drive the REAL plugin with a fake PTC runtime and explicit session ids.
 * A session id is passed through the tool execution context, exactly where the host
 * reads it; no scoping fact is injected into the store directly.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../src/index.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

function fakeRuntime(): ProgramRuntime {
  return {
    resolve: request => request,
    async run(spec) {
      const request = spec as {
        program?: unknown
        bindings?: readonly { global: string; functions: Record<string, (args: unknown) => Promise<unknown>> }[]
      }
      const namespaces = Array.isArray(request.bindings) ? request.bindings : []
      const names = namespaces.map(namespace => namespace.global)
      const values = namespaces.map(namespace => {
        const api: Record<string, unknown> = {}
        for (const [name, fn] of Object.entries(namespace.functions)) api[name] = (args: unknown) => fn(args)
        return api
      })
      const body = typeof request.program === 'string' ? request.program : ''
      const fn = new Function(...names, 'input', `return (async () => { ${body} })()`)
      const input = { value: 21, text: 'hello' }
      return { value: await fn(...values, input) }
    },
  } as never
}

const contexts: Context[] = []
let counter = 0

async function mountHost(options: {
  readonly file?: string
  readonly workspaceRoot?: string
  readonly enabled?: boolean
  readonly gateOpen?: boolean
  readonly parents?: Readonly<Record<string, string>>
  readonly runtime?: ProgramRuntime
} = {}): Promise<Context> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, options.runtime ?? fakeRuntime())
  if (options.parents !== undefined) {
    ctx.provide('sessions' as never, {
      get(id: string) {
        const parent = options.parents?.[id]
        return { header: { id, ...parent === undefined ? {} : { parentSession: parent } } }
      },
    } as never)
  }
  if (options.gateOpen === true) setConfinementDemonstratedForTest(true)
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: options.file ?? join(dir, 'agent-authoring.json'),
    artifactScopes: {
      enabled: options.enabled ?? true,
      defaultScope: 'session',
      workspaceRoot: options.workspaceRoot ?? dir,
      globalPromotion: 'human',
      promoteMinUses: 2,
      expireSessionArtifacts: true,
    },
    hostedCode: options.gateOpen === true,
  })
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`scope-${++counter}`),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

async function ok(ctx: Context, name: string, args: unknown, sessionId: string) {
  const result = await callAs(ctx, name, args, sessionId)
  if (result.isError) throw new Error(`${name} failed: ${result.error?.message ?? 'unknown'}`)
  return (result as { value: unknown }).value
}

async function failed(ctx: Context, name: string, args: unknown, sessionId: string) {
  const result = await callAs(ctx, name, args, sessionId)
  assert.equal(result.isError, true, 'the call must be refused')
  return (result as { error?: { message?: string } }).error?.message ?? ''
}

describe('artifact scoping T1-T12', () => {
  it('T1: a session artifact is invisible to another root session', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'private-flow', program: 'return 1' }, 'session-a')
    const a = await ok(ctx, 'tool_mode_workflows', { action: 'list' }, 'session-a') as { workflows: { name: string }[] }
    const b = await ok(ctx, 'tool_mode_workflows', { action: 'list' }, 'session-b') as { workflows: { name: string }[] }
    assert.equal(a.workflows.some(row => row.name === 'private-flow'), true)
    assert.equal(b.workflows.some(row => row.name === 'private-flow'), false)
  })

  it('T1b: concurrent sessions may author the SAME name and each sees only its own', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'same-name', program: 'return 1' }, 'session-a')
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'same-name', program: 'return 2' }, 'session-b')
    const a = await ok(ctx, 'tool_mode_workflows', { action: 'get', name: 'same-name' }, 'session-a') as { workflow: { program: string } }
    const b = await ok(ctx, 'tool_mode_workflows', { action: 'get', name: 'same-name' }, 'session-b') as { workflow: { program: string } }
    assert.equal(a.workflow.program, 'return 1')
    assert.equal(b.workflow.program, 'return 2')
  })

  it('T1d: an implicit session default without a session downgrades visibly', async () => {
    const ctx = await mountHost()
    const saved = await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'no-session-flow', program: 'return 1',
    }, undefined as never) as {
      workflow: { scope: string }
      requestedScope?: string
      scopeReason?: string
    }
    assert.equal(saved.workflow.scope, 'global')
    assert.equal(saved.requestedScope, 'session', 'the response must say which scope was asked for')
    assert.equal(saved.scopeReason, 'no-session-id')

    const explicit = await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'explicit-global-flow', program: 'return 1', scope: 'global',
    }, undefined as never) as { requestedScope?: string; scopeReason?: string }
    assert.equal('requestedScope' in explicit, false, 'an honored request needs no disclosure')
    assert.equal('scopeReason' in explicit, false)
    const listed = await ok(ctx, 'tool_mode_list', {}, undefined as never) as {
      authoring?: { scope?: { reason?: string } }
    }
    assert.equal(listed.authoring?.scope?.reason, 'no-session-id')
  })

  it('T1e: a tool define without a session discloses the downgrade', async () => {
    const ctx = await mountHost()
    const defined = await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_no_session', description: 'No session.', program: 'return 1', tools: [],
      inputSchema: { type: 'object', properties: {} },
    }, undefined as never) as {
      tool: { scope: string }
      requestedScope?: string
      scopeReason?: string
    }
    assert.equal(defined.tool.scope, 'global')
    assert.equal(defined.requestedScope, 'session')
    assert.equal(defined.scopeReason, 'no-session-id')
  })

  it('T1c: a Code Mode nested call carries the caller session', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_scope_probe', description: 'Global.', scope: 'global',
      inputSchema: { type: 'object', properties: {} },
      program: 'return { scope: "global" }', tools: [],
    }, 'session-a')
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_scope_probe', description: 'Session.', scope: 'session',
      inputSchema: { type: 'object', properties: {} },
      program: 'return { scope: "session" }', tools: [],
    }, 'session-a')
    const result = await ok(ctx, 'tool_mode_run', {
      code: 'return await agent_scope_probe({})', tools: ['agent_scope_probe'], input: {},
    }, 'session-a') as { result: { scope: string } }
    assert.equal(result.result.scope, 'session', 'the nested call must resolve the caller session, not global')
  })

  it('T1f: bind preflight resolves names without executing and agrees with list bindable', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_probe_bind', description: 'Probe.', scope: 'session',
      inputSchema: { type: 'object', properties: {} },
      program: 'throw new Error("must not execute")', tools: [],
    }, 'session-a')
    const probed = await ok(ctx, 'tool_mode_run', {
      probe: true, tools: ['agent_probe_bind', 'missing_bind'],
    }, 'session-a') as {
      preflight: { name: string; resolved: boolean; reason?: string; scope: string }[]
      gateOpen: boolean
    }
    assert.equal(probed.gateOpen, true)
    assert.equal(probed.preflight[0]?.resolved, true)
    assert.equal(probed.preflight[0]?.scope, 'session')
    assert.equal(probed.preflight[1]?.resolved, false)
    assert.equal(probed.preflight[1]?.reason, 'not-registered')

    const listed = await ok(ctx, 'tool_mode_list', {}, 'session-a') as {
      tools: { name: string; bindable: boolean }[]
    }
    const row = listed.tools.find(tool => tool.name === 'agent_probe_bind')
    assert.equal(row?.bindable, true, 'a bindable row must be resolvable by the same gate')
    const rowProbe = await ok(ctx, 'tool_mode_run', {
      probe: true, tools: ['agent_probe_bind'],
    }, 'session-a') as { preflight: { resolved: boolean }[] }
    assert.equal(rowProbe.preflight[0]?.resolved, row?.bindable)
  })

  it('T1i: a refused bind names the cause, the scope and the action', async () => {
    const ctx = await mountHost({ gateOpen: true })
    const missing = await failed(ctx, 'tool_mode_run', {
      code: 'return 1', tools: ['missing_bind'],
    }, 'session-a')
    assert.match(missing, /not-registered/)
    assert.match(missing, /session/)
    assert.match(missing, /Install or activate/)

    const undeclared = await failed(ctx, 'tool_mode_run', {
      code: 'return await nope({})', tools: [],
    }, 'session-a')
    assert.match(undeclared, /was not declared/)
    assert.match(undeclared, /Declared here: \(none\)/)

    const closed = await mountHost()
    const gate = await failed(closed, 'tool_mode_run', {
      code: 'return 1', tools: [],
    }, 'session-a')
    assert.match(gate, /generated-code execution is disabled/)
    assert.match(gate, /Caller scope: session/)
    assert.match(gate, /hostedCode: true/)
  })

  it('T1g: a session artifact is not visible from another session', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_private', description: 'Private.', scope: 'session',
      inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [],
    }, 'session-a')
    const message = await failed(ctx, 'tool_mode_run', {
      code: 'return await agent_private({})', tools: ['agent_private'],
    }, 'session-b')
    assert.match(message, /not-visible-at-scope/)
    assert.match(message, /session/)
    assert.match(message, /Save the artifact/)
  })

  it('T1h: listing one scope reports the row hidden by a higher scope', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'shadow-flow', program: 'return "workspace"', scope: 'workspace',
    }, 'session-a')
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'shadow-flow', program: 'return "session"', scope: 'session',
    }, 'session-a')
    const hidden = await ok(ctx, 'tool_mode_workflows', {
      action: 'list', scope: 'workspace',
    }, 'session-a') as { workflows: { name: string; shadowedBy?: { scope: string } }[] }
    assert.equal(hidden.workflows.find(row => row.name === 'shadow-flow')?.shadowedBy?.scope, 'session')
    await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'shadow-flow' }, 'session-a')
    const visible = await ok(ctx, 'tool_mode_workflows', {
      action: 'list', scope: 'workspace',
    }, 'session-a') as { workflows: { name: string; shadowedBy?: unknown }[] }
    assert.equal(visible.workflows.find(row => row.name === 'shadow-flow')?.shadowedBy, undefined)
  })

  it('T1h2: all-row listing annotates the hidden row on both kinds (U26)', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'union-flow', program: 'return "workspace"', scope: 'workspace',
    }, 'session-a')
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'union-flow', program: 'return "session"', scope: 'session',
    }, 'session-a')
    const all = await ok(ctx, 'tool_mode_workflows', { action: 'list', all: true }, 'session-a') as {
      workflows: { name: string; scope: string; scopeKey: string; shadowedBy?: { scope: string; scopeKey: string } }[]
    }
    const hiddenFlow = all.workflows.find(row => row.name === 'union-flow' && row.scope === 'workspace')
    const winnerFlow = all.workflows.find(row => row.name === 'union-flow' && row.scope === 'session')
    assert.deepEqual(hiddenFlow?.shadowedBy, { scope: 'session', scopeKey: 'session-a', version: 1 })
    assert.equal(winnerFlow?.shadowedBy, undefined)

    const scopedAll = await ok(ctx, 'tool_mode_workflows', { action: 'list', scope: 'all' }, 'session-a') as {
      workflows: { name: string; scope: string; shadowedBy?: unknown }[]
    }
    assert.ok(scopedAll.workflows.find(row => row.scope === 'workspace')?.shadowedBy)

    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_union_tool', description: 'Workspace.', scope: 'workspace',
      inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [],
    }, 'session-a')
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_union_tool', description: 'Session.', scope: 'session',
      inputSchema: { type: 'object', properties: {} }, program: 'return 2', tools: [],
    }, 'session-a')
    const tools = await ok(ctx, 'tool_mode_tools', { action: 'list', all: true }, 'session-a') as {
      tools: { name: string; scope: string; shadowedBy?: { scope: string } }[]
    }
    assert.equal(tools.tools.find(row => row.scope === 'workspace')?.shadowedBy?.scope, 'session')
    assert.equal(tools.tools.find(row => row.scope === 'session')?.shadowedBy, undefined)
  })

  it('T1i: probe scopeKey names the session key, not the workspace path (U25)', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_key_probe', description: 'Probe.', scope: 'session',
      inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [],
    }, 'session-a')
    const probed = await ok(ctx, 'tool_mode_run', {
      probe: true, tools: ['agent_key_probe'],
    }, 'session-a') as { preflight: { scope: string; scopeKey: string }[] }
    assert.equal(probed.preflight[0]?.scope, 'session')
    assert.equal(probed.preflight[0]?.scopeKey, 'session-a')
  })

  it('T1j: delete at a scope that holds no row explains the scopes checked', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'only-global', program: 'return 1',
    }, 'session-a')
    const missed = await ok(ctx, 'tool_mode_workflows', {
      action: 'delete', name: 'only-global', scope: 'workspace',
    }, 'session-a') as { deleted: boolean; reason?: string; checkedScopes?: { scope: string }[] }
    assert.equal(missed.deleted, false)
    assert.match(missed.reason ?? '', /workspace/)
    assert.match(missed.reason ?? '', /from.*demote-only/)
    assert.equal(missed.checkedScopes?.length, 1)
    assert.equal(missed.checkedScopes?.[0]?.scope, 'workspace')
    assert.ok((missed.checkedScopes?.[0]?.scopeKey ?? '').length > 0)
  })

  it('T1k2: a prefixed ReferenceError still reaches the declared-tools hint', async () => {
    const ctx = await mountHost({
      gateOpen: true,
      runtime: {
        resolve: request => request,
        async run() {
          throw new Error('ReferenceError: orbit_missing is not defined')
        },
      } as ProgramRuntime,
    })
    const message = await failed(ctx, 'tool_mode_run', {
      code: 'return await orbit_missing({})', tools: [],
    }, 'session-a')
    assert.match(message, /orbit_missing/)
    assert.match(message, /not declared in this program's tools/)
  })

  it('T1k: an unlisted bare tool name gets the declared-tools hint, not a raw ReferenceError', async () => {
    const ctx = await mountHost({ gateOpen: true })
    const message = await failed(ctx, 'tool_mode_run', {
      code: 'return await lang_detect({ text: "hi" })', tools: [],
    }, 'session-a')
    assert.match(message, /lang_detect/)
    assert.match(message, /not declared in this program's tools/)
  })

  it('T2: a subagent writes into its root session scope', async () => {
    const ctx = await mountHost({ parents: { child: 'root' } })
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'subagent-flow', program: 'return 1' }, 'child')
    const root = await ok(ctx, 'tool_mode_workflows', { action: 'list' }, 'root') as { workflows: { name: string; scope: string }[] }
    assert.equal(root.workflows.some(row => row.name === 'subagent-flow' && row.scope === 'session'), true)
  })

  it('T4: workspace artifacts carry across sessions in the same workspace only', async () => {
    const file = join(tempDir(), 'agent-authoring.json')
    const root = tempDir()
    const first = await mountHost({ file, workspaceRoot: root })
    await ok(first, 'tool_mode_workflows', {
      action: 'save', name: 'workspace-flow', program: 'return 1', scope: 'workspace',
    }, 'session-a')
    const second = await mountHost({ file, workspaceRoot: root })
    const seen = await ok(second, 'tool_mode_workflows', { action: 'list' }, 'session-b') as { workflows: { name: string }[] }
    assert.equal(seen.workflows.some(row => row.name === 'workspace-flow'), true)
    const elsewhere = await mountHost({ file, workspaceRoot: tempDir() })
    const absent = await ok(elsewhere, 'tool_mode_workflows', { action: 'list' }, 'session-c') as { workflows: { name: string }[] }
    assert.equal(absent.workflows.some(row => row.name === 'workspace-flow'), false)
  })

  it('T5: session shadows global and reports the shadowed row', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'shared-flow', program: 'return 1', scope: 'global',
    }, 'session-a')
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'shared-flow', program: 'return 2', scope: 'session',
    }, 'session-a')
    const a = await ok(ctx, 'tool_mode_workflows', { action: 'list' }, 'session-a') as {
      workflows: { name: string; scope: string; shadowing: { scope: string; version: number } | null }[]
    }
    const row = a.workflows.find(candidate => candidate.name === 'shared-flow')
    assert.equal(row?.scope, 'session')
    assert.deepEqual(row?.shadowing, { scope: 'global', version: 1 })
    const b = await ok(ctx, 'tool_mode_workflows', { action: 'list' }, 'session-b') as { workflows: { scope: string }[] }
    assert.equal(b.workflows.find(candidate => candidate.name === 'shared-flow')?.scope, 'global')
    const described = await ok(ctx, 'tool_mode_describe', { tools: ['shared-flow'] }, 'session-a') as {
      tools: { scope?: string; shadowing?: { scope: string } }[]
    }
    assert.equal(described.tools[0]?.scope, 'session')
    assert.deepEqual(described.tools[0]?.shadowing, { scope: 'global', version: 1 })
  })

  it('T6: promotion with one use is refused with observed counts', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'unused-flow', program: 'return 1' }, 'session-a')
    const message = await failed(ctx, 'tool_mode_workflows', {
      action: 'promote', name: 'unused-flow', to: 'workspace',
    }, 'session-a')
    assert.match(message, /EVIDENCE_INSUFFICIENT/)
    assert.match(message, /0 uses/)
  })

  it('T7: global promotion without human approval is refused by name', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'global-flow', program: 'return 1' }, 'session-a')
    const message = await failed(ctx, 'tool_mode_workflows', {
      action: 'promote', name: 'global-flow', to: 'global',
    }, 'session-a')
    assert.match(message, /E_APPROVAL_REQUIRED/)
    assert.match(message, /artifactScopes\.globalPromotion/)
  })

  it('T7b: global promotion succeeds only with the operator approval in the host environment', async () => {
    process.env['DSH_ARTIFACT_GLOBAL_APPROVAL'] = '1'
    try {
      const ctx = await mountHost({ gateOpen: true })
      await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'approved-flow', program: 'return { ok: true }' }, 'session-a')
      await ok(ctx, 'workflow_approved_flow', {}, 'session-a')
      await ok(ctx, 'workflow_approved_flow', {}, 'session-a')
      const promoted = await ok(ctx, 'tool_mode_workflows', {
        action: 'promote', name: 'approved-flow', to: 'global',
      }, 'session-a') as { workflow: { scope: string; version: number; promotedFrom?: { scope: string } } }
      assert.equal(promoted.workflow.scope, 'global')
      assert.equal(promoted.workflow.version, 1)
      assert.equal(promoted.workflow.promotedFrom?.scope, 'session')
    } finally {
      delete process.env['DSH_ARTIFACT_GLOBAL_APPROVAL']
    }
  })

  it('T8: promote to workspace, keep the name callable and receipt scope/promotedFrom/evidence', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'promote-flow', program: 'return { ok: true }' }, 'session-a')
    await ok(ctx, 'workflow_promote_flow', {}, 'session-a')
    await ok(ctx, 'workflow_promote_flow', {}, 'session-a')
    const promoted = await ok(ctx, 'tool_mode_workflows', {
      action: 'promote', name: 'promote-flow', to: 'workspace',
    }, 'session-a') as { workflow: { name: string; scope: string; promotedFrom?: unknown } }
    assert.equal(promoted.workflow.name, 'promote-flow')
    assert.equal(promoted.workflow.scope, 'workspace')
    assert.ok(promoted.workflow.promotedFrom)
    const receipts = await ok(ctx, 'model_tools', { action: 'receipts' }, 'session-a') as {
      authoring: { operation: string; scope?: string; promotedFrom?: unknown; evidence?: unknown }[]
    }
    const row = receipts.authoring.find(item => item.operation === 'promote')
    assert.equal(row?.scope, 'workspace')
    assert.ok(row?.promotedFrom)
    assert.deepEqual(row?.evidence, { uses: 2, sessions: 1, failures: 0 })
  })

  it('T8b: durable evidence counts five sessions of agent runs', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'durable-flow', program: 'return { ok: true }', scope: 'workspace',
    }, 'session-a')
    for (const session of ['session-a', 'session-b', 'session-c', 'session-d', 'session-e']) {
      await ok(ctx, 'tool_mode_workflows', {
        action: 'run', name: 'durable-flow', input: {},
      }, session)
    }
    const listed = await ok(ctx, 'tool_mode_list', { scope: 'workspace' }, 'session-a') as {
      authoring?: { workflows: { name: string; uses: number; sessions: number; failures: number }[] }
    }
    const row = listed.authoring?.workflows.find(candidate => candidate.name === 'durable-flow')
    assert.deepEqual(
      { uses: row?.uses, sessions: row?.sessions, failures: row?.failures },
      { uses: 5, sessions: 5, failures: 0 },
    )
  })

  it('T8c: discovery calls emit discovery receipts with the caller session', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_list', { scope: 'all' }, 'session-a')
    await ok(ctx, 'tool_mode_describe', { tools: ['tool_mode_list'] }, 'session-a')
    const receipts = await ok(ctx, 'model_tools', { action: 'receipts' }, 'session-a') as {
      receipts: { kind: string; contract: string; rootSessionId?: string; sessionId?: string }[]
    }
    const discovery = receipts.receipts.filter(row => row.kind === 'discovery')
    assert.equal(discovery.length, 2)
    assert.equal(discovery.every(row => row.rootSessionId === 'session-a' && row.sessionId === 'session-a'), true)
    assert.deepEqual(discovery.map(row => row.contract).sort(), ['tool_mode_describe', 'tool_mode_list'])
  })

  it('T8d: a failed agent run counts as a use and a failure', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'failing-flow', program: 'throw new Error("boom")', scope: 'workspace',
    }, 'session-a')
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'failing-run' as never,
      name: 'tool_mode_workflows',
      arguments: { action: 'run', name: 'failing-flow', input: {} },
      agent: { id: 'session-a' } as never,
    } as never)
    const listed = await ok(ctx, 'tool_mode_list', { scope: 'workspace' }, 'session-a') as {
      authoring?: { workflows: { name: string; uses: number; sessions: number; failures: number }[] }
    }
    const row = listed.authoring?.workflows.find(candidate => candidate.name === 'failing-flow')
    assert.deepEqual(
      { uses: row?.uses, sessions: row?.sessions, failures: row?.failures },
      { uses: 1, sessions: 1, failures: 1 },
    )
  })

  it('T9: deleting a workspace copy falls back to the global row', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'fallback-flow', program: 'return 1', scope: 'global',
    }, 'session-a')
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'fallback-flow', program: 'return 2', scope: 'workspace',
    }, 'session-a')
    await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'fallback-flow', scope: 'workspace' }, 'session-a')
    const row = await ok(ctx, 'tool_mode_workflows', { action: 'get', name: 'fallback-flow' }, 'session-a') as { workflow: { scope: string; program: string } }
    assert.equal(row.workflow.scope, 'global')
    assert.equal(row.workflow.program, 'return 1')
  })

  it('T11: the list scope filter returns only that scope', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'only-session', program: 'return 1' }, 'session-a')
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'only-global', program: 'return 1', scope: 'global' }, 'session-a')
    const rows = await ok(ctx, 'tool_mode_workflows', { action: 'list', scope: 'session' }, 'session-a') as { workflows: { name: string; scope: string }[] }
    assert.deepEqual(rows.workflows.map(row => row.name), ['only-session'])
    assert.equal(rows.workflows.every(row => row.scope === 'session'), true)
    const discovery = await ok(ctx, 'tool_mode_list', { scope: 'session' }, 'session-a') as {
      authoring?: { workflows: { name: string; scope: string }[] }
    }
    assert.deepEqual(discovery.authoring?.workflows.map(row => row.name), ['only-session'])
  })

  it('T12: disabled scoping is global-only and rejects a session request', async () => {
    const ctx = await mountHost({ enabled: false })
    const message = await failed(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'session-flow', program: 'return 1', scope: 'session',
    }, 'session-a')
    assert.match(message, /scope-disabled|only global scope/)
    const saved = await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'global-flow', program: 'return 1' }, 'session-a') as { workflow: { scope: string } }
    assert.equal(saved.workflow.scope, 'global')
  })

  it('T3: root-session disposal expires its artifacts and receipts an expire event', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'expire-flow', program: 'return 1' }, 'session-a')
    const before = await ok(ctx, 'tool_mode_list', {}, 'session-a') as {
      authoring?: { pending?: { name: string; uses: number }[] }
    }
    assert.equal(before.authoring?.pending?.some(row => row.name === 'expire-flow'), true)
    ctx.emit('session/disposed' as never, { header: { id: 'session-a' } })
    const rows = await ok(ctx, 'tool_mode_workflows', { action: 'list' }, 'session-a') as { workflows: { name: string }[] }
    assert.equal(rows.workflows.some(row => row.name === 'expire-flow'), false)
    const receipts = await ok(ctx, 'model_tools', { action: 'receipts' }, 'session-a') as {
      authoring: { operation: string; name: string; scope?: string }[]
    }
    assert.equal(receipts.authoring.some(row => row.operation === 'expire' && row.name === 'expire-flow' && row.scope === 'session'), true)
  })
})
