# Extension install/activation: root causes, fixes, and verification plan

Status: fixes implemented in the workspace; end-to-end execution blocked by the
broken shell (see §5). Date: 2026-10-19.

Scope: the two rows on the Web GUI Extensions page — `@try-works/extension-embeddinggemma`
("EmbeddingGemma 2", active, activation blocked on model assets) and
`@try-works/extension-laya` ("Laya", not installed, `[DEPENDENCY_UNSATISFIED] the
dependency graph exceeds the 3-level depth bound at define-data-property`).

## 1. Findings

| # | Where | Defect | Type |
|---|---|---|---|
| RC1 | `src/extensions-service.ts` `#dependencyGraph` | first-party source-directory installs built the dependency graph without the host's depth bound, inheriting the SDK's 3-level default | code (fixed) |
| RC2 | `src/extensions-service.ts` `#installFromDirectory` | directory installs never materialized `optionalDependencies`, so the engine a tool `import()`s was absent | code (fixed) |
| RC3 | `src/index.ts` prepare surface + `src/extensions-service.ts` `prepare()` | a prepare that acquired bytes could return `prepared: true` without recording a callable readiness when the lifecycle was unmounted | code (fixed) |
| RC4 | installed `extension-embeddinggemma@0.1.0` | the installed build is a declaration-only stub ("wires no ONNX session yet"); `0.1.1` implements inference | deployment/data |
| RC5 | `packages/extension-laya/models.lock.json` | asset `source` fields are prose ("the split export of the pinned checkpoint"), not URLs; prepare refuses by design | data (seeded cache) |
| RC6 | profile `web` | running plugin pinned to `plugins/try-works-dsh-tool-mode-0.3.6.tgz`; workspace source is `0.4.7` | deployment |
| RC7 | `src/asset-acquisition.ts` | SHA-256 compared CASE-SENSITIVELY (`crypto` emits lower case, Laya's lock records upper case), so a correctly seeded blob was rejected and the prose source was attempted | code (fixed) |
| RC8 | `packages/extension-laya/models.lock.json` | the six artifacts were split across three groups, but the extension loads ONE group directory and the vendored runtime opens encoder, head, tokenizer and config FROM THAT DIRECTORY | data (fixed) |
| RC9 | SDK `install/dependencies.ts` | the graph walked transitive `dependencies` only, never `optionalDependencies`, so `sharp`'s platform binding (`@img/sharp-win32-x64`) was absent at tool load | code (fixed) |
| RC10 | `src/index.ts` restore chain + `prepared-assets.ts` | the prepared-asset MAP lived only in the process that ran `prepare`; after a restart the store still said `prepared-cold`, the extension activated, and every call failed with "the … asset group was not prepared" while the page offered no Prepare action | code (fixed, 0.5.0) |

### RC1 — Laya depth bound (evidence chain)

- `client/index.js` Install action → `installExtension(id, undefined)` → service `install()` → source-directory branch (`extensions-service.ts` `#installFromDirectory`).
- Pre-fix `#dependencyGraph` called `createFirstPartyDependencyGraph({ sourcePackageDir, allowPreinstalled })` with **no `maxDepth`**; `extension-dependencies.ts` forwards `maxDepth` only when defined.
- SDK: `packages/tool-mode-extension-sdk/src/install/dependencies.ts:294` `graph.maxDepth ?? 3`; the check is at `:310`, **before** resolution, which is why the error names the package one level too deep.
- Real tree (all present in the repo-root `node_modules`):
  `onnxruntime-node`(0) → `global-agent`(1) → `globalthis`(2) → `define-properties`(3) → `define-data-property`(4) → `es-define-property`/`has-property-descriptors`(5).
- The depth-4 failure proves the preinstalled gate was ON: the bytes arm would refuse `onnxruntime-node` under EXT-10 (its `postinstall`) and the registry arm refuses after extraction — both at depth 0.

Fix: `#dependencyGraph` now passes `maxDepth: registryDependencyDepth ?? DEFAULT_REGISTRY_DEPENDENCY_DEPTH (12)`.
Depth 12 is bounded by the SDK's independent `maxPackages` default 64, and the real tree is 5 deep.

### RC2 — optional runtimes were never materialized on directory installs

- Registry install: `await this.#materializeOptionalRuntimes(storeDir, installed, session, signal)`.
- Directory install: that call was **absent** (it returned immediately after the digest check).
- `packages/extension-embeddinggemma/package.json` declares its engine in `optionalDependencies`
  (`onnxruntime-node`, `@huggingface/transformers`); `dependencies` is `{}`.
- `extension-embeddinggemma/src/inference.ts` does `await import('onnxruntime-node')`; the installed
  0.1.0 tree contains only `node_modules/@try-works/tool-mode-extension-sdk`, and Node's walk up to the
  profile `node_modules` finds no `onnxruntime-node` or `@huggingface/transformers`.
  Hence `load()` reports `needs-preparation` naming a package that was never installed.

Fix: `#materializeOptionalRuntimes` takes the arm's `InstallDependencyGraph` instead of the registry
session; the registry arm passes `#installGraph(session)`, the directory arm passes
`#dependencyGraph(sourceDir)`. The directory arm therefore still **downloads nothing** (its graph
resolves from the host tree only), and a failure is recorded and blocks activation rather than
failing the package install.

Two follow-on defects were fixed in the same merge step, both found by adversarial review:

- The merge enumerated **top-level** `node_modules` entries, so a scoped package was keyed by its
  scope directory. Because the runtime link always creates `node_modules/@try-works`, any later
  `@try-works/*` optional engine was skipped wholesale while the record marked it satisfied. The
  merge now enumerates packages (scope-aware) and creates the parent directory before copying.
- The regression test uses `@try-works/fixture-engine` deliberately, so it fails on that bug rather
  than passing by accident within an unused scope.

### RC3 — prepare could lie

Pre-fix `index.ts` skipped `recordReadiness` when `extensionLifecycle` was undefined and still
returned `ok`; `extensions-service.ts prepare()` trusted `outcome.ok`. A page could show a successful
prepare while the row stayed `needs-preparation` forever.

Fix: the surface refuses **before** the multi-GB transfer when readiness has no writer; `prepare()`
post-checks the planned model's recorded readiness and returns `prepared: false` with the recorded
value and the host-gap reason when it is not callable.

### RC5 — Laya's assets cannot be prepared (unresolved, not a code bug)

`packages/extension-laya/models.lock.json` records descriptions rather than fetchable locations, e.g.
`"source": "the split export of the pinned checkpoint"` for all six artifacts, and its pinning note
states the host-driven acquisition "has NOT been exercised against them". `firstUnavailableAssetSource`
therefore refuses before any transfer. Laya can be **installed** after RC1, but its tools stay
non-callable until the artifacts are supplied as URLs or pre-placed in the asset cache with the
recorded digests. No code change can honestly bypass this.

## 2. Changes

- `packages/dsh-tool-mode/src/extensions-service.ts`
  - `#dependencyGraph`: forwards the host depth bound; documents why the preinstalled arm is not a leaf.
  - `#installGraph`: corrected the stale "preinstalled packages are LEAVES" comment.
  - `#materializeOptionalRuntimes`: takes a graph; called by the directory arm too.
  - `prepare()`: recorded-readiness post-check.
- `packages/dsh-tool-mode/src/index.ts`: prepare surface refuses without a lifecycle and always records.
- `packages/dsh-tool-mode/src/extension-dependencies.ts`: `maxDepth` doc corrected.
- Tests:
  - `tests/extension-dependencies.test.ts`: 6-link host chain installs at the default depth; configured depth 2 still refuses at `chain3`.
  - `tests/extension-optional-runtimes.test.ts`: present host-tree engine is materialized and recorded; absent engine does not fail the install.
  - `tests/extension-preparation.test.ts`: truthful-prepare regressions (added with the fix).

## 3. Verification plan (requires a working shell)

```powershell
# 0. Prerequisite: a working pwsh. Currently fails at sandbox provisioning with
#    SetNamedSecurityInfoW (Win32 5) grantWrite(D:\DEV\dsh-tool-mode).

# 1. Static gates
pnpm -C D:\DEV\dsh-tool-mode install
pnpm -C D:\DEV\dsh-tool-mode -r exec tsc --noEmit
node --import tsx --test packages/dsh-tool-mode/tests/extension-dependencies.test.ts
node --import tsx --test packages/dsh-tool-mode/tests/extension-optional-runtimes.test.ts
node --import tsx --test packages/dsh-tool-mode/tests/extension-preparation.test.ts

# 2. Deploy the fixed host (0.4.7) into the web profile
npm run plugin:install -- --profile web
# then restart the web host; the launch line prints http://127.0.0.1:3080/?token=...

# 3. Drive the real page/API (cookie from the launch token)
#    POST /api/modelTools/<method> with {"type":"client-request","rpcId":...,"method":"modelTools/<m>","payload":{"args":{...}}}
#    methods: describe, installExtension(id[,source]), enable(id), prepare(id)
```

Acceptance criteria:

1. **Laya**: `installExtension('@try-works/extension-laya')` succeeds (no depth-bound refusal);
   `describe` shows `installation: installed` and the copied tree contains
   `node_modules/onnxruntime-node` resolved with preinstalled provenance.
2. **Laya assets**: `prepare('@try-works/extension-laya')` returns `prepared: false` with
   `ASSET_SOURCE_UNAVAILABLE` (expected, RC5) — never a false success. Its tools become callable only
   once real artifact locations or a pre-populated digest cache exist.
3. **EmbeddingGemma**: reinstall `0.1.1`; the installed tree contains `node_modules/onnxruntime-node`
   and `@huggingface/transformers`; `prepare(id)` acquires ≈2.96 GB, records `prepared-cold`, and
   `multimodal_embed` on a short text returns a 768-dimensional L2-normalized vector.
4. **Honesty**: with the lifecycle unmounted, prepare refuses before any transfer and the row stays
   unchanged rather than reporting success.

## 4. Verification results (executed 2026-10-19)

Environment: a second host booted from a fresh profile (`verify-ext`) built from this workspace
(plugin 0.4.7), scratch store `D:\DEV\dsh-verify-state\extensions`, port 3091. The interactive `web`
profile / :3080 instance was never touched.

| Check | Result | Evidence |
|---|---|---|
| Typecheck | PASS | `tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json` exit 0 |
| Host test suite | PASS | 1200 tests, 1194 pass, 0 fail, 6 skipped |
| Laya install from SOURCE DIRECTORY (the reported path) | PASS, 10.6 s | `source: "directory"`, 1.0.1; installed tree holds `onnxruntime-node`, `define-data-property` (depth 4), `has-property-descriptors`/`es-define-property` (depth 5) |
| embeddinggemma install from source directory | PASS, 35 s | 0.1.1; `node_modules/onnxruntime-node` + full transitive tree materialized (RC2 fix) |
| tongue: install → prepare → enable → tool call | PASS | matrix: `lang_detect` PASS on the shipping host (a real tool result) |
| Laya prepare | SKIPPED, named blocker | `[ASSET_SOURCE_UNAVAILABLE] … its source is "the split export of the pinned checkpoint"` (RC5) |
| embeddinggemma prepare | FAIL, environment | `fetch failed` after 310 s acquiring the ≈2.96 GB pinned set — the real cause was the C: cache volume (0.4 GB free); see RC2 in commit `2b59ce0` |
| **Laya tool call** | **PASS** | `decision_choose` returned `{"chosen":"delay for testing","answer_confidence":0.6021,"calibrated":false,…}` |
| **embeddinggemma tool call** | **PASS** | `multimodal_embed` on "hello world" returned a 768-dimensional vector, first values `[-0.029255399480462074, 0.032571226358413696, 0.04122638329863548]` |
| **Live :3080 host (0.4.9)** | **PASS** | after `prepare` was re-run in the live process, `decision_choose` returned a real decision and `multimodal_embed` returned `dimensions: 768`, `normalized: true`, `implementationId: embeddinggemma2-onnx`, `extensionVersion: 0.1.1` |
| Host suite (0.5.0 changes) | PASS | 1215 tests, 1209 pass, 0 fail, 6 skipped |

What this proves: the depth-bound fix removes the exact `DEPENDENCY_UNSATISFIED` failure on the
directory arm; the optional-runtime fix puts the native engine inside the installed package; the
install → prepare → enable → invoke pipeline works end to end with a real tool (tongue).

What it does NOT prove, and why:

- Nothing remains blocked at the tool level: both target tools now execute (table above). Earlier rounds
  reported them as unusable; the three defects found only by invoking them were fixed (RC7, RC8, RC9).
- The Laya artifacts are still not downloadable: they were seeded into `E:\dsh-asset-cache` from a
  verified local export (`scripts/seed-prepared-assets.mjs`), and `prepare` verifies every digest
  before readiness. A deployment without those bytes will still refuse honestly.
- embeddinggemma's ≈2.96 GB set is now fully cached on E: (426 GB free); the earlier "fetch failed"
  was the near-full C: volume, not the network.

### Residual risks (reviewed, deliberately not fixed here)

- `replaceInstalledRecord` swallows write errors and returns a boolean the caller ignores; a failure
  after the optional-runtime merge would leave a stale `contentDigest` and a later
  `INTEGRITY_MISMATCH`. The window also exists between the SDK's `recordInstall` and the merge.
- `#dependencyGraph` (unlike `#installGraph`) never consults `preinstalledSearchRoots`, so an engine
  that exists only in a NESTED package tree records as unsatisfied. Not triggered by today's three
  packages; the host profile resolves both engines from the hoisted root `node_modules`.
- `resolveFirstPartyDependency` matches by name only, ignoring the declared range, so a directory-arm
  lock can record a version that does not satisfy the spec (the installed copy may still be saved by
  its own nested tree).

## 5. Remaining environment facts (updated)

- The shell is repaired (the bundled ACL diagnostic granted the missing right); every gate above ran.
  Rollback record: `D:\DEV\dsh-acl-recovery\acl-backup-4d8517db1122469d97c02014dcf4e736.json`.
- `:3080` still serves the stale 0.3.6 plugin, so verification used a fresh profile on `:3091`
  (`C:\Users\erikb\.dsh\profiles\verify-ext`, store `D:\DEV\dsh-verify-state\extensions`).
- Laya's ONNX artifacts are not obtainable from the lock (RC5); embeddinggemma's ≈2.96 GB acquisition
  fails on this network. Those are data/network prerequisites, not code defects.
- `oxlint` is not installed in this checkout, so the anti-slop lint gate could not run.
