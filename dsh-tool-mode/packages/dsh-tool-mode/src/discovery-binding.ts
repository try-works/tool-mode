/**
 * The binding resolution shared by discovery and program preflight.
 *
 * Callable, bindable and probe-resolved must be the same answer: grant AND live
 * registry AND caller scope. Keeping that question here means discovery cannot
 * grow a second opinion about it.
 *
 * @module discovery-binding
 */

import type { BuiltScopeContext } from './artifact-scope-context.ts'
import { EXCLUDED_BINDINGS } from './ptc-authority.ts'

/** What the resolver reads from the live host. */
export interface DiscoveryBindingDeps {
  /** Names currently in the registry. */
  readonly toolNames: () => readonly string[]
  /** Whether a name has an implementation right now. */
  readonly toolExists: (name: string) => boolean
  /** Operator confidential set (MCP-11). */
  readonly confidential: () => ReadonlySet<string>
  /** The external caller's grant, or undefined for the host path. */
  readonly externalGrant: () => readonly string[] | undefined
  /** False when the name is an authored tool absent from this caller's scope. */
  readonly authoredVisibleAt?: ((name: string, scope: BuiltScopeContext) => boolean) | undefined
}

/** One name's resolution, with the cause and the action when it fails. */
export interface BindingResolution {
  readonly resolved: boolean
  readonly reason?: string
  readonly action?: string
  readonly scope: string
  readonly scopeKey: string
}

/** The two entry points discovery needs. */
export interface BindingResolver {
  resolve(name: string, scope?: BuiltScopeContext): BindingResolution
  bindable(name: string, scope?: BuiltScopeContext): boolean
}

/**
 * Build the resolver.
 *
 * @param deps - live registry, confidentiality, grant and authoring scope.
 * @returns the resolver.
 */
export function createBindingResolver(deps: DiscoveryBindingDeps): BindingResolver {
  const resolve = (name: string, scope?: BuiltScopeContext): BindingResolution => {
    const base = {
      scope: scope?.scope ?? 'global',
      // The scope's OWN key, not the workspace key: a session preflight must identify
      // session-… so a caller can prove which session the grant belongs to.
      scopeKey: scope?.context.scopeKey ?? 'global',
    }
    if (EXCLUDED_BINDINGS.includes(name)) {
      return { ...base, resolved: false, reason: 'excluded', action: 'Call it directly, not from a program (CODE-07).' }
    }
    if (deps.confidential().has(name)) {
      return { ...base, resolved: false, reason: 'confidential', action: 'The operator confidentiality policy blocks this value from crossing a program boundary.' }
    }
    const callerGrant = deps.externalGrant()
    if (callerGrant !== undefined && !callerGrant.includes(name)) {
      return { ...base, resolved: false, reason: 'not-authorized', action: 'Request a caller grant that includes this name, or call it outside the program.' }
    }
    if (!deps.toolNames().includes(name)) {
      return { ...base, resolved: false, reason: 'not-registered', action: 'Install or activate the tool, or check the spelling.' }
    }
    if (scope !== undefined && deps.authoredVisibleAt?.(name, scope) === false) {
      return {
        ...base,
        resolved: false,
        reason: 'not-visible-at-scope',
        action: `Save the artifact with scope "${scope.scope}" (or call it from the scope that owns it).`,
      }
    }
    if (!deps.toolExists(name)) {
      return { ...base, resolved: false, reason: 'not-registered', action: 'Install or activate the tool, or check the spelling.' }
    }
    return { ...base, resolved: true }
  }
  return {
    resolve,
    bindable: (name, scope) => scope === undefined
      ? !EXCLUDED_BINDINGS.includes(name) && !deps.confidential().has(name)
      : resolve(name, scope).resolved,
  }
}
