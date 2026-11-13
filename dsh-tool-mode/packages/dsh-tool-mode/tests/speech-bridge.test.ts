/** ARCH-04 — one Voz-backed speech provider, shared by every transport. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { installVozSpeechProvider, type SpeechProviderLike, type SpeechRegistryLike, type ToolExecutorLike } from '../src/speech-bridge.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

function fakeRegistry(): { registry: SpeechRegistryLike; providers: SpeechProviderLike[]; disposers: (() => Promise<void>)[] } {
  const providers: SpeechProviderLike[] = []
  const disposers: (() => Promise<void>)[] = []
  return {
    providers,
    disposers,
    registry: {
      register(provider) {
        providers.push(provider)
        const dispose = async (): Promise<void> => {
          const index = providers.indexOf(provider)
          if (index >= 0) providers.splice(index, 1)
        }
        disposers.push(dispose)
        return dispose
      },
    },
  }
}

describe('ARCH-04 — Voz speech provider bridge', () => {
  /**
   * The real regression: `listProviders()` can say the id is absent and
   * `register()` can still refuse it, because a standalone STT plugin registered
   * between the check and the registration (or the roster is not live yet). The
   * throw used to escape `apply()` and remove the whole plugin surface.
   */
  it('survives a duplicate registration that listProviders() did not report, with one onSkipped', async () => {
    let registrations = 0
    const registry: SpeechRegistryLike = {
      listProviders: () => [],
      register() {
        registrations += 1
        throw new Error('Speech provider already registered: voz-local')
      },
    }
    const skipped: string[] = []
    const dispose = installVozSpeechProvider(registry, { async execute() { return { isError: false } } }, {
      stateDir: tempDir(),
      onSkipped: reason => skipped.push(reason),
    })

    assert.equal(registrations, 1, 'the absent-roster path still attempts the registration once')
    assert.equal(typeof dispose, 'function', 'a skip still returns a disposer the caller can await')
    assert.equal(skipped.length, 1, 'the skip is reported exactly once')
    assert.match(skipped[0]!, /already registered/)
    assert.match(skipped[0]!, /voz-local/)
    await dispose()
  })

  it('registers exactly once and reports no skip when the provider is absent', () => {
    const { registry, providers } = fakeRegistry()
    registry.listProviders = () => []
    let registrations = 0
    const original = registry.register
    registry.register = provider => {
      registrations += 1
      return original(provider)
    }
    const skipped: string[] = []
    installVozSpeechProvider(registry, { async execute() { return { isError: false } } }, {
      stateDir: tempDir(),
      onSkipped: reason => skipped.push(reason),
    })
    assert.equal(registrations, 1)
    assert.equal(providers.length, 1)
    assert.deepEqual(skipped, [])
  })

  it('propagates a non-duplicate registration failure instead of hiding it', () => {
    const failure = new Error('speech registry unavailable')
    const registry: SpeechRegistryLike = {
      listProviders: () => [],
      register() {
        throw failure
      },
    }
    const skipped: string[] = []
    assert.throws(
      () => installVozSpeechProvider(registry, { async execute() { return { isError: false } } }, {
        stateDir: tempDir(),
        onSkipped: reason => skipped.push(reason),
      }),
      (error: unknown) => error === failure,
    )
    assert.deepEqual(skipped, [], 'a real fault is not reported as a duplicate skip')
  })

  it('does not abort plugin apply when another plugin already serves voz-local', async () => {
    const { registry, providers } = fakeRegistry()
    registry.listProviders = () => [{ id: 'voz-local' }]
    const tools: ToolExecutorLike = { async execute() { return { isError: false, value: { text: 'x' } } } }
    const dispose = installVozSpeechProvider(registry, tools, { stateDir: tempDir() })
    assert.equal(providers.length, 0, 'the duplicate registration is skipped, not thrown')
    await dispose()
  })
  it('registers ONE host-local provider backed by the existing Voz tool', async () => {
    const stateDir = tempDir()
    const { registry, providers } = fakeRegistry()
    const calls: { name: string; arguments: Readonly<Record<string, unknown>> }[] = []
    const tools: ToolExecutorLike = {
      async execute(request) {
        calls.push({ name: request.name, arguments: request.arguments })
        return { isError: false, value: { text: 'hello world', coverage: { transcribedSeconds: 1.25 } } }
      },
    }
    const dispose = installVozSpeechProvider(registry, tools, { stateDir })
    assert.equal(providers.length, 1)
    const provider = providers[0]!
    assert.equal(provider.info.location, 'host-local')
    assert.ok(provider.info.languages.includes('auto'))

    const transcript = await provider.transcribe({ audio: new Uint8Array([1, 2, 3]), language: 'en' }, new AbortController().signal)
    assert.equal(transcript.text, 'hello world')
    assert.equal(transcript.audioSeconds, 1.25)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.name, 'stt_transcribe')
    const audio = (calls[0]!.arguments as { audio: { path: string } }).audio
    assert.equal(existsSync(audio.path), false, 'the temporary WAV is removed after the call')
    assert.deepEqual(readdirSync(stateDir), [], 'no handoff directory is left behind')
    await dispose()
    assert.equal(providers.length, 0)
  })

  it('a refused Voz call rejects and still cleans the handoff directory', async () => {
    const stateDir = tempDir()
    const { registry, providers } = fakeRegistry()
    const tools: ToolExecutorLike = {
      async execute() {
        return { isError: true, value: { error: 'no speech' } }
      },
    }
    installVozSpeechProvider(registry, tools, { stateDir })
    await assert.rejects(
      providers[0]!.transcribe({ audio: new Uint8Array([1]), language: 'de' }, new AbortController().signal),
      /refused the recording/,
    )
    assert.deepEqual(readdirSync(stateDir), [])
    assert.equal(existsSync(join(stateDir, 'recording.wav')), false)
  })
})