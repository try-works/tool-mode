/**
 * The ONE model-tool-readiness state both discovery surfaces publish.
 *
 * `model_tools` lists the catalog and `tool_mode_list` lists the permitted tool surface.
 * They answer different questions about the SAME catalog row, so deriving readiness twice
 * let them disagree: one tool said a model was runnable while the other said its tool was
 * unavailable, and a model that merely was not installed read as impossible.
 *
 * The closed vocabulary:
 * - `callable`     — the catalog route resolves on this host; the model can run now.
 * - `not-installed` — a Tool Mode extension implements the model, but that extension/model
 *                    is not installed here. Installing is the action that changes this.
 * - `unavailable`   — no route on this host can serve it (Apple-only, closed beta, no SDK),
 *                    or it IS installed and still cannot run: installing again would not help.
 *
 * @module model-surface
 */

/** The closed model-tool-readiness vocabulary. */
export const MODEL_TOOL_STATES = ['callable', 'not-installed', 'unavailable'] as const

/** One model-tool-readiness state. */
export type ModelToolState = (typeof MODEL_TOOL_STATES)[number]

/** What both discovery surfaces publish for one catalog model. */
export interface ModelToolSurface {
  readonly state: ModelToolState
  /** The verdict's own explanation, or null when the model is callable. */
  readonly reason: string | null
}

/** The catalog facts this derivation needs. */
export interface ModelSurfaceEntry {
  /** The Tool Mode extension and model id that implement the model, when one does. */
  readonly provider?: { readonly extension: string; readonly modelId: string } | undefined
}

/** The capability facts this derivation needs. */
export interface ModelSurfaceVerdict {
  readonly runnable: boolean
  /** Why the model is not runnable; carried verbatim so no second wording drifts. */
  readonly reason: string
}

/**
 * Derive the one readiness state for a catalog model.
 *
 * @param entry - the catalog entry (its provider binding decides whether installing helps)
 * @param verdict - the capability verdict for this host
 * @param installed - whether the model's tool is installed in this plugin instance
 * @returns the shared state and the verdict reason (null when callable)
 */
export function modelSurface(
  entry: ModelSurfaceEntry,
  verdict: ModelSurfaceVerdict,
  installed: boolean,
): ModelToolSurface {
  if (verdict.runnable) return { state: 'callable', reason: null }
  // Installing is the action that changes a provider-bound model: the extension exists in
  // the catalog as the implementation, it just is not installed here yet.
  if (entry.provider !== undefined && !installed) {
    return { state: 'not-installed', reason: verdict.reason }
  }
  return { state: 'unavailable', reason: verdict.reason }
}
