/**
 * Durable custom-tool authoring records.
 *
 * These are NOT runtime tool definitions. A record is validated, versioned and
 * compiled into a `defineTool` definition by the host. Keeping the two separate
 * lets the store reject a bad draft without ever exposing a partial tool.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/types
 */

/** The safe execution kinds supported in v1. */
export type CustomToolKind = 'http' | 'prompt' | 'composite'

/** One literal or credential-reference HTTP header. */
export type HttpHeaderValue = string | { readonly secret: string }

/** The supported HTTP execution definition. */
export interface HttpExecution {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Template URL; only `{{argument}}` leaves are interpolated. */
  readonly url: string
  readonly headers: Readonly<Record<string, HttpHeaderValue>>
  /** Optional JSON body template with `{{argument}}` leaves. */
  readonly bodyTemplate?: string
  /** Dot-path extraction from the JSON response; empty means the whole body. */
  readonly extract?: string
}

/** The supported prompt execution definition. */
export interface PromptExecution {
  /** Template; only `{{argument}}` leaves are interpolated. */
  readonly template: string
  /** Optional model id; absent means the deployment default. */
  readonly model?: string
  readonly maxOutputTokens?: number
}

/** One composite step. `{{steps.N.result}}` addresses a previous result. */
export interface CompositeStep {
  readonly tool: string
  readonly args: Readonly<Record<string, string>>
  readonly requiresApproval?: boolean
}

/** The supported composite execution definition. */
export interface CompositeExecution {
  readonly steps: readonly CompositeStep[]
  /** Optional selector for the final result; default is the last step. */
  readonly output?: string
}

/** The execution union carried by a record. */
export type CustomToolExecution =
  | { readonly kind: 'http'; readonly http: HttpExecution }
  | { readonly kind: 'prompt'; readonly prompt: PromptExecution }
  | { readonly kind: 'composite'; readonly composite: CompositeExecution }

/** Governance carried by every custom tool. */
export interface CustomToolPolicy {
  /** Cooperative execution deadline. */
  readonly timeoutMs: number
  /** Advisory read-only hint for the agent/UI. */
  readonly readOnly: boolean
  /** Exact HTTPS origins the HTTP executor may reach. */
  readonly networkOrigins: readonly string[]
  /** Whether the tool is exposed to agents. */
  readonly agentExpose: boolean
  /** Whether the tool is exposed over MCP. Default false. */
  readonly mcpExpose: boolean
}

/** One example shown in the form and used by the test panel. */
export interface CustomToolExample {
  readonly title: string
  readonly arguments: Readonly<Record<string, unknown>>
}

/** A complete, validated authoring record. */
export interface CustomToolRecord {
  readonly schemaVersion: 1
  /** Stable id; also the directory name. */
  readonly id: string
  /** DSH tool name (`custom_...`). */
  readonly name: string
  readonly title: string
  readonly description: string
  /** JSON Schema object for arguments. */
  readonly parameters: Readonly<Record<string, unknown>>
  /** Optional JSON Schema for the canonical result. */
  readonly outputSchema?: Readonly<Record<string, unknown>>
  readonly execution: CustomToolExecution
  readonly policy: CustomToolPolicy
  readonly examples: readonly CustomToolExample[]
  readonly version: number
  readonly enabled: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/** A user-editable draft before it has an id/version/timestamps. */
export interface CustomToolDraft {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly outputSchema?: Readonly<Record<string, unknown>>
  readonly execution: CustomToolExecution
  readonly policy: CustomToolPolicy
  readonly examples: readonly CustomToolExample[]
}

/** The active entry for one custom tool. */
export interface CustomToolIndexEntry {
  readonly activeVersion: number
  readonly enabled: boolean
  readonly updatedAt: string
}

/** The durable index document. */
export interface CustomToolIndex {
  readonly schemaVersion: 1
  readonly tools: Readonly<Record<string, CustomToolIndexEntry>>
}

/** One validation issue, safe to render in the form. */
export interface CustomToolIssue {
  /** Dot path into the draft. */
  readonly path: string
  readonly message: string
}

/** The validation verdict for a draft. */
export interface CustomToolValidation {
  readonly ok: boolean
  readonly issues: readonly CustomToolIssue[]
}
