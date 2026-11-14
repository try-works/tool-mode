# @try-works/tool-mode-runtime-dsh

The runtime-to-SDK adapter: it exposes an Effect-based `RuntimeProvider` as the tool-mode
extension SDK's Promise-based `ModelProviderV1`, so a model package can be written in Effect
while the host keeps seeing Promises and plain JSON.

```ts
import { createRuntimeProvider } from '@try-works/tool-mode-runtime-dsh'

const provider = createRuntimeProvider({
  modelId: 'redact',
  providerId: 'litert',
  layer: (assets) => litertLayer({ wasmDir: assets.get('wasm')!.path, modelBytes }),
  request: (input) => Effect.succeed(runtimeRequestFor(input)),
})
```

Three behaviours are load-bearing and each has a test:

1. **`load()` forces the lazy runtime.** `ManagedRuntime.make` builds nothing until an effect
   runs, so a broken layer would look loaded until the first call. `load()` runs
   `Effect.void` through it, then runs the provider's own `load(assets)`, and reports
   `readiness: "failed"` with a reason when either step fails.
2. **`invoke()` re-encodes the result through `Schema.encodeEffect`**, so a malformed
   `RuntimeResult` is rejected at the boundary instead of reaching the host.
3. **`unload`/`dispose` are idempotent and close the layer scope**, releasing ONNX/WASM memory.

The caller's `AbortSignal` is checked up front and forwarded into every `runPromise`.

## Testing

```
npm run typecheck   # tsc --noEmit
npm test            # tsx --test tests/*.test.ts
```

The package imports `@try-works/tool-mode-runtime-core` and `@try-works/tool-mode-extension-sdk`
by package name, so those packages must be built (`lib/`) and linked before the tests run —
the workspace link is created by `scripts/link-dsh.mjs`.
