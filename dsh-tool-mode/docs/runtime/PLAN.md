# Runtime layer — implementation plan and interface contract

Status: approved 2026-11-14. This file is the shared contract for the build; the design rationale is
`D:/DEV/dsh-model-as-tool/docs/runtime-stack-plan.md`. Decisions in force: local only now, hosted
control plane later; no Bun/Tardigrade; `redact` first; no cloud MCP endpoint.

## Non-negotiables

- TDD: every module lands with tests that would fail without it. No test, no merge.
- Verify after every phase: `npm run typecheck`, the phase's test command, and the phase gate below.
- Effect 4.1.2 only, ESM, Node 24. One hoisted copy.
- No Alchemy, no Domain, no Tardigrade in the local path. Domain is a future `DeploymentStore`.
- The host (`packages/dsh-tool-mode`) gains no model-specific code.
- No listening sockets in the LiteRT path: the loader uses `litert://` fetch interception (proven).

## Packages (all under `packages/`, same layout as existing packages)

| Package | Purpose |
| --- | --- |
| `tool-mode-runtime-core` | contracts, errors, readiness, ports + local implementations |
| `tool-mode-runtime-litert` | Effect service over `@litertjs/core` (managed child only) |
| `tool-mode-runtime-processors` | WordPiece tokenizer, windows, BIOES decode, deterministic PII |
| `tool-mode-runtime-dsh` | `createRuntimeProvider(spec): ModelProviderV1` bridge |
| `extension-redact` | redact model package: manifest, lock, pipeline, provider |

Each package: `package.json` (name `@try-works/<dir>`, type module, exports ./lib/index.js, types),
`tsconfig.json` (noEmit) and `tsconfig.build.json` (outDir lib) copied from an existing package
(e.g. `packages/tool-mode-recipes`), `src/`, `tests/*.test.ts` (node:test via tsx).

## runtime-core interfaces (exact)

