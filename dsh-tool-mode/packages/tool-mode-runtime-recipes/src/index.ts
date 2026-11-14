/**
 * The declarative model-runtime recipe package (Phase 2).
 *
 * Two functions, deliberately separate:
 *
 * - {@link parseModelRuntimeRecipe} validates a code-free package's JSON — the entire
 *   behaviour a `model-runtime` package is allowed to declare.
 * - {@link loadProviderFactory} resolves the engine package's factory from the extension
 *   directory, so the host never declares an engine dependency (AT-25).
 *
 * The split matters: a caller may validate a recipe without loading anything (a dry run,
 * an install-time check), and the loader only ever receives a recipe that already parsed.
 *
 * @module @try-works/tool-mode-runtime-recipes
 */

export * from './model-runtime-recipe.ts'
export * from './provider-factory.ts'
