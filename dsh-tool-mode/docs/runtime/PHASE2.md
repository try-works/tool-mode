# Phase 2 — declarative model packages (model-runtime recipe)

Goal: a package with `execution.kind = "declarative"` and no entry registers a model tool from JSON
alone. The host stays free of model runtimes (AT-25): it resolves the provider factory from the
extension's own package directory.

## Recipe (new kind, package-relative `recipes/<implementation-id>.json`)

```json
{
  "kind": "model-runtime",
  "schemaVersion": 1,
  "provider": { "package": "@try-works/tool-mode-runtime-litert", "export": "createProviderFromRecipe", "accelerators": ["cpu"] },
  "model": { "assetSet": "shapes-litert", "fileName": "shapes.tflite", "format": "tflite" },
  "processor": { "id": "shapes/points-v1" },
  "limits": { "maxInputBytes": 4194304, "timeoutMs": 120000 },
  "tool": { "name": "shape_recognize", "description": "...", "inputSchema": "./schemas/shape.input.json", "outputSchema": "./schemas/shape.output.json" }
}
```

Rules: unknown keys are refused; `schemaVersion` must be 1; `provider.package`/`export` are non-empty;
`model.fileName` is a bare file name (no path separators); `processor.id` matches `^[a-z0-9]+(?:/[a-z0-9-]+)*$`;
limits are positive integers; tool.schema paths are package-relative `./...` and stay inside the package.

## Provider factory contract (exported by the engine package)

```ts
export function createProviderFromRecipe(
  recipe: ModelRuntimeRecipe,
  assets: { get(id: string): { path: string; digest: string } | undefined; assetIds: readonly string[] },
): ModelProviderV1
```

The factory returns the SDK's ModelProviderV1 (Promise-based). It owns engine loading and the
processor named by `processor.id`; the recipe supplies the artifact, limits and tool schemas.

## Host lane

`registerDeclarative` resolves the package's recipes (existing `resolveDeclarativeRecipe`). For a
recipe whose `kind` is `model-runtime`:
1. parse it with `parseModelRuntimeRecipe` from `@try-works/tool-mode-runtime-recipes`;
2. `import()` the provider factory from the extension package directory (`createRequire(package.json)`),
   so the host never declares an engine dependency;
3. register the tool named by the recipe using its schema files;
4. DSH readiness for that package must NOT require a harness LLM provider.
A recipe of kind `harness-model` (or absent) keeps the current path unchanged. Any failure is a
named refusal, never a silent no-op.

## Phase gate

- parser package: tsc + tests (unknown keys, path escape, bad limits, factory import failure).
- litert factory: tsc + tests with a fake asset set; real run when the shapes asset is present.
- host lane: an author-kit/integration test installs a code-free package and sees the tool registered;
  a declarative harness package still works; module packages unchanged.
- full `npm test`, `verify:architecture` (AT-25 must still pass) and `verify:manifests`.
## Phase 2 evidence (2026-11-14)

- `npm run verify:phase2` (`scripts/verify-phase2.ts`): a code-free package (`extension-shapes-recipe`, no
  entry) registers `shape_recognize` through the host lane and runs the REAL model — line → `line` 0.9505,
  rectangle → `rectangle` 0.9536; exit 0.
- `extension-shapes-recipe`: 27/27 tests; manifest + lock pinned to HF revision
  `ee004d08b3e5ed734fdf656277ead56c0225f9c0`, `shapes.tflite` 974,896 B,
  sha256 `8274742f…f6b9`, class order measured on the artifact.
- `tool-mode-runtime-recipes`: 50/50 tests (parser + provider-factory loader).
- Host lane: 22/22 lane tests + 55/55 targeted host suites; `verify:architecture` (AT-25/ARCH-02) and
  `verify:manifests` green. The host owns a structural parser that mirrors the package parser; the two
  were compared on 6/6 cases with identical verdicts (owner-reported parity).
- Full suite must be green after the inventory lists (redact + shapes) and generated artifacts are
  regenerated; see `docs/runtime/VERIFICATION.md` snapshot 6 for the gate table.
- Release gate: `scripts/check-release-drift.mjs` now recognises `kind: "model-runtime"` recipes (schemaVersion 1,
  no recipe version) instead of reporting them as harness-recipe drift; `release-drift.test.ts` 2/2.
- Final full suite: **3065 tests, 3047 pass, 0 fail, 18 skipped** (exit 0). `verify:architecture`, `verify:manifests`
  and README coverage all green.
