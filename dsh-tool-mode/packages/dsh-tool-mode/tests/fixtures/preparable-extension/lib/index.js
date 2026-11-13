/**
 * The preparation fixture's module entry.
 *
 * The preparation tests never invoke the tool; the file exists so the package is
 * a valid module extension and so an activation that publishes the tool can point
 * at a real entry.
 */

/**
 * Create the extension instance.
 * @returns an instance whose provider refuses: the fixture is not a model.
 */
export async function create() {
  return {
    async createProvider() {
      throw new Error('the preparation fixture is not a model provider')
    },
  }
}
