/**
 * The MCP surface status (plan §3.4, MCP tab).
 *
 * Everything here is a fact the host already holds: the BOUND endpoint (or that none
 * was bound), the configured `mcpV3` values, the credential store's client identities,
 * the external ledger's observed clients and the export surface. The page must not
 * invent a listening state, a port, or a client name — so this module has no defaults
 * that guess: a missing endpoint is `null`, an unobserved client has zero calls, and
 * the token VALUE has no field to travel in (only the file path).
 *
 * @module @try-works/dsh-tool-mode/mcp-status
 */

import type { McpUsageClient, McpUsageSummary } from './mcp-usage.ts'

/** The supported authentication modes, named as the transport names them. */
export type McpAuthMode = 'static-token' | 'oauth-resource-server' | 'none'

/** A bound endpoint, as the transport reported it. */
export interface McpBoundEndpoint {
  readonly host: string
  readonly port: number
  readonly url: string
}

/** The configured endpoint values (a config fact, not a listening claim). */
export interface McpConfiguredEndpoint {
  readonly host: string
  readonly port: number
  readonly path: string
}
/** Everything the status view may read. */
export interface McpStatusInput {
  readonly enabled: boolean
  readonly configured: McpConfiguredEndpoint | null
  /** The BOUND endpoint, or null when nothing is listening. */
  readonly endpoint: McpBoundEndpoint | null
  readonly authMode: McpAuthMode
  /** The operator token file path, never the token. */
  readonly tokenFile: string | null
  /** Tool names the export surface actually publishes. */
  readonly published: readonly string[]
  /** Tool names withheld by the export policy, with reasons owned by the host. */
  readonly withheld: readonly string[]
  /** Client identities the credential store holds. */
  readonly credentialClients: readonly string[]
  /** The static-token client identity, present only when that mode is enabled. */
  readonly staticClientId: string | null
  /** When the endpoint started listening, or null when it never bound. */
  readonly startedAt: number | null
  /** The clock used for `uptimeMs` (injectable so a test is deterministic). */
  readonly now?: number
  readonly ledger: McpUsageSummary
}

/** One client identity on the MCP tab. */
export interface McpStatusClient {
  readonly clientId: string
  /** Alias of {@link McpStatusClient.clientId} for the client's flat contract. */
  readonly id: string
  /** A display label; only the ledger/credential identity is known, so it equals the id. */
  readonly label: string
  /** The client's own grant identity observed in the ledger, or null. */
  readonly grantId: string | null
  readonly calls: number
  readonly errors: number
  readonly lastSeen: number | null
}

/** The status view (flat client contract). */
export interface McpStatusView {
  readonly enabled: boolean
  readonly listening: boolean
  /** The bound endpoint, null whenever MCP is not serving. */
  readonly endpoint: { readonly host: string; readonly port: number; readonly path: string; readonly url: string } | null
  readonly configured: McpConfiguredEndpoint | null
  readonly transport: 'http'
  readonly auth: { readonly scheme: McpAuthMode; readonly mode: McpAuthMode; readonly tokenFile: string | null }
  /** Wall time since the endpoint bound; 0 while nothing is listening. */
  readonly uptimeMs: number
  readonly clients: readonly McpStatusClient[]
  readonly exposed: readonly string[]
  readonly withheld: readonly string[]
  readonly exposedCount: number
  readonly withheldCount: number
}

/** `model_tools` is host-local and can never be exported over MCP. */
const ALWAYS_WITHHELD = 'model_tools'

/**
 * Build the MCP status view.
 * @param input - the bound/configured facts, identities, surface and ledger summary.
 * @returns the status; every absent fact stays explicit.
 */
export function buildMcpStatus(input: McpStatusInput): McpStatusView {
  const listening = input.enabled && input.endpoint !== null
  const withheldSet = new Set(input.withheld)
  withheldSet.add(ALWAYS_WITHHELD)
  const exposed = listening
    ? input.published.filter(name => name !== ALWAYS_WITHHELD && !withheldSet.has(name)).sort((left, right) => left.localeCompare(right))
    : []
  const withheld = listening
    ? [...withheldSet].sort((left, right) => left.localeCompare(right))
    // Nothing is served while disabled: every published tool is withheld, and the
    // host-local tool stays withheld regardless.
    : [...new Set([...input.published, ...input.withheld, ALWAYS_WITHHELD])].sort((left, right) => left.localeCompare(right))

  const clients = new Map<string, McpStatusClient>()
  const ledgerClient = (clientId: string): McpUsageClient | undefined => input.ledger.clients.find(client => client.clientId === clientId)
  const identities = [input.authMode === 'static-token' ? input.staticClientId : null, ...input.credentialClients, ...input.ledger.clients.map(client => client.clientId)]
    .filter((clientId): clientId is string => clientId !== null && clientId.length > 0)
  for (const clientId of identities) {
    if (clients.has(clientId)) continue
    const observed = ledgerClient(clientId)
    clients.set(clientId, {
      clientId,
      id: clientId,
      // No name store exists: the authenticated identity IS the only truthful label.
      label: clientId,
      grantId: observed?.grantId ?? null,
      calls: observed?.calls ?? 0,
      errors: observed?.errors ?? 0,
      lastSeen: observed === undefined ? null : observed.lastSeen,
    })
  }

  const start = input.startedAt
  const now = input.now ?? Date.now()
  return {
    enabled: input.enabled,
    listening,
    endpoint: listening && input.endpoint !== null
      ? { host: input.endpoint.host, port: input.endpoint.port, path: input.configured?.path ?? '/mcp', url: input.endpoint.url }
      : null,
    configured: input.configured,
    transport: 'http',
    auth: { scheme: input.authMode, mode: input.authMode, tokenFile: input.tokenFile },
    uptimeMs: listening && start !== null ? Math.max(0, now - start) : 0,
    clients: [...clients.values()].sort((left, right) => left.clientId.localeCompare(right.clientId)),
    exposed,
    withheld,
    exposedCount: exposed.length,
    withheldCount: withheld.length,
  }
}
