/**
 * `@try-works/tool-mode-runtime-dsh` — the runtime-to-SDK adapter (PLAN.md § runtime-dsh).
 *
 * The package is deliberately one module deep: a model package depends on this, on
 * `tool-mode-runtime-core` and on nothing else, so adding a model never touches the host.
 *
 * @module @try-works/tool-mode-runtime-dsh
 */

export { createRuntimeProvider, type ProviderSpec } from './provider.ts'
