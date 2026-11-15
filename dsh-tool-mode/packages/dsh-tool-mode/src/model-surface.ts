/**
 * The ONE model-tool-readiness state both discovery surfaces publish.
 *
 * `model_tools` lists the catalog and `tool_mode_list` lists the permitted tool surface.
 * They answer different questions about the SAME catalog row, so deriving readiness twice
 * let them disagree: one tool said a model was runnable while the other said its tool was
 * unavailable, and a model that merely was not installed read as impossible.
 *
 * The closed vocabulary:
 * - `callable`     — the catalog route resolves AND the model-facing tool is PUBLISHED now.
 * - `not-installed` — a Tool Mode extension implements the model, but that extension/model
 *                    is not installed here. Installing is the action that changes this.
 * - `unavailable`   — no route on this host can serve it (Apple-only, closed beta, no SDK),
 *                    or it IS installed and still cannot run: installing again would not help.
 *                    A model whose route resolves but whose tool is not published is ALSO
 *                    unavailable (task-49): "callable" must mean a caller can find the tool.
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
  /** The catalog model id, so a reason can name the model the caller must act on. */
  readonly id?: string | undefined
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
 * Why a model with a resolving route still is not callable (task-49).
 *
 * The two cases need DIFFERENT actions, so they get different sentences: an inactive or
 * unprepared extension is activated/prepared, while a model that was never enabled is
 * enabled. Saying "unavailable" with no action is what left the operator guessing.
 * @param entry - the catalog entry.
 * @param installed - whether a model record exists in this plugin instance.
 * @returns the actionable reason.
 */
function unpublishedReason(entry: ModelSurfaceEntry, installed: boolean): string {
  const label = entry.id === undefined ? 'this model' : `the ${entry.id} model`
  if (entry.provider !== undefined) {
    return installed
      ? `${label} is installed but its tool is not published: the extension is not active, or its assets are not prepared. Activate it and prepare its assets, then re-list.`
      : `${label} can run through ${entry.provider.extension}, but its tool is not enabled in this profile. Enable it with model_tools_manage (action "enable"), then re-list.`
  }
  return `${label} can run on this host, but its tool is not registered in this profile. Enable it with model_tools_manage (action "enable"), then re-list.`
}

/**
 * Derive the one readiness state for a catalog model.
 *
 * @param entry - the catalog entry (its provider binding decides whether installing helps)
 * @param verdict - the capability verdict for this host
 * @param installed - whether a model record exists in this plugin instance
 * @param toolPublished - whether the model-facing tool is REGISTERED right now (task-49)
 * @returns the shared state and the reason (null when callable)
 */
export function modelSurface(
  entry: ModelSurfaceEntry,
  verdict: ModelSurfaceVerdict,
  installed: boolean,
  toolPublished: boolean,
): ModelToolSurface {
  if (verdict.runnable && toolPublished) return { state: 'callable', reason: null }
  // The route resolves but nothing is published: a caller looking for this tool finds
  // nothing, so "callable" would be a promise the host cannot keep.
  if (verdict.runnable) return { state: 'unavailable', reason: unpublishedReason(entry, installed) }
  // Installing is the action that changes a provider-bound model: the extension exists in
  // the catalog as the implementation, it just is not installed here yet.
  if (entry.provider !== undefined && !installed) {
    return { state: 'not-installed', reason: verdict.reason }
  }
  return { state: 'unavailable', reason: verdict.reason }
}
