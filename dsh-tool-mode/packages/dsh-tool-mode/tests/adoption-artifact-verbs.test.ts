/**
 * Phase 1 (U40, U37): truthful artifact verbs and per-scope delete results.
 *
 * The goal is that an agent cannot believe a cleanup or a cross-kind call succeeded when
 * it did not:
 * - the WRONG authoring verb points at the right one instead of silently no-op'ing;
 * - a name held by BOTH kinds is resolved by the verb the caller chose, never guessed;
 * - delete reports which scopes it removed and which rows still answer the name.
 *
 * @module tests/adoption-artifact-verbs
 */

/*
 * This suite is the JSON boundary for tool results: the registry returns `unknown` and
 * the rows under test are cast. The assertions compare exact scopes and counts.
 */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../src/index.ts'
import { cleanup, tempDir } from './helpers.ts'

const contexts: Context[] = []
let counter = 0

after(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await cleanup()
})

async function mountHost(): Promise<Context> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: join(dir, 'agent-authoring.json'),
    artifactScopes: {
      enabled: true,
      defaultScope: 'session',
      workspaceRoot: dir,
      globalPromotion: 'human',
      promoteMinUses: 2,
      expireSessionArtifacts: true,
    },
  })
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`adoption-verbs-${++counter}`),
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

async function refused(ctx: Context, name: string, args: unknown, sessionId: string): Promise<string> {
  const result = await callAs(ctx, name, args, sessionId)
  assert.equal(result.isError, true, 'the wrong-kind delete must be REFUSED, not a silent no-op')
  return (result as { error?: { message?: string } }).error?.message ?? ''
}

/** One delete result as the authoring tools publish it. */
interface DeleteResult {
  readonly deleted: boolean
  readonly complete: boolean
  readonly deletedScopes: { scope: string; scopeKey: string }[]
  readonly remainingScopes: { scope: string; scopeKey: string }[]
  readonly reason?: string
}

const SCHEMA = { type: 'object', properties: { value: { type: 'string' } } }

async function saveWorkflow(ctx: Context, name: string): Promise<void> {
  await ok(ctx, 'tool_mode_workflows', { action: 'save', name, program: 'return 1', tools: [] }, 'session-a')
}

async function defineTool(ctx: Context, name: string): Promise<void> {
  await ok(ctx, 'tool_mode_tools', {
    action: 'define', name, description: 'A probe tool.', inputSchema: SCHEMA,
    program: 'return 1', tools: [],
  }, 'session-a')
}

describe('Phase 1 — the wrong verb POINTS at the right one (U40)', () => {
  it('tool_mode_tools delete of a workflow name names tool_mode_workflows and mutates nothing', async () => {
    const ctx = await mountHost()
    await saveWorkflow(ctx, 'workflow_x')
    const message = await refused(ctx, 'tool_mode_tools', { action: 'delete', name: 'workflow_x' }, 'session-a')
    assert.match(message, /tool_mode_workflows/)
    assert.match(message, /workflow/i)
    // Nothing changed: the workflow is still there and no authored tool was invented.
    const got = await ok(ctx, 'tool_mode_workflows', { action: 'get', name: 'workflow_x' }, 'session-a') as { workflow: { name: string } }
    assert.equal(got.workflow.name, 'workflow_x')
    const tools = await ok(ctx, 'tool_mode_tools', { action: 'list' }, 'session-a') as { tools: { name: string }[] }
    assert.equal(tools.tools.some(row => row.name === 'workflow_x'), false)

    // The CALLABLE spelling points at the same verb (it is how a model names a workflow).
    await saveWorkflow(ctx, 'x-flow')
    const callableMessage = await refused(ctx, 'tool_mode_tools', { action: 'delete', name: 'workflow_x_flow' }, 'session-a')
    assert.match(callableMessage, /tool_mode_workflows/)
    const still = await ok(ctx, 'tool_mode_workflows', { action: 'get', name: 'x-flow' }, 'session-a') as { workflow: { name: string } }
    assert.equal(still.workflow.name, 'x-flow')
  })

  it('tool_mode_workflows delete of an authored tool name names tool_mode_tools and mutates nothing', async () => {
    const ctx = await mountHost()
    await defineTool(ctx, 'agent_xy')
    const message = await refused(ctx, 'tool_mode_workflows', { action: 'delete', name: 'agent_xy' }, 'session-a')
    assert.match(message, /tool_mode_tools/)
    assert.match(message, /authored tool/i)
    const got = await ok(ctx, 'tool_mode_tools', { action: 'get', name: 'agent_xy' }, 'session-a') as { tool: { name: string } }
    assert.equal(got.tool.name, 'agent_xy')
    const workflows = await ok(ctx, 'tool_mode_workflows', { action: 'list' }, 'session-a') as { workflows: { name: string }[] }
    assert.equal(workflows.workflows.some(row => row.name === 'agent_xy'), false)
  })

  it('a name held by BOTH kinds is resolved by the verb the caller chose, never guessed', async () => {
    const ctx = await mountHost()
    // A workflow name may legally be agent_*; the two stores are separate namespaces.
    await saveWorkflow(ctx, 'agent_both')
    await defineTool(ctx, 'agent_both')

    const deletedWorkflow = await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'agent_both' }, 'session-a') as DeleteResult
    assert.equal(deletedWorkflow.deleted, true, 'the workflow verb deletes the WORKFLOW')
    assert.equal(deletedWorkflow.complete, true)
    const toolStill = await ok(ctx, 'tool_mode_tools', { action: 'get', name: 'agent_both' }, 'session-a') as { tool: { name: string } }
    assert.equal(toolStill.tool.name, 'agent_both', 'the authored tool must survive the workflow delete')
    const workflowGone = await ok(ctx, 'tool_mode_workflows', { action: 'list' }, 'session-a') as { workflows: { name: string }[] }
    assert.equal(workflowGone.workflows.some(row => row.name === 'agent_both'), false)

    await saveWorkflow(ctx, 'agent_both')
    const deletedTool = await ok(ctx, 'tool_mode_tools', { action: 'delete', name: 'agent_both' }, 'session-a') as DeleteResult
    assert.equal(deletedTool.deleted, true, 'the tools verb deletes the TOOL')
    const workflowStill = await ok(ctx, 'tool_mode_workflows', { action: 'get', name: 'agent_both' }, 'session-a') as { workflow: { name: string } }
    assert.equal(workflowStill.workflow.name, 'agent_both', 'the re-saved workflow must survive the tool delete')
  })

  it('an unknown name is still deleted:false WITH a reason, not a pointing error', async () => {
    const ctx = await mountHost()
    const result = await ok(ctx, 'tool_mode_tools', { action: 'delete', name: 'nope' }, 'session-a') as DeleteResult
    assert.equal(result.deleted, false)
    assert.equal(result.complete, false)
    assert.deepEqual(result.deletedScopes, [])
    assert.deepEqual(result.remainingScopes, [])
    assert.match(result.reason ?? '', /no authored tool/)
  })
})

