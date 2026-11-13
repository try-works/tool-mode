/**
 * The deterministic Tongue stand-in used by the model-management tests.
 *
 * It implements the SAME provider contract as the real extension
 * (`text.language_detect` / `tool-mode/lang_detect`, model id `tongue`) with no
 * weights, no network and no native runtime, and returns a fixed language payload
 * so an enable → call → disable sequence is reproducible anywhere.
 *
 * CONTRACT: the store loader accepts a DEFAULT export carrying `apiVersion` and
 * `create(context)` (see tool-mode-extension-sdk `loadExtensionModule`). A named
 * `create` export is not enough, and a missing `apiVersion` is refused — when that
 * happened the bridge caught the activation error, reported readiness `failed`, and
 * the catalogue enable correctly refused, which is exactly the symptom this fixture
 * exists to avoid.
 *
 * The fixture is installed INACTIVE by the test helper. That is deliberate: it must
 * prove the host's catalogue enable path, not pre-empt it by having an active
 * extension own the tool name.
 */

export default {
  apiVersion: 1,

  /**
   * Create the extension instance.
   * @returns the instance whose provider serves the language-detection contract.
   */
  async create() {
    return {
      /**
       * Create the provider for the fixture's only model.
       * @param {{ modelId: string }} request - the model the host is asking for.
       * @returns the provider.
       */
      async createProvider({ modelId }) {
        if (modelId !== 'tongue') {
          throw new Error(`the tongue fixture implements the "tongue" model, not "${modelId}"`)
        }
        return {
          /**
           * Report readiness without loading or inferring.
           * @returns prepared-cold, which is callable.
           */
          async inspect() {
            return { readiness: 'prepared-cold', features: ['language-detection'], missing: [] }
          },
          /** Nothing to load: the fixture has no assets. */
          async load() {},
          /**
           * Return the declared contract payload.
           * @param {{ input: Record<string, unknown>, context?: { signal?: AbortSignal } }} request - the invocation.
           * @returns the domain payload (the host adds the reserved meta).
           */
          async invoke({ input, context }) {
            context?.signal?.throwIfAborted?.()
            const text = input?.text
            if (typeof text !== 'string' || text.length === 0) {
              throw new Error('argument "text" must be a non-empty string')
            }
            // Deterministic and inspectable: the legacy transport test sends this
            // German sentence and requires "de"; anything else is reported as "en".
            const language = /kann ich das haben/i.test(text) ? 'de' : 'en'
            return {
              language,
              reliability: 'confident',
              tooCloseToCall: false,
              candidates: [{ language, probability: 0.99 }],
            }
          },
          /** Drop nothing: there is no loaded state. */
          async unload() {},
          /** Release nothing: the fixture holds no resource. */
          async dispose() {},
        }
      },
      /** Release the extension instance. */
      async dispose() {},
    }
  },
}
