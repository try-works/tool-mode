/**
 * TEMPORARY ENGINE BINDING for the model-runtime fixture.
 *
 * This file is what `recipe.provider.package` names. It is resolved FROM THIS PACKAGE
 * DIRECTORY, never from the host's module graph — that indirection is the point of the
 * recipe: the host declares no runtime, and the engine lives beside the package that
 * ships it.
 *
 * The provider is deterministic: no model runs. It proves the factory contract
 * (`ModelProviderV1`) is honoured and that the host drives load/invoke from JSON alone.
 */

/** The payload the host must see for the fixture input. */
const ANSWER = { shapes: ['circle'], score: 0.91 }

export function createProviderFromRecipe(recipe, assets) {
  const calls = { loads: 0, invokes: 0, disposes: 0 }
  return {
    async inspect() {
      return { readiness: 'prepared-cold', features: ['shapes'], missing: [] }
    },
    async load() {
      calls.loads += 1
      // The recipe's asset set is what the factory resolves the artifact from; a package
      // whose asset set was never prepared must say so rather than pretend it loaded.
      const artifact = assets.get(recipe.model.assetSet)
      if (artifact === undefined) {
        throw new Error(`the "${recipe.model.assetSet}" asset set was not prepared`)
      }
    },
    async invoke({ implementationId, input }) {
      calls.invokes += 1
      if (implementationId !== 'shapes') throw new Error(`unknown implementation ${implementationId}`)
      if (typeof input.text !== 'string') throw new Error('the factory requires a string "text"')
      return { ...ANSWER, score: input.shape === 'square' ? 0.5 : ANSWER.score }
    },
    async unload() {},
    async dispose() {
      calls.disposes += 1
    },
    /** Not part of ModelProviderV1; the test reads it through a well-known symbol. */
    [Symbol.for('fixture.calls')]: calls,
  }
}
