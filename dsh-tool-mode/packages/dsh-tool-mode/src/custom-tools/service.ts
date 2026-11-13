/**
 * Host service for authoring, testing and registering custom tools.
 *
 * This is the single seam behind the Remote methods and the plugin's startup
 * restore. It owns no UI and no transport; every external dependency (model,
 * credential store, tool dispatcher, fetch) is injected.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/service
 */

import { executeCustomTool, type CustomToolDispatchDeps } from './dispatch.ts'
import { CustomToolRegistrar } from './registry.ts'
import { normalizeCustomToolDraft } from './schema.ts'
import { CustomToolStore } from './store.ts'
import type { CustomToolDraft, CustomToolRecord, CustomToolValidation } from './types.ts'

/** One row safe for the Create-tool list. */
export interface CustomToolSummary {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly description: string
  readonly kind: CustomToolRecord['execution']['kind']
  readonly version: number
  readonly enabled: boolean
  readonly agentExpose: boolean
  readonly mcpExpose: boolean
  readonly updatedAt: string
}

/** The Create-tool tab's read model. */
export interface CustomToolsSnapshot {
  readonly store: string
  readonly writable: boolean
  readonly tools: readonly CustomToolSummary[]
}

/** The result of a test invocation. */
export interface CustomToolTestResult {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: { readonly code: string; readonly message: string }
}

/** A model-authored draft, never saved by the draft call itself. */
export interface CustomToolDraftResult {
  readonly ok: boolean
  readonly draft?: CustomToolDraft
  readonly error?: { readonly code: string; readonly message: string }
}

/** Host-level seams. */
export interface CustomToolsServiceOptions {
  readonly store: CustomToolStore
  readonly registrar: CustomToolRegistrar
  readonly dispatch?: CustomToolDispatchDeps
  /** Resolve a credential reference; used by HTTP tools. */
  readonly resolveCredential?: (name: string) => Promise<string | undefined>
  /** One host-model call for agent drafts; absent disables drafting. */
  readonly draftModel?: (prompt: string, signal: AbortSignal) => Promise<string>
}

function summary(record: CustomToolRecord): CustomToolSummary {
  return {
    id: record.id,
    name: record.name,
    title: record.title,
    description: record.description,
    kind: record.execution.kind,
    version: record.version,
    enabled: record.enabled,
    agentExpose: record.policy.agentExpose,
    mcpExpose: record.policy.mcpExpose,
    updatedAt: record.updatedAt,
  }
}

/** The service used by Remote and startup restore. */
export class CustomToolsService {
  readonly store: CustomToolStore
  readonly registrar: CustomToolRegistrar
  private readonly dispatch: CustomToolDispatchDeps
  private readonly draftModel: ((prompt: string, signal: AbortSignal) => Promise<string>) | undefined

  constructor(options: CustomToolsServiceOptions) {
    this.store = options.store
    this.registrar = options.registrar
    this.draftModel = options.draftModel
    this.dispatch = {
      ...options.dispatch,
      ...options.resolveCredential === undefined
        ? {}
        : {
            http: {
              ...options.dispatch?.http,
              resolveCredential: options.resolveCredential,
            },
          },
    }
  }

  /** Read the list model without exposing definitions or secrets. */
  describe(): CustomToolsSnapshot {
    const tools = this.store.list().map(summary)
    return { store: this.store.rootDir, writable: true, tools }
  }

  /** Read one full record for editing; header secret values are references only. */
  get(id: string): CustomToolRecord | undefined {
    return this.store.read(id)
  }

  /** Restore every enabled, agent-exposed tool at startup. */
  sync() {
    return this.registrar.sync()
  }

  /** Validate a draft without persisting it. */
  validate(raw: unknown): CustomToolValidation {
    try {
      normalizeCustomToolDraft(raw)
      return { ok: true, issues: [] }
    } catch (error) {
      return {
        ok: false,
        issues: (error as { issues?: CustomToolValidation['issues'] }).issues ?? [{
          path: '',
          message: error instanceof Error ? error.message : String(error),
        }],
      }
    }
  }