describe('Phase 1 — delete reports per-scope truth (U37)', () => {
  it('a default delete that leaves a promoted copy reports both scopes and no completion', async () => {
    const ctx = await mountHost()
    await saveWorkflow(ctx, 'promoted-flow')
    await ok(ctx, 'tool_mode_workflows', { action: 'promote', name: 'promoted-flow', to: 'workspace', force: true }, 'session-a')
    const promoted = await ok(ctx, 'tool_mode_workflows', { action: 'list', scope: 'all' }, 'session-a') as {
      workflows: { scope: string; scopeKey: string; name: string }[]
    }
    const workspaceKey = promoted.workflows.find(row => row.scope === 'workspace')?.scopeKey
    assert.ok(workspaceKey, 'the promotion must have produced a workspace copy')

    const result = await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'promoted-flow' }, 'session-a') as DeleteResult
    assert.equal(result.deleted, false, 'a surviving copy means the delete is NOT complete')
    assert.equal(result.complete, false)
    assert.deepEqual(result.deletedScopes.map(row => row.scope), ['session'])
    assert.deepEqual(result.deletedScopes.map(row => row.scopeKey), ['session-a'])
    assert.deepEqual(result.remainingScopes.map(row => row.scope), ['workspace'])
    assert.deepEqual(result.remainingScopes.map(row => row.scopeKey), [workspaceKey])

    // The workspace copy still answers the name.
    const resolved = await ok(ctx, 'tool_mode_workflows', { action: 'get', name: 'promoted-flow' }, 'session-a') as { workflow: { scope: string } }
    assert.equal(resolved.workflow.scope, 'workspace')
  })

  it('the same per-scope truth holds for an authored tool', async () => {
    const ctx = await mountHost()
    await defineTool(ctx, 'agent_promoted')
    await ok(ctx, 'tool_mode_tools', { action: 'promote', name: 'agent_promoted', to: 'workspace', force: true }, 'session-a')
    const result = await ok(ctx, 'tool_mode_tools', { action: 'delete', name: 'agent_promoted' }, 'session-a') as DeleteResult
    assert.equal(result.deleted, false)
    assert.equal(result.complete, false)
    assert.deepEqual(result.deletedScopes.map(row => row.scope), ['session'])
    assert.deepEqual(result.remainingScopes.map(row => row.scope), ['workspace'])
  })

  it('delete with scope:workspace removes only that row and says what remains', async () => {
    const ctx = await mountHost()
    await saveWorkflow(ctx, 'layered-flow')
    await ok(ctx, 'tool_mode_workflows', { action: 'promote', name: 'layered-flow', to: 'workspace', force: true }, 'session-a')

    const result = await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'layered-flow', scope: 'workspace' }, 'session-a') as DeleteResult
    assert.equal(result.deleted, false)
    assert.equal(result.complete, false)
    assert.deepEqual(result.deletedScopes.map(row => row.scope), ['workspace'])
    assert.deepEqual(result.remainingScopes.map(row => row.scope), ['session'])
    // The session copy is the live one now, and the workspace row is gone.
    const listed = await ok(ctx, 'tool_mode_workflows', { action: 'list', scope: 'all' }, 'session-a') as {
      workflows: { scope: string; name: string }[]
    }
    assert.deepEqual(listed.workflows.filter(row => row.name === 'layered-flow').map(row => row.scope), ['session'])

    const final = await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'layered-flow' }, 'session-a') as DeleteResult
    assert.equal(final.deleted, true, 'the last visible row is a complete delete')
    assert.equal(final.complete, true)
    assert.deepEqual(final.remainingScopes, [])
  })
})
