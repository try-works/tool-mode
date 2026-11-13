# Tool Mode author kit

Everything an author needs to build, test and pack a Tool Mode extension without
editing Tool Mode, DSH or a provider adapter.

## What is in the kit

| Piece | Where |
|---|---|
| Published SDK (manifest validation, JSON Schema types, lifecycle, conformance helpers) | `@try-works/tool-mode-extension-sdk` |
| Model-free standard tool descriptors | `@try-works/tool-mode-contracts` (`STANDARD_CONTRACTS`) |
| Manifest schema | `schemas/extension-manifest.schema.json` |
| Recipe schema | `schemas/harness-model-recipe.schema.json` |
| Module template | `templates/module/` |
| Declarative recipe template | `templates/declarative/` |
| Reference test host + scripted fake harness broker | `test-host.mjs` |

## Build and pack

A module package ships built ESM. Set `exports["./tool-mode"]` to the entry and
`toolMode.manifest` to the manifest. A declarative package ships NO code: only the
manifest and recipe files, and `execution: { "kind": "declarative" }`.

`npm pack` produces the tarball the host installs. The host does not run package
lifecycle scripts.

## Publication and distribution

Publishing to npm is an AUTHOR/OPERATOR action outside the agent's ordinary
permissions. The same tarball can instead be served over HTTPS as an npm-format
`.tgz`; noninteractive URL installs require a pinned integrity fragment
(`...tgz#sha512-<base64>`). The publisher's repository `package-lock.json` is NOT
automatically a consumer lock: the host records its own resolved dependency graph,
and an author who needs to constrain transitive dependencies should publish a
supported lock/bundling strategy rather than relying on the repository lock.

## Verified model assets

Declare `models[].assetLock` pointing at a real lock file with exact revisions,
sizes and digests. Preparation downloads/verifies bytes; `load()` receives only
verified local paths. Never download weights at module import or `create()`.

## Windows qualification

Run the package on Windows x64 CPU (the reference host's platform), install from
the packed tarball (not a source junction), and confirm inference. Native
prerequisites must go through preparation/approval; do not require WSL, Docker, a
compiler or a discrete GPU.

## Cancellation and disposal

`load()`/`invoke()` receive an `AbortSignal`; observe it. Dispose native/model
resources in `dispose()` and make it idempotent. A host may unload only idle
resources, so do not hold deployment-wide state outside the provider.

## Typed results, skills and licensing

Tools declare input/output JSON Schemas. Results are validated by the host.
Skills are manifest entries with packaged files. Declare code/engine/weights/
conversion/SDK licenses independently; packaged weights do not imply redistribution
rights, and telemetry-bearing software must not be described as network-free.

## Version migration

Manifest 1.0 records are read as module execution without rewriting installed
bytes. Breaking schema changes require a reviewed migration; the host keeps the
last working version and never silently adopts incompatible semantics.

## Testing

```js
import { createAuthorTestHost, createScriptedHarnessBroker } from './test-host.mjs'

const host = await createAuthorTestHost({ entryPath: '/abs/path/to/templates/module/index.mjs' })
const provider = await host.instance.createProvider({ modelId: 'demo', configuration: {} })
await provider.dispose?.()
await host.dispose()

const { broker, provider: fake, journal } = createScriptedHarnessBroker()
broker.authorize('text_title', fake)
// broker.run(recipe, args) — the scripted completion is a fixture, never a model claim
```

The scripted broker proves request shape and failure behavior. It does not prove
model quality.
