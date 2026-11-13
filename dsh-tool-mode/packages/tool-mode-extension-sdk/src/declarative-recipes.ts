/**
 * Resolving a DECLARATIVE implementation's recipe (EXT-13, RCP-01, slice 3).
 *
 * THE CONVENTION THIS ESTABLISHES, and why it has to exist. The pinned manifest schema's
 * `implementations` items permit only `id`, `contractId`, `contractVersion`, `modelId` and
 * `recipeVersion`, with `additionalProperties: false` — so **a manifest cannot name its
 * recipe files**. There is no path field to read.
 *
 * What a manifest declares is a recipe VERSION. The ARTEFACT is therefore located by a
 * convention, and until now no convention existed because nothing had ever consumed a
 * declarative manifest: every package in this repository was `kind: "module"` and reached its
 * behaviour through a module entry.
 *
 * The convention, stated once so it is not re-invented at each call site:
 *
 *     <package>/recipes/<implementation-id>.json
 *
 * Chosen because the implementation id is already unique within the package, already matches
 * `^[a-z][a-z0-9-]*$` by schema, and therefore needs no escaping or normalisation to become a
 * file name. The alternative — keying on the contract id — would need path-mapping for the
 * `tool-mode/` namespace and would collide when one contract has several implementations,
 * which is exactly what `implementations` is an ARRAY to allow.
 *
 * @module @try-works/tool-mode-extension-sdk/declarative-recipes
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/** The directory the convention looks in. */
export const RECIPE_DIRECTORY = 'recipes'

/** A resolved recipe, or the reason it could not be resolved. */
export type RecipeResolution =
  | { readonly ok: true; readonly recipe: unknown; readonly path: string; readonly digest: string }
  | { readonly ok: false; readonly reason: 'missing' | 'unreadable' | 'invalid-json'; readonly path: string; readonly detail: string }

/**
 * Resolve one implementation's recipe by the convention.
 *
 * @param packageDir - the installed package root.
 * @param implementationId - the manifest implementation id, which names the file.
 * @returns the parsed recipe, or an honest failure.
 */
export function resolveDeclarativeRecipe(
  packageDir: string,
  implementationId: string,
  declaredRecipe?: string,
): RecipeResolution {
  const convention = `${RECIPE_DIRECTORY}/${implementationId}.json`
  const relative = declaredRecipe ?? convention
  const root = resolve(packageDir)
  const path = resolve(root, relative)
  /**
   * A declared `recipe` is package-relative and MUST stay inside the package. The
   * 1.1 schema requires the `./` prefix; this check is the enforcement that keeps a
   * hand-written or future-version manifest from reading outside the installed tree.
   */
  if (!path.startsWith(`${root}${sep}`)) {
    return {
      ok: false,
      reason: 'missing',
      path,
      detail: `the declared recipe ${JSON.stringify(relative)} escapes the package directory`,
    }
  }

  /**
   * The id is re-checked HERE rather than trusted from the manifest when the
   * convention is used. The schema constrains it to `^[a-z][a-z0-9-]*$`, but this
   * function builds a PATH from it, and a path built from an unvalidated string is a
   * traversal. Re-checking costs nothing and means the resolver is safe even if a
   * caller passes an id from somewhere the schema never saw.
   */
  if (declaredRecipe === undefined && !/^[a-z][a-z0-9-]*$/.test(implementationId)) {
    return {
      ok: false,
      reason: 'missing',
      path,
      detail: `the implementation id ${JSON.stringify(implementationId)} is not a legal recipe name`,
    }
  }

  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return {
      ok: false,
      reason: 'missing',
      path,
      // The location is NAMED in the failure, because a package author who put the file
      // elsewhere can only fix it if they are told where it was looked for.
      detail: `no recipe at ${relative}: `
        + `${error instanceof Error ? error.message : String(error)}`,
    }
  }

  try {
    // DECL-08: the digest is computed from the INSTALLED bytes, never declared by the
    // package. A package cannot claim a recipe digest for bytes it did not ship.
    const digest = createHash('sha256').update(text, 'utf8').digest('hex')
    return { ok: true, recipe: JSON.parse(text), path, digest }
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-json',
      path,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Resolve every implementation a declarative manifest declares.
 *
 * All-or-nothing on purpose: a package that could satisfy HALF its declarations would be
 * activated in a state its manifest does not describe, and a caller would have no way to
 * learn which half. Refusing names what is missing instead.
 *
 * @param packageDir - the installed package root.
 * @param implementations - the manifest's declaration list.
 * @returns every resolved recipe, or the first failure.
 */
export function resolveDeclarativeImplementations(
  packageDir: string,
  implementations: readonly { readonly id: string; readonly contractId: string; readonly recipeVersion: string; readonly recipe?: string }[],
): { readonly ok: true; readonly resolved: readonly { readonly id: string; readonly contractId: string; readonly recipeVersion: string; readonly recipe: unknown; readonly path: string; readonly recipeDigest: string }[] }
  | { readonly ok: false; readonly id: string; readonly detail: string } {
  const resolved = []
  for (const implementation of implementations) {
    const outcome = resolveDeclarativeRecipe(packageDir, implementation.id, implementation.recipe)
    if (!outcome.ok) return { ok: false, id: implementation.id, detail: outcome.detail }
    resolved.push({
      id: implementation.id,
      contractId: implementation.contractId,
      recipeVersion: implementation.recipeVersion,
      recipe: outcome.recipe,
      path: outcome.path,
      recipeDigest: outcome.digest,
    })
  }
  return { ok: true, resolved }
}

/**
 * Whether an installed package is declarative, and what it declares.
 *
 * @param packageDir - the installed package root.
 * @returns the declared recipe names when the package is declarative, else undefined.
 */
export function declaredRecipeNames(packageDir: string): readonly string[] | undefined {
  try {
    const entries = readdirSync(join(packageDir, RECIPE_DIRECTORY))
    return entries.filter(name => name.endsWith('.json')).map(name => name.slice(0, -'.json'.length)).sort()
  } catch {
    // A package with no recipes directory is not declarative by this convention.
    return undefined
  }
}
