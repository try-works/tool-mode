/** ARCH-04 host mount — the plugin publishes the Voz bridge when speechToText exists. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { digestInstalledContent, ExtensionStore } from '@try-works/tool-mode-extension-sdk'

import * as plugin from '../src/index.ts'
import type { SpeechProviderLike, SpeechRegistryLike } from '../src/speech-bridge.ts'
import { cleanup, isolatedStateFile, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const VOZ_ID = '@try-works/extension-desert-ant-voz'
const VOZ_DIR = join(process.cwd(), 'packages', 'extension-desert-ant-voz')
const VOZ_VERSION = '0.1.5'

function storeWithVoz(): string {
  const storeDir = tempDir()
  new ExtensionStore(storeDir).recordInstall({
    extensionId: VOZ_ID,
    version: VOZ_VERSION,
    installPath: VOZ_DIR,
    archiveDigest: 'a'.repeat(128),
    contentDigest: digestInstalledContent(VOZ_DIR),
  })
  return storeDir
}

describe('ARCH-04 — host mounts the Voz speech provider bridge once', () => {
  it('registers one provider and dispatches transcribe through the existing stt_transcribe tool', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    const providers: SpeechProviderLike[] = []
    const registry: SpeechRegistryLike = {
      register(provider) {
        providers.push(provider)
        return async () => { providers.splice(providers.indexOf(provider), 1) }
      },
    }
    ctx.provide('speechToText', registry)
    await ctx.plugin(plugin, {
      stateFile: isolatedStateFile(),
      extensionStore: storeWithVoz(),
      managementGrant: true,
    })
    assert.equal(providers.length, 1, 'exactly one Voz-backed speech provider')
    assert.equal(providers[0]!.info.id, 'voz-local')
    assert.equal(providers[0]!.info.location, 'host-local')

    const executeBefore = ctx.tools.execute.bind(ctx.tools)
    ctx.tools.execute = (async request => {
      if ((request as { name?: string }).name === 'stt_transcribe') {
        return { isError: false, value: { text: 'bridged transcript', coverage: { transcribedSeconds: 2.5 } } }
      }
      return await executeBefore(request)
    }) as typeof ctx.tools.execute

    const transcript = await providers[0]!.transcribe(
      { audio: new Uint8Array([1, 2, 3]), language: 'en' },
      new AbortController().signal,
    )
    assert.equal(transcript.text, 'bridged transcript')
    assert.equal(transcript.audioSeconds, 2.5)
    await ctx.fiber.dispose()
    assert.equal(providers.length, 0, 'the provider registration is disposed with the host')
  })
})