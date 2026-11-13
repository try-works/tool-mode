/**
 * Module template (EXT-36).
 *
 * Import and create() do NOTHING expensive: no download, model load, socket or
 * background loop. The host calls load() with verified local assets.
 */
export default {
  apiVersion: 1,
  create(context) {
    let disposed = false

    return {
      async createProvider({ modelId }) {
        return {
          id: `template:${modelId}`,
          async inspect() {
            return { readiness: 'prepared-cold', features: [], missing: [] }
          },
          async load({ signal }) {
            if (signal.aborted) throw new Error('the load was aborted')
          },
          async invoke({ input }) {
            if (disposed) throw new Error('the provider was disposed')
            return { echo: input }
          },
          async unload() {
            // Release only this deployment's resources.
          },
          async dispose() {
            disposed = true
          },
        }
      },
      async dispose() {
        disposed = true
        void context
      },
    }
  },
}