```ts
// contracts.ts — all exported schemas double as the runtime's validation boundary.
export const ModelFormat = Schema.Literals(["onnx", "tflite", "gguf"])
export const ModelRef = Schema.Struct({ id: Schema.NonEmptyString, version: Schema.NonEmptyString, digest: Schema.String })
export const RuntimeInput = Schema.Struct({
  text: Schema.optional(Schema.String),
  audioPath: Schema.optional(Schema.String),
  imagePath: Schema.optional(Schema.String),
})
export const Limits = Schema.Struct({ maxInputBytes: Schema.Int, timeoutMs: Schema.Int })
export const RuntimeRequest = Schema.Struct({ model: ModelRef, input: RuntimeInput, limits: Limits })
export const Span = Schema.Struct({ start: Schema.Int, end: Schema.Int, label: Schema.NonEmptyString, text: Schema.String, score: Schema.Number })
export const Coverage = Schema.Struct({ complete: Schema.Boolean, processedUnits: Schema.Int, totalUnits: Schema.Int, reason: Schema.optional(Schema.String) })
export const RuntimeResult = Schema.Struct({ spans: Schema.Array(Span), coverage: Coverage })
export type RuntimeResult = Schema.Schema.Type<typeof RuntimeResult>

// errors.ts
export class InvalidInput extends Schema.TaggedError<InvalidInput>()("InvalidInput", { field: Schema.String, message: Schema.String }) {}
export class RuntimeUnavailable extends Schema.TaggedError<RuntimeUnavailable>()("RuntimeUnavailable", { provider: Schema.String, reason: Schema.String }) {}
export class InferenceFailed extends Schema.TaggedError<InferenceFailed>()("InferenceFailed", { provider: Schema.String, phase: Schema.Literals(["load", "run", "post"]), message: Schema.String }) {}
export class PortFailure extends Schema.TaggedError<PortFailure>()("PortFailure", { port: Schema.String, message: Schema.String }) {}

// readiness.ts
export type Readiness = "prepared-cold" | "ready" | "failed" | "needs-preparation"
export const Inspection = Schema.Struct({
  readiness: Schema.Literals(["prepared-cold", "ready", "failed", "needs-preparation"]),
  features: Schema.Array(Schema.String),
  missing: Schema.Array(Schema.Struct({ name: Schema.String, reason: Schema.String })),
  reason: Schema.optional(Schema.String),
})

// provider.ts
export interface RuntimeProviderShape {
  readonly id: string
  readonly formats: readonly ModelFormat[]
  readonly inspect: Effect.Effect<Inspection>
  readonly load: (assets: PreparedAssets) => Effect.Effect<void, RuntimeUnavailable>
  readonly invoke: (request: RuntimeRequest) => Effect.Effect<RuntimeResult, InvalidInput | InferenceFailed>
  readonly unload: Effect.Effect<void>
}
export class RuntimeProvider extends Context.Service<RuntimeProvider, RuntimeProviderShape>()("tool-mode-runtime/Provider") {}
export interface PreparedAssets {
  readonly get: (assetId: string) => { readonly path: string; readonly digest: string } | undefined
  readonly assetIds: readonly string[]
}

// ports.ts — future hosted control plane seams; local implementations in this package.
export interface CatalogEntry {
  readonly id: string; readonly version: string; readonly digest: string
  readonly format: ModelFormat
  readonly artifact: { readonly assetSet: string; readonly fileName: string; readonly sha256: string; readonly bytes: number }
  readonly processor: { readonly id: string; readonly version: string }
  readonly accelerators: readonly ("cpu" | "dml" | "webgpu")[]
  readonly limits: { readonly maxInputBytes: number; readonly timeoutMs: number }
}
export class CatalogSource extends Context.Service<CatalogSource, {
  readonly get: (id: string) => Effect.Effect<CatalogEntry, PortFailure>
  readonly list: Effect.Effect<readonly CatalogEntry[]>
}>()("tool-mode-runtime/CatalogSource") {}
export type DeploymentEventType = "requested" | "prepared" | "activated" | "failed" | "deactivated"
export interface DeploymentEvent { readonly type: DeploymentEventType; readonly at: string; readonly modelId: string; readonly detail?: Record<string, unknown> }
export class DeploymentStore extends Context.Service<DeploymentStore, {
  readonly append: (event: DeploymentEvent) => Effect.Effect<void, PortFailure>
  readonly events: (modelId: string) => Effect.Effect<readonly DeploymentEvent[], PortFailure>
}>()("tool-mode-runtime/DeploymentStore") {}
export class EntitlementService extends Context.Service<EntitlementService, {
  readonly check: (modelId: string) => Effect.Effect<"allowed" | "denied", PortFailure>
}>()("tool-mode-runtime/EntitlementService") {}
export class TelemetrySink extends Context.Service<TelemetrySink, {
  readonly record: (event: Record<string, unknown>) => Effect.Effect<void>
}>()("tool-mode-runtime/TelemetrySink") {}
```

Local layers (no hosted dependency): `CatalogSource.fromEntries` / `CatalogSource.fromJsonFile`,
`DeploymentStore.fromMemory` / `DeploymentStore.fromJsonFile`, `EntitlementService.allowAll`,
`TelemetrySink.noop`.

## runtime-dsh interface (exact)

```ts
export interface ProviderSpec {
  readonly modelId: string
  readonly providerId: string
  /** Built per deployment from the host-verified assets. Must have NO remaining requirements. */
  readonly layer: (assets: Readonly<PreparedAssetMapV1>) => Layer.Layer<RuntimeProvider, RuntimeUnavailable, never>
  /** Maps the tool's JSON input onto a validated RuntimeRequest. */
  readonly request: (input: Readonly<JsonObject>) => Effect.Effect<RuntimeRequest, InvalidInput>
}
export function createRuntimeProvider(spec: ProviderSpec): ModelProviderV1
```

Adapter rules (spike-verified): `ManagedRuntime.make` is lazy, so `load()` must construct it and
force construction with `await candidate.runPromise(Effect.void)` inside try/catch; a failure sets
`readiness: "failed"` with the reason and throws from `load()`. `invoke()` runs
`runtime.runPromise` and encodes `RuntimeResult` with `Schema.encodeEffect`. `unload/dispose`
dispose and are idempotent. Forward the SDK `AbortSignal` into `runPromise(..., { signal })`.

## runtime-litert interface (exact)

