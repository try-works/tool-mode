/**
 * Resolving a declarative model package's provider factory (Phase 2, AT-25).
 *
 * The host must not declare an engine dependency. So the ENGINE lives in the extension
 * package, and the host reaches it by NAME, at run time, resolved from the extension's own
 * installed directory:
 *
 *     createRequire(<packageDir>/package.json).resolve(<recipe.provider.package>)
 *       -> import(<resolved file URL>)[<recipe.provider.export>]
 *
 * Why `createRequire` anchored at the package directory rather than a bare `import()`:
 * a bare import resolves from THIS module's location, which would find the host's own
 * dependencies (or nothing) instead of the extension's. Anchoring the require to the
 * extension's `package.json` makes the extension's `node_modules` the resolution root, so
 * an engine the host has never installed is still reachable — and an engine the host DID
 * install cannot be substituted for the one the recipe names.
 *
 * Every failure is NAMED (`specifier`, `resolve`, `import`, `export`), because a code-free
 * package that registers no tool is otherwise indistinguishable from one that registered
 * nothing on purpose.
 *
 * @module @try-works/tool-mode-runtime-recipes/provider-factory
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { ModelProviderV1, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'

import { describeError, describeKind } from './diagnostics.ts'
import type { ModelRuntimeRecipe } from './model-runtime-recipe.ts'

/**
 * A bare, installable package name: an optional scope plus a name, and never a path.
 *
 * The recipe is validated before it gets here, but this loader ALSO refuses a path-shaped
 * specifier: `createRequire().resolve('../x')` reads outside the extension directory, and
 * the loader must not be the place where a validation gap becomes a filesystem read.
 */
const BARE_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/**
 * The factory an engine package exports for a declarative model recipe.
 *
 * The signature is the Phase 2 contract verbatim: the parsed recipe, the host-verified
 * assets, and the SDK's Promise-based provider. The factory owns engine loading and the
 * processor named by `processor.id`; the recipe supplies the artifact, limits and tool
 * schemas.
 */
export type ModelRuntimeProviderFactory = (
  recipe: ModelRuntimeRecipe,
  assets: Readonly<PreparedAssetMapV1>,
) => ModelProviderV1

/** What the loader needs to resolve a factory. */
export interface LoadProviderFactoryInput {
  /** The installed extension package root that the module is resolved FROM. */
  readonly packageDir: string
  /** The validated recipe naming the engine package and export. */
  readonly recipe: ModelRuntimeRecipe
  /**
   * Test seam: import a resolved module URL. Defaults to the runtime's own dynamic
   * `import`. Production callers should omit it.
   */
  readonly import?: (moduleUrl: string) => Promise<unknown>
}

/** The stage that refused to produce a factory. */
export type ProviderFactoryLoadFailureReason =
  /** `provider.package` is not a bare package name. */
  | 'specifier'
  /** The package cannot be resolved from the extension directory. */
  | 'resolve'
  /** The resolved module could not be imported. */
  | 'import'
  /** The module has no such named export, or it is not a function. */
  | 'export'

/** A loaded factory, or the named refusal. */
export type ProviderFactoryLoadResult =
  | {
      readonly ok: true
      /** The factory, ready to be called with the recipe and the verified assets. */
      readonly factory: ModelRuntimeProviderFactory
      /** The resolved module URL that was imported, for logs and receipts. */
      readonly moduleUrl: string
    }
  | {
      readonly ok: false
      /** Which stage refused. */
      readonly reason: ProviderFactoryLoadFailureReason
      /** What went wrong, including the package, export and underlying error. */
      readonly detail: string
    }

/** A named property read from a module namespace. */
interface NamedExport {
  readonly found: boolean
  readonly value: unknown
}

/** Read a named export without touching the object protocol. */
function namedExport(namespace: unknown, name: string): NamedExport {
  if (typeof namespace !== 'object' || namespace === null) {
    return { found: false, value: undefined }
  }
  /*
   * An OWN property only. A module namespace object has a null prototype, but the value
   * this function receives is `unknown` and a caller's test seam may return anything:
   * `Object.hasOwn` keeps `constructor` and friends from resolving through a prototype
   * even if a recipe was constructed without going through the parser.
   */
  if (!Object.hasOwn(namespace, name)) return { found: false, value: undefined }
  // SAFETY: Object.hasOwn proved the property is an own, enumerable-by-identity property of
  // this object; reading that own property cannot reach a prototype. The value stays
  // `unknown` and is narrowed by the function check below.
  const record = namespace as Readonly<Record<string, unknown>>
  return { found: true, value: record[name] }
}

/**
 * Resolve and import the provider factory named by a declarative model recipe.
 *
 * Resolving and importing are NOT the same promise: `resolve` can fail because the engine
 * is not installed, and `import` can fail because the engine is installed but broken. The
 * result keeps them apart so a host can report the difference.
 *
 * @param input - the extension directory and the recipe naming the factory
 * @returns the factory, or a named refusal
 */
export async function loadProviderFactory(input: LoadProviderFactoryInput): Promise<ProviderFactoryLoadResult> {
  const packageName = input.recipe.provider.package
  const exportName = input.recipe.provider.export

  if (!BARE_PACKAGE_NAME_PATTERN.test(packageName)) {
    return {
      ok: false,
      reason: 'specifier',
      detail:
        `provider.package ${JSON.stringify(packageName)} is not a bare package name; `
        + 'the loader resolves an installed package, not a path',
    }
  }

  let resolved: string
  try {
    resolved = createRequire(join(input.packageDir, 'package.json')).resolve(packageName)
  } catch (cause) {
    return {
      ok: false,
      reason: 'resolve',
      detail: `cannot resolve ${packageName} from ${input.packageDir}: ${describeError(cause)}`,
    }
  }

  const moduleUrl = pathToFileURL(resolved).href
  let namespace: unknown
  try {
    namespace = input.import === undefined ? await import(moduleUrl) : await input.import(moduleUrl)
  } catch (cause) {
    return {
      ok: false,
      reason: 'import',
      detail: `cannot import ${packageName} (${moduleUrl}): ${describeError(cause)}`,
    }
  }

  const exported = namedExport(namespace, exportName)
  if (!exported.found) {
    return {
      ok: false,
      reason: 'export',
      detail: `${packageName} has no export named ${JSON.stringify(exportName)}`,
    }
  }
  if (typeof exported.value !== 'function') {
    return {
      ok: false,
      reason: 'export',
      detail:
        `the export ${JSON.stringify(exportName)} of ${packageName} is not a function; `
        + `received ${describeKind(exported.value)}`,
    }
  }

  /*
   * SAFETY: the value is a function and the factory contract is structural at run time —
   * the host calls it with the parsed recipe and the verified assets, and the SDK checks
   * the returned provider when it is used. The declared RETURN type cannot be established
   * without calling the factory, which Phase 2 deliberately does not do at load time.
   */
  const factory = exported.value as ModelRuntimeProviderFactory
  return { ok: true, factory, moduleUrl }
}
