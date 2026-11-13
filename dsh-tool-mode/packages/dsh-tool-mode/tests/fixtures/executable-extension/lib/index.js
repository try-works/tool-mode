/**
 * The executable-preparation fixture's module entry.
 *
 * The approval-gate tests never invoke the tool; the file exists so the package is
 * a valid module extension and so an activation can publish a real entry.
 */

/**
 * Create the extension instance.
 * @returns an instance whose provider refuses: the fixture is not a model.
 */
export async function create() {
  return {
    async createProvider() {
      throw new Error('the executable fixture is not a model provider')
    },
  }
}