```ts
export interface LitertFeed { readonly data: Float32Array | Int32Array; readonly dims: readonly number[] }
export class LitertSession extends Context.Service<LitertSession, {
  readonly inputNames: readonly string[]
  readonly run: (feeds: Readonly<Record<string, LitertFeed>>) => Effect.Effect<Readonly<Record<string, Float32Array>>, InferenceFailed>
}>()("tool-mode-runtime/LitertSession") {}
export const litertLayer = (options: {
  readonly wasmDir: string; readonly modelBytes: Uint8Array; readonly threads?: number
}): Layer.Layer<LitertSession, RuntimeUnavailable>
```

Shim rules (proven 2026-11-14): install `self/document/module/exports/require/__dirname` globals and
a `fetch` interceptor mapping `litert://wasm/<file>` to `path.join(wasmDir, file)` (Response with
application/wasm for .wasm, text/javascript for .js); set `__dirname = wasmDir`; call
`loadLiteRt("litert://wasm/", { jspi: false })`. No HTTP server, no copied wasm. Serialize all
`run` calls with `Semaphore.make(1)` (the C engine keeps module-global state). Refuse a second
`loadLiteRt` in the same process.

## runtime-processors interface (exact)

Redact's tokenizer.json is `model.type = "Unigram"` (SentencePiece: Precompiled normalizer,
WhitespaceSplit then Metaspace, vocab is [piece, score] pairs, unk_id 3, no byte fallback). Do NOT
reimplement it. `extension-redact` uses `tokenizers@0.23.2` (HF Node binding; the tarball carries
native binaries for win32/linux/darwin x64+arm64), verified against the pinned assets to produce
exact ids and offsets.

Two facts that bite:
- tokenizers offsets are Unicode CODE POINT offsets, not UTF-16 indices. Every offset must be
  converted with `utf16Offsets` before slicing a JS string (astral chars shift the indices).
- encode includes the [CLS]/[SEP] post-processor; windows re-wrap each window. Padding to 256 is
  the caller's job (the PLAN signature has no pad id).

```ts
export function utf16Offsets(offsets: readonly { start: number; end: number }[], text: string): readonly { start: number; end: number }[]
export function windows(ids: readonly number[], mask: readonly number[], options: { maxLength: number; stride: number }): readonly { ids: number[]; mask: number[]; startToken: number }[]
export function decodeBioes(logits: Float32Array, geometry: { tokens: number; labels: number }, labels: readonly string[], offsets: readonly { start: number; end: number }[], minScore: number): readonly { start: number; end: number; label: string; score: number }[]
export function mergeSpans(spans: readonly { start: number; end: number; label: string; score: number }[]): readonly { start: number; end: number; label: string; score: number }[]
export function deterministicPii(text: string): readonly { start: number; end: number; label: string; text: string; score: number }[]
```

Redact constants: 256-token windows, stride 64, min score 0.6, cap 4 windows / 1,024 tokens,
`coverage` honest when truncated. **The label table is the model's, not the processors':**
`labels.json` id2label is 89 BIOES entries (O + 22 entities: the 20 public labels, ORG, IMEI).
ORG is disabled by default; IMEI has a model head but is deterministic-only in the shipped policy.
`extension-redact` reads labels.json directly and filters those two from model output; the generic
processors package deliberately owns no label list (the earlier 21-label export was wrong and is
removed). LiteRT.js probes WebGPU at load and logs a harmless "no WebGPU device" error before
selecting CPU/XNNPACK and opening no socket.

## Phase gates

| Phase | Gate |
| --- | --- |
| 0 | core + dsh: build each package (`tsc -p tsconfig.build.json`) then typecheck and test; ports have local layers. Cross-package imports resolve to `lib/index.js` (repo convention), so a dependent package is only testable after its dependency is built. |
| 1 | LiteRT + processors + adapter tests green; redact real inference against prepared assets with span-level golden output; no socket opened |
| 2 | declarative `model-runtime` recipe registers a model from JSON alone; install/verify/rollback unchanged |
| 3 | ONNX provider + `uhm`/`clear` real inference |
| 4 | remaining models each have qualification + skill |

Redact assets are NOT committed. `scripts/fetch-redact-assets.mjs` downloads the pinned HF revision,
verifies sha256, and writes `.assets/redact/` (gitignored). The real test skips with a reason when
assets are absent; the phase gate runs it once with assets present.