  /** Execute a draft once; never persists or registers it. */
  async test(raw: unknown, args: Readonly<Record<string, unknown>>): Promise<CustomToolTestResult> {
    let draft: CustomToolDraft
    try {
      draft = normalizeCustomToolDraft(raw)
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'custom-tool-invalid',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
    // A test record has no durable identity/version; use a synthetic record with
    // the draft's shape so the compiler/executor contract is identical.
    const now = new Date().toISOString()
    const record: CustomToolRecord = {
      schemaVersion: 1,
      ...draft,
      version: 0,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }
    try {
      const value = await executeCustomTool(record, args, {
        signal: new AbortController().signal,
      }, this.dispatch)
      return { ok: true, value }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: (error as { code?: string }).code ?? 'custom-tool-test-failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /**
   * Ask the host model for a draft from a natural-language description. The
   * result is validated but never saved, registered or executed.
   */
  async draft(description: string): Promise<CustomToolDraftResult> {
    if (this.draftModel === undefined) {
      return { ok: false, error: { code: 'custom-tool-draft-unavailable', message: 'no host model is composed for drafting' } }
    }
    if (description.trim().length === 0) {
      return { ok: false, error: { code: 'custom-tool-draft-invalid', message: 'describe the tool you want before drafting' } }
    }
    const prompt = [
      'You are drafting one DSH custom tool definition. Return ONLY a JSON object, no markdown.',
      'The object MUST have these fields: id ("custom.<slug>"), name ("custom_<slug>"), title,',
      'description, parameters (JSON Schema object), execution, policy, examples.',
      'execution is one of:',
      '{"kind":"http","http":{"method":"GET","url":"https://...","headers":{}}}',
      '{"kind":"prompt","prompt":{"template":"...","maxOutputTokens":512}}',
      '{"kind":"composite","composite":{"steps":[{"tool":"lang_detect","args":{"text":"{{text}}"}}]}}',
      'policy MUST contain timeoutMs, readOnly, networkOrigins (exact https origins; [] unless http),',
      'agentExpose (default true) and mcpExpose (default false).',
      'Never put a secret value in the object; use {"secret":"ENV_NAME"} in HTTP headers.',
      'The description field must explain when an agent should call the tool.',
      'User description:',
      description,
    ].join('\n')
    let text: string
    try {
      text = await this.draftModel(prompt, new AbortController().signal)
    } catch (error) {
      return {
        ok: false,
        error: { code: 'custom-tool-draft-failed', message: error instanceof Error ? error.message : String(error) },
      }
    }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return { ok: false, error: { code: 'custom-tool-draft-invalid', message: 'the model did not return a JSON object' } }
    }
    try {
      const draft = normalizeCustomToolDraft(JSON.parse(text.slice(start, end + 1)))
      return { ok: true, draft }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'custom-tool-draft-invalid',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /** Validate, persist a new immutable version and register it when exposed. */
  save(raw: unknown): CustomToolRecord {
    const draft = normalizeCustomToolDraft(raw)
    const record = this.store.save(draft)
    if (record.enabled && record.policy.agentExpose) {
      this.registrar.register(record)
    } else {
      this.registrar.dispose(record.id)
    }
    return record
  }

  /** Enable/disable one tool and reconcile the live registration. */
  setEnabled(id: string, enabled: boolean): CustomToolRecord {
    const record = this.store.setEnabled(id, enabled)
    if (enabled && record.policy.agentExpose) {
      this.registrar.register(record)
    } else {
      this.registrar.dispose(id)
    }
    return record
  }

  /** Delete the active pointer and remove the live tool. */
  delete(id: string): boolean {
    this.registrar.dispose(id)
    return this.store.delete(id)
  }
}
