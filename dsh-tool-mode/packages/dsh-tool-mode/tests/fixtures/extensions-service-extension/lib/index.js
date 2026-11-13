/**
 * The fixture extension's module entry.
 *
 * Activation never imports this file (the host publishes declarations from the
 * manifest), so this exists to make the package a valid module extension and to
 * prove that an installed copy can be loaded when a host does need provider code.
 */

/**
 * Create the extension instance.
 * @returns an instance whose provider refuses: the fixture is not a model.
 */
export async function create() {
  return {
    async createProvider() {
      throw new Error('the extension-service fixture is not a model provider')
    },
  }
}
