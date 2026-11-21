/**
 * R16 — the standing section surfaces registered on-device model tools by capability.
 * @module tests/on-device-surface
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: tool-result values at this suite's boundary are unknown; assertions read the documented shape. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../src/index.ts'
import {
  ON_DEVICE_MAX_CHARS,
  ON_DEVICE_MAX_NAMES_PER_CLASS,
  buildOnDeviceCapabilityIndex,
} from '../src/on-device-surface.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import { cleanup, tempDir } from './helpers.ts'

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)
const contexts: Context[] = []
after(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  setConfinementDemonstratedForTest(false)
  await cleanup()
})

const fakeRuntime: ProgramRuntime = {
  resolve: request => request,
  async run() {
    return { value: null, logs: [] }
  },
} as unknown as ProgramRuntime

async function mountHost(dir: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, fakeRuntime)
  setConfinementDemonstratedForTest(true)
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: join(dir, 'agent-authoring.json'),
    artifactScopes: { enabled: true, defaultScope: 'session', workspaceRoot: dir, globalPromotion: 'human', promoteMinUses: 2, expireSessionArtifacts: true },
    adoption: { digest: true },
    hostedCode: true,
  } as never)
  contexts.push(ctx)
  return ctx
}

async function sectionText(ctx: Context, name: string): Promise<string> {
  const service = ctx.get('systemPrompt') as {
    assemble(context?: { agent?: { id: string } }): Promise<{ sections: { name: string; text: string }[] }>
  } | undefined
  assert.ok(service)
  const assembly = await service.assemble({ agent: { id: 'r16-session' } } as never)
  return assembly.sections.find(section => section.name === name)?.text ?? ''
}

describe('R16 — capability index (pure)', () => {
  it('groups registered contract tools by capability', () => {
    const text = buildOnDeviceCapabilityIndex({
      registeredTools: ['decision_test', 'structured_extract', 'text_embed', 'describe_image', 'stt_transcribe', 'lang_detect'],
    })
    assert.match(text, /judgment — decision_test/)
    assert.match(text, /extraction — structured_extract/)
    assert.match(text, /embedding — text_embed/)
    assert.match(text, /vision — describe_image/)
    assert.match(text, /speech — stt_transcribe/)
    assert.match(text, /language — lang_detect/)
  })

  it('never names a tool that is not registered', () => {
    const text = buildOnDeviceCapabilityIndex({ registeredTools: ['decision_test'] })
    assert.match(text, /decision_test/)
    assert.doesNotMatch(text, /structured_extract/)
    assert.doesNotMatch(text, /text_embed/)
  })

  it('maps callable catalog models into their capability class', () => {
    const text = buildOnDeviceCapabilityIndex({
      registeredTools: ['identify_language', 'classify_nsfw'],
      catalogModels: [
        { tool: 'identify_language', capability: 'audio.spoken-language-identification' },
        { tool: 'classify_nsfw', capability: 'image.nsfw-detection' },
      ],
    })
    assert.match(text, /speech — identify_language/)
    assert.match(text, /vision — classify_nsfw/)
  })

  it('ignores a catalog row whose tool is not registered (no dead route)', () => {
    const text = buildOnDeviceCapabilityIndex({
      registeredTools: [],
      catalogModels: [{ tool: 'identify_language', capability: 'audio.spoken-language-identification' }],
    })
    assert.equal(text, '')
  })

  it('stays bounded and carries R17 guidance without an imperative', () => {
    const tools = Array.from({ length: 20 }, (_, index) => 'semantic_tool_' + String(index))
    const text = buildOnDeviceCapabilityIndex({ registeredTools: ['text_embed', 'text_rerank', 'semantic_rank', ...tools] })
    assert.ok(text.length <= ON_DEVICE_MAX_CHARS, 'length ' + String(text.length))
    assert.ok(!/^Use /m.test(text), 'the capability index is never imperative: ' + text)
    assert.match(text, /your own answer is usually better/)
    assert.match(text, /verification clause/)
    const embeddingNames = /embedding — ([^.;]+)/.exec(text)?.[1]?.split(', ') ?? []
    assert.ok(embeddingNames.length <= ON_DEVICE_MAX_NAMES_PER_CLASS, String(embeddingNames.length))
  })
})

describe('R16 — the standing section is wired to the live registry', () => {
  it('lists a freshly registered model tool and leaves the library directive clean', async () => {
    const dir = tempDir()
    const ctx = await mountHost(dir)
    const before = await sectionText(ctx, 'tool-mode:on-device')
    assert.doesNotMatch(before, /decision_test/, 'not registered yet: ' + before)

    ctx.tools.register(defineTool({
      name: 'decision_test',
      description: 'Answer a stated yes/no question on device.',
      parameters: { question: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
      async execute() { return { decision: 'yes' } },
    }))

    const onDevice = await sectionText(ctx, 'tool-mode:on-device')
    assert.match(onDevice, /judgment — decision_test/)
    const library = await sectionText(ctx, 'tool-mode:library')
    assert.ok(!library.includes('decision_test'), 'the artifact directive must stay clean: ' + library)
  })

  it('re-reads the registry, so a disposed tool disappears', async () => {
    const dir = tempDir()
    const ctx = await mountHost(dir)
    const dispose = ctx.tools.register(defineTool({
      name: 'structured_extract',
      description: 'Extract a record on device.',
      parameters: { text: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
      async execute() { return {} },
    }))
    assert.match(await sectionText(ctx, 'tool-mode:on-device'), /structured_extract/)
    dispose()
    assert.doesNotMatch(await sectionText(ctx, 'tool-mode:on-device'), /structured_extract/)
  })
})
