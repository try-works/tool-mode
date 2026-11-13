/**
 * ARCH-04 — the local Voz deployment as a shared `speechToText` provider.
 *
 * DSH exposes an experimental `speechToText` registry. This bridge registers a
 * host-local provider whose `transcribe()` dispatches to the SAME `stt_transcribe`
 * tool the native and MCP surfaces already use, so a speech request never starts
 * a second Voz instance merely because another transport connected.
 *
 * The bridge is deliberately structural: the harness speech package is not a
 * hard dependency, and an older DSH without the service simply gets no bridge.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** The provider facts the DSH speech registry reads. */
export interface SpeechProviderInfoLike {
  readonly id: string
  readonly name: string
  readonly location: 'host-local' | 'cloud'
  readonly languages: readonly string[]
}

/** One provider the DSH speech registry accepts. */
export interface SpeechProviderLike {
  readonly info: SpeechProviderInfoLike
  transcribe(input: { readonly audio: Uint8Array; readonly language: string }, signal: AbortSignal): Promise<{
    readonly text: string
    readonly audioSeconds: number
    readonly inferenceSeconds: number
  }>
}

/** The slice of the DSH speech service this bridge uses. */
export interface SpeechRegistryLike {
  register(provider: SpeechProviderLike): () => Promise<void>
  /** The live provider roster, when the host exposes it. */
  listProviders?(): readonly { readonly id: string }[]
}

/** The slice of the host tool runtime this bridge uses. */
export interface ToolExecutorLike {
  execute(request: {
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
    readonly signal: AbortSignal
  }): Promise<{ readonly isError?: boolean; readonly value?: unknown }>
}

/** Options for {@link installVozSpeechProvider}. */
export interface VozSpeechBridgeOptions {
  /** Directory owned by the host for the short-lived WAV handoff. */
  readonly stateDir: string
  /** The already-published Voz tool; defaults to `stt_transcribe`. */
  readonly toolName?: string
  /** Provider id shown to the speech UI. */
  readonly providerId?: string
  /**
   * Called when the bridge contributes nothing because the provider is already
   * served (either visible through `listProviders()` or refused by `register()`).
   * A skip is not an error: the existing provider remains the one deployment, and
   * the caller can record the reason at the same level it would log one.
   */
  readonly onSkipped?: (reason: string) => void
}

/** The registration refusal DSH's speech registry raises for a duplicate id. */
const DUPLICATE_REGISTRATION_PREFIX = 'Speech provider already registered'

/**
 * Whether an error is the registry's duplicate-provider refusal for THIS id.
 *
 * Only that one fault is recoverable. A registry that is unavailable, a malformed
 * provider or any other throw is a real failure and must keep propagating: swallowing
 * it would silently disable speech for the whole process.
 * @param error - the thrown value.
 * @param providerId - the id this bridge tried to register.
 * @returns true only for the duplicate refusal naming this provider.
 */
function isDuplicateProviderError(error: unknown, providerId: string): boolean {
  return error instanceof Error
    && error.message.startsWith(DUPLICATE_REGISTRATION_PREFIX)
    && error.message.includes(providerId)
}

/** The one-line reason recorded when the bridge yields to an existing provider. */
function skipReason(providerId: string): string {
  return `speech provider "${providerId}" is already registered; keeping the existing provider `
    + '(the Voz tool bridge contributes nothing and is not needed)'
}

/** Languages the local Voz model accepts as hints; `auto` is the model's own mode. */
const VOZ_LANGUAGES = [
  'auto', 'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'uk', 'tr',
  'zh', 'ja', 'ko', 'ar', 'hi', 'vi', 'th', 'id',
] as const

/**
 * Register the Voz-backed speech provider.
 * @param registry - the DSH speech service.
 * @param tools - the host tool runtime that owns the one Voz deployment.
 * @param options - local state directory and names.
 * @returns the idempotent unregister function.
 */
export function installVozSpeechProvider(
  registry: SpeechRegistryLike,
  tools: ToolExecutorLike,
  options: VozSpeechBridgeOptions,
): () => Promise<void> {
  const toolName = options.toolName ?? 'stt_transcribe'
  const providerId = options.providerId ?? 'voz-local'
  /*
   * A profile may also mount the standalone STT plugin, which registers the same
   * `voz-local` id. The speech registry refuses duplicates, and an uncaught throw
   * here aborts the WHOLE model-tools plugin apply (settings, MCP, every tool).
   * If the id is already served, this bridge contributes nothing; the existing
   * provider remains the one headless deployment.
   */
  if (registry.listProviders?.().some(provider => provider.id === providerId) === true) {
    options.onSkipped?.(skipReason(providerId))
    return async () => {}
  }
  const provider: SpeechProviderLike = {
    info: {
      id: providerId,
      name: 'Desert Ant Voz (local)',
      location: 'host-local',
      languages: VOZ_LANGUAGES,
    },
    async transcribe(input, signal) {
      signal.throwIfAborted()
      mkdirSync(options.stateDir, { recursive: true })
      const dir = mkdtempSync(join(options.stateDir, 'voz-speech-'))
      const path = join(dir, 'recording.wav')
      try {
        writeFileSync(path, input.audio)
        const started = Date.now()
        const result = await tools.execute({
          name: toolName,
          arguments: { audio: { path }, language: input.language },
          signal,
        })
        if (result.isError === true) {
          throw new Error(`the local Voz provider refused the recording: ${JSON.stringify(result.value)}`)
        }
        const value = (result.value ?? {}) as Record<string, unknown>
        const coverage = (value.coverage ?? {}) as Record<string, unknown>
        const audioSeconds = typeof coverage.transcribedSeconds === 'number' ? coverage.transcribedSeconds : 0
        return {
          text: typeof value.text === 'string' ? value.text : '',
          audioSeconds,
          inferenceSeconds: (Date.now() - started) / 1000,
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
  /*
   * The roster is not authoritative for the outcome: it can lag a provider that
   * registered after the fast-path check (a standalone STT plugin, or a race). The
   * registry then refuses OUR registration with the duplicate message, and that ONE
   * refusal is a skip, not a plugin failure. Every other throw propagates.
   */
  try {
    return registry.register(provider)
  } catch (error) {
    if (!isDuplicateProviderError(error, providerId)) throw error
    options.onSkipped?.(skipReason(providerId))
    return async () => {}
  }
}