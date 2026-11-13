/**
 * Choose the MCP HTTP auth scheme from host configuration (P26-15/P26-16).
 *
 * Static-token remains the default custom authentication; the OAuth 2.1
 * resource-server profile is selected explicitly and does NOT require a static
 * bearer token. All validation is pure so the selection is testable without a socket.
 */

import type { ClientCredentialStore } from './credential-store.ts'
import type { HttpAuth } from './http.ts'
import { createLocalOAuthServer } from './oauth.ts'

/** The config keys this selection reads. */
export interface AuthSelectionInput {
  /** `static-token` (or absent) or `oauth-resource-server`. */
  readonly mode?: string
  /** The OAuth profile: issuer, audience and optional required scope. */
  readonly profile?: unknown
  /** The static bearer token, when static-token mode is used. */
  readonly token: string
  /** Optional durable client-credential store for OAuth. */
  readonly store?: ClientCredentialStore
}

/** The selected auth, or the exact reason no endpoint may be served. */
export type AuthSelection =
  | { readonly ok: true; readonly auth: HttpAuth }
  | { readonly ok: false; readonly reason: string }

/**
 * Select the auth scheme.
 * @param input - host config, token and optional credential store.
 * @returns the HTTP auth scheme, or a named refusal.
 */
export function selectHttpAuth(input: AuthSelectionInput): AuthSelection {
  if (input.mode === 'oauth-resource-server') {
    const profile = input.profile
    if (profile === null || typeof profile !== 'object') {
      return { ok: false, reason: 'mcpV3.auth.mode is oauth-resource-server but authorizationServerProfile is missing' }
    }
    const value = profile as { issuer?: unknown; audience?: unknown; requiredScope?: unknown }
    if (typeof value.issuer !== 'string' || value.issuer.length === 0) {
      return { ok: false, reason: 'mcpV3.auth.authorizationServerProfile.issuer must be a non-empty string' }
    }
    if (typeof value.audience !== 'string' || value.audience.length === 0) {
      return { ok: false, reason: 'mcpV3.auth.authorizationServerProfile.audience must be a non-empty string' }
    }
    const requiredScope = value.requiredScope === undefined
      ? undefined
      : Array.isArray(value.requiredScope) && value.requiredScope.every(scope => typeof scope === 'string' && scope.length > 0)
        ? value.requiredScope as string[]
        : undefined
    if (value.requiredScope !== undefined && requiredScope === undefined) {
      return { ok: false, reason: 'mcpV3.auth.authorizationServerProfile.requiredScope must be an array of non-empty strings' }
    }
    return {
      ok: true,
      auth: {
        scheme: 'oauth-resource-server',
        server: createLocalOAuthServer({
          issuer: value.issuer,
          audience: value.audience,
          ...input.store === undefined ? {} : { store: input.store },
        }),
        ...requiredScope === undefined ? {} : { requiredScope },
      },
    }
  }
  if (input.token.length === 0) {
    return {
      ok: false,
      reason: 'mcpV3.enabled is set but no bearer token is available (DSH_TOOL_MODE_MCP_TOKEN or mcpV3.tokenFile)',
    }
  }
  return {
    ok: true,
    auth: {
      scheme: 'static-token',
      token: input.token,
      clientId: 'host',
      ...input.store === undefined ? {} : { registry: input.store },
    },
  }
}
