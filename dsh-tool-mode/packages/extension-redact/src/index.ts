/**
 * The redact extension entry point.
 *
 * The module default-exports the extension contract and, on activation, hands the SDK a
 * ModelProviderV1 produced by the generic runtime adapter. No host internals are imported:
 * the package depends only on the SDK and the runtime layer.
 *
 * @module @try-works/extension-redact
 */

import {
  defineExtension,
  type ExtensionContextV1,
  type ExtensionInstanceV1,
} from '@try-works/tool-mode-extension-sdk'
import { createRuntimeProvider } from '@try-works/tool-mode-runtime-dsh'

import { redactLayer, redactRequest } from './provider.ts'

/** The provider id reported for this deployment. */
const PROVIDER_ID = 'litert'
/** The one model this extension implements. */
const MODEL_ID = 'redact'

export default defineExtension({
  apiVersion: 1,
  async create(context: ExtensionContextV1): Promise<ExtensionInstanceV1> {
    return {
      async createProvider({ modelId }) {
        if (modelId !== MODEL_ID) {
          throw new Error('this extension implements the "' + MODEL_ID + '" model, not "' + modelId + '"')
        }
        const provider = createRuntimeProvider({
          modelId: MODEL_ID,
          providerId: PROVIDER_ID,
          layer: redactLayer,
          request: redactRequest,
        })
        context.logger.log('debug', 'redact provider created')
        return provider
      },
      async dispose(reason) {
        context.logger.log('debug', 'redact extension disposed: ' + reason)
      },
    }
  },
})
