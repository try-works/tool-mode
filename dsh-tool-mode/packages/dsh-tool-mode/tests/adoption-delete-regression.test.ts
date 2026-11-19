/**
 * Phase 1 delete regressions: scope cleanup, isolation and receipts.
 *
 * These pin the behaviour the per-scope delete result must PRESERVE: one scope's delete
 * never reaches another scope, a full per-scope cleanup empties the list, and the durable
 * authoring receipt names the scope that was actually removed.
 *
 * @module tests/adoption-delete-regression
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
    callId: ToolCallId(`adoption-delete-${++counter}`),
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

interface DeleteResult {
  readonly deleted: boolean
  readonly complete: boolean
  readonly deletedScopes: { scope: string; scopeKey: string }[]
  readonly remainingScopes: { scope: string; scopeKey: string }[]
}

async function seedPromotedFlow(ctx: Context, name: string): Promise<void> {
  await ok(ctx, 'tool_mode_workflows', { action: 'save', name, program: 'return 1', tools: [] }, 'session-a')
  await ok(ctx, 'tool_mode_workflows', { action: 'promote', name, to: 'workspace', force: true }, 'session-a')
}

describe('Phase 1 — delete regressions', () => {
  it('cleanup per scope, then list scope:all is empty', async () => {
    const ctx = await mountHost()
    await seedPromotedFlow(ctx, 'cleanup-flow')

    const sessionDelete = await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'cleanup-flow' }, 'session-a') as DeleteResult
    assert.equal(sessionDelete.deleted, false, 'the workspace copy still answers the name')
    assert.deepEqual(sessionDelete.deletedScopes.map(row => row.scope), ['session'])

    const workspaceDelete = await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'cleanup-flow', scope: 'workspace' }, 'session-a') as DeleteResult
    assert.equal(workspaceDelete.deleted, true, 'no visible row survives')
    assert.equal(workspaceDelete.complete, true)
    assert.deepEqual(workspaceDelete.remainingScopes, [])

    const listed = await ok(ctx, 'tool_mode_workflows', { action: 'list', scope: 'all' }, 'session-a') as { workflows: { name: string }[] }
    assert.equal(listed.workflows.some(row => row.name === 'cleanup-flow'), false, 'the per-scope cleanup must empty the list')
  })

  it('a session delete does NOT delete the workspace row', async () => {
    const ctx = await mountHost()
    await seedPromotedFlow(ctx, 'isolated-flow')

    await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'isolated-flow' }, 'session-a')
    const workspaceRows = await ok(ctx, 'tool_mode_workflows', { action: 'list', scope: 'workspace' }, 'session-a') as {
      workflows: { name: string; scope: string }[]
    }
    assert.deepEqual(workspaceRows.workflows.map(row => row.name), ['isolated-flow'])
    assert.equal(workspaceRows.workflows[0]?.scope, 'workspace')
    // A caller at the workspace scope still resolves and runs it (schema only; no gate needed).
    const got = await ok(ctx, 'tool_mode_workflows', { action: 'get', name: 'isolated-flow', scope: 'workspace' }, 'session-a') as { workflow: { scope: string } }
    assert.equal(got.workflow.scope, 'workspace')
  })

  it('the deletion receipt names the scope actually removed', async () => {
    const ctx = await mountHost()
    await seedPromotedFlow(ctx, 'receipt-flow')
    await ok(ctx, 'tool_mode_workflows', { action: 'delete', name: 'receipt-flow', scope: 'workspace' }, 'session-a')

    const receipts = await ok(ctx, 'model_tools', { action: 'receipts' }, 'session-a') as {
      authoring?: { operation: string; artifactKind: string; name: string; scope: string; targetScope?: string }[]
    }
    const deletion = [...(receipts.authoring ?? [])].reverse().find(row => row.operation === 'delete' && row.name === 'receipt-flow')
    assert.ok(deletion, 'the delete must leave a durable authoring receipt')
    assert.equal(deletion.artifactKind, 'workflow')
    assert.equal(deletion.scope, 'workspace', 'the receipt names the removed row scope, not the caller default')
  })
})
