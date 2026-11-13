# Clean-install extension matrix — 2026-10-24

## Purpose

Answer one question with evidence: can another user with only the published plugin
install all first-party extensions from npm through the same remote/UI lifecycle the
Settings page uses?

**Answer: not yet.** The matrix ran, but six of eight extensions cannot reach a
callable state from a clean registry-only profile.

## Environment

- Fresh `DSH_HOME`: `D:/DEV/dsh-matrix-home`
- Fresh profile: `matrix`, created from the shipped `web` template
- Plugin: `@try-works/dsh-tool-mode@0.5.31`, installed from npm into that profile
- Extension store: `D:/DEV/dsh-matrix-state/extensions` (new/empty)
- `extensionSourceDir`: unset (empty)
- `extensions.allowSourceDirectories: false`
- `allowExecutablePreparation: true` (operator grant needed for the needle executable)
- Asset cache: shared `E:/dsh-asset-cache`
- Host: `http://127.0.0.1:3182`, disposable profile
- Harness: `scripts/ext-matrix.mjs` (remote `describe` → `installExtension` → `prepare`
  → `enable`; then the in-process shipping host over a store snapshot for tool calls)

## Lifecycle result

| Extension | Status | Evidence |
| --- | --- | --- |
| tongue | SKIPPED | `@desert-ant-labs/tongue@3.6.0` declares `prepare`; installer refuses (EXT-10) |
| voz | SKIPPED | `@bjorn3/browser_wasi_shim@0.3.0` declares `prepare`; `onnxruntime-node` also refused/timed out |
| embeddinggemma | SKIPPED | `onnxruntime-node` declares `prepare`; dependency graph refused |
| laya | FAIL | retry: `DEPENDENCY_UNSATISFIED` — `onnxruntime-node@1.30.0` declares `prepare` |
| minilm-embed | FAIL | first pass timed out at ~100 s fetching `onnxruntime-node@1.30.0` |
| minilm-rerank | FAIL | first pass timed out at ~100 s fetching `onnxruntime-node@1.30.0` |
| needle | PASS | installed and prepared from registry |
| declarative-recipes | PASS | installed from registry |

Summary from the harness: **2 pass · 3 failed · 3 skipped with a named blocker**,
exit code 1. The 100-second rows did not prove a network defect: a retry of Laya
returned the real EXT-10 refusal once the metadata/tarball path was warm.

## Tool-call result

The first full matrix stopped before invocation because the Laya/minilm invocation
map was stale (their tools were not registered). A separate `needle` +
`declarative-recipes` run invoked the four declared tools:

| Tool | Verdict | Detail |
| --- | --- | --- |
| `tools_plan` (needle) | SKIPPED | invocation host composes the planning adapter but has no Agent turn context (harness limitation) |
| `structured_extract` (needle) | PASS | real extraction validated against the caller schema |
| `text_title` (recipes) | SKIPPED | invocation host composes no LLM provider (harness limitation) |
| `describe_image` (recipes) | SKIPPED | same no-LLM harness limitation |

The initial needle failure was a harness defect, not a product defect: the
invocation host looked in the default `$DSH_HOME/model-as-tool/asset-cache`
instead of the profile's configured `E:/dsh-asset-cache`. The matrix now accepts
`EXT_MATRIX_ASSET_CACHE`; with it set, `structured_extract` passed. `tools_plan`
remains unexercised because the in-process host has no Agent turn context.

## Verdict

The claim “all extensions installable by other users” is **not confirmed**:

- Only **2 of 8** extensions install, prepare and enable from npm in a clean profile.
- **6 of 8** are blocked by the no-install-scripts policy in their dependency graphs
  (`prepare` / `postinstall` on `@desert-ant-labs/tongue`, `browser_wasi_shim`, and
  `onnxruntime-node`).
- Declarative recipes cannot be invoked in the matrix host without an LLM provider;
  the live web host uses the agent, so that row is a harness limitation, not proof
  of installability for every tool.

## Decision needed

The EXT-10 refusal is a security boundary, not a bug that should be bypassed
silently. Making the claim true requires one of:

1. **Bundle prebuilt dependency trees** into the extension tarballs (largest, but
   no script execution; onnxruntime-node and transformers are hundreds of MB each).
2. **Add an explicit trusted-dependency/script gate** for first-party extensions
   (runtime code execution at install; needs a deliberate security decision).
3. **Move runtime dependencies into separately installed runtime packs** that ship
   prebuilt artifacts and are resolved at runtime.

The `~100 s` install path also needs a long-running job or timeout change before a
rerun can complete without a transport timeout.

## 0.5.32 rerun — trusted prebuilt gate

The plugin now admits an exact allowlist of dependencies whose published tarballs
already ship their runtime artifacts. Their lifecycle scripts are **never executed**
and the package.json is left untouched; unlisted versions still refuse under EXT-10.
The default list covers `@desert-ant-labs/tongue@3.6.0`,
`@bjorn3/browser_wasi_shim@0.3.0`, `onnxruntime-node@1.21.0`,
`onnxruntime-node@1.30.0`, `onnxruntime-common@1.30.0`, and `sharp@0.34.5`.

A fresh profile with plugin **0.5.32** and SDK **0.1.1** produced:

| Extension | Status | Detail |
| --- | --- | --- |
| tongue | **PASS** | installed, prepared, enabled |
| needle | **PASS** | installed, prepared, enabled |
| declarative-recipes | **PASS** | installed, enabled |
| voz | SKIPPED | `@types/dom-mediacapture-transform` tarball root is not `package/`; onnx tarball also timed out |
| embeddinggemma | SKIPPED | `onnxruntime-node` tarballs timed out |
| laya | FAIL | `onnxruntime-node@1.30.0` tarball timed out |
| minilm-embed | FAIL | same onnx tarball timeout |
| minilm-rerank | FAIL | same onnx tarball timeout |

Summary: **3 pass, 3 fail, 2 skipped**. The gate fixed the script-policy refusals
(tongue previously failed at the same point), but the remaining blocker is no longer
EXT-10: the large ONNX tarball fetch is terminated at roughly 100–170 seconds, and
the `@types/dom-mediacapture-transform` tarball has a non-`package/` root that the
extractor does not normalize.

These are now the two concrete fixes needed before another matrix run:

1. make install a long-running job (or otherwise remove the ~100 s RPC abort) so
   large dependency transfers can finish;
2. normalize a registry tarball with a single non-`package/` root before install.

The second fix is implemented in **0.5.33** / SDK **0.1.2**: a single top-level
wrapper directory is stripped like `package/` (the real
`@types/dom-mediacapture-transform` layout), with a regression test. The first fix
remains open.

## 0.5.34 retry result

The registry downloader now retries a reset tarball up to three times with backoff
(never retrying a byte-cap, 4xx, or explicit cancellation), with a regression test.
A fresh **0.5.34** run of the five ONNX-dependent extensions still failed after all
three attempts, each row ending in `fetch failed` after ~307 s.

The failure reproduces outside the plugin:

- Node `fetch()` of `onnxruntime-node@1.30.0` aborts with `ECONNRESET` after
  ~172 s.
- `curl` aborts with `Recv failure: Connection was reset` after ~231 s.
- The npm mirror receives ~89 MB of 113 MB in 120 s and then times out.

So the remaining all-extensions blocker on this machine is the registry transfer
path, not the install policy or retry logic. A stable network/mirror or a resumable
download is required before the matrix can pass here.

## 0.5.36–0.5.38 progress

Three additional fixes landed:

- **HTTP Range resume** for registry tarballs: after a reset, the next request asks
  for `bytes=<received>-`; a regression test proves the server sees the Range
  request. In practice the public registry still resets before completion.
- **Compile-time-only packages skipped**: `@types/*` packages are not materialized
  into the runtime tree. This removed the real voz conflict between
  `@types/dom-webcodecs@0.1.13` and `0.1.19`.
- **Browser-only backend skipped**: `onnxruntime-web` is not materialized on the
  Node host, removing its `onnxruntime-common@1.31.0-dev` conflict with the Node
  backend's `1.30.0`.

Result on the clean profile:

| Extension | Status |
| --- | --- |
| tongue | PASS |
| voz | PASS |
| laya | PASS |
| needle | PASS |
| declarative-recipes | PASS |
| embeddinggemma | blocked at registry transfer (`fetch failed`) |
| minilm-embed | blocked at registry transfer (`fetch failed`) |
| minilm-rerank | blocked at registry transfer (`fetch failed`) |

That is **5 of 8** with the install-policy fixes; the last three are blocked only by
the public registry connection resetting large transfers. The npm mirror path was
tested separately and also could not finish the ONNX tarball.

## 0.5.38 local-registry verification

To separate installer correctness from the public network, the matrix was rerun
against a loopback npm proxy serving real npm metadata and `npm pack` tarballs. This
is evidence for the install lifecycle, **not** evidence that the public transfer
works.

| Extension | Result |
| --- | --- |
| tongue | PASS |
| voz | PASS |
| laya | PASS |
| minilm-embed | FAIL at registry transfer |
| minilm-rerank | PASS |
| needle | PASS |
| declarative-recipes | PASS |
| embeddinggemma | SKIPPED — dependency policy (`onnxruntime-common`) |

That is **6 of 8** installs passing through the registry lifecycle once the public
network is removed. Later versions added the observed `onnxruntime-common@1.21.0`
and `tar@7.5.22` allowlist entries, but a full rerun with those versions has not
completed. Embeddinggemma still needs its optional runtime dependencies materialized
even when install succeeds.

## 0.5.42 optional-runtime fixes

The optional-runtime path was then exercised directly:

- `@huggingface/transformers@3.8.1` installs.
- `onnxruntime-node@1.30.0` installs.
- The old transitive `global-agent@3.0.0` vs `4.1.6` conflict no longer aborts the
  optional runtime; the existing version is kept.
- A second full local-registry run reached **embeddinggemma PASS** and
  **minilm-embed PASS**.

That run still failed `laya` and `minilm-rerank` on **loopback proxy metadata
timeouts** for `adm-zip` and `@huggingface/jinja`, including with a 120 s metadata
timeout. Those are test-proxy failures, not product policy failures.

A single clean matrix with all 8 installed and enabled at once has therefore **not**
been recorded. The closest per-extension evidence is:

- tongue, voz, embeddinggemma, minilm-embed, minilm-rerank, needle, recipes have
  each passed a registry install in at least one run;
- laya has passed both public and local runs;
- the last 0.5.42 full run still lost voz, laya and minilm-embed to loopback
  proxy metadata timeouts (`adm-zip`, `@huggingface/jinja`), including with a
  120 s timeout.

The public-registry transfer blocker for `onnxruntime-node` remains.

## Final local-registry run — all eight installed

With the loopback npm registry serving real npm metadata and `npm pack` bytes,
the final clean run installed, prepared and enabled every extension:

| Extension | Lifecycle | Tool invocation |
| --- | --- | --- |
| tongue | PASS | `lang_detect` PASS |
| voz | PASS | `stt_transcribe` PASS |
| embeddinggemma | PASS | skipped by in-process harness (no prepared-asset map) |
| laya | PASS | skipped by in-process harness (no prepared-asset map) |
| minilm-embed | PASS | skipped by in-process harness (no prepared-asset map) |
| minilm-rerank | PASS | skipped by in-process harness (no prepared-asset map) |
| needle | PASS | `structured_extract` PASS; `tools_plan` skipped (no Agent turn context) |
| declarative-recipes | PASS (install/enable) | skipped (in-process host has no LLM provider) |

Harness summary: 7 PASS + 1 named invocation skip, 0 FAIL, exit 0. This is the
single clean-matrix evidence for the install fixes. The public npm transfer of the
ONNX tarball remains outside the plugin's control on this machine.

## Evidence

- [Full lifecycle JSON](../verification/ext-matrix-clean/ext-matrix.json)
- [Full lifecycle report](../verification/ext-matrix-clean/ext-matrix.md)
- [Laya retry report](../verification/ext-matrix-clean-retry/ext-matrix.md)
- [Tool invocation JSON](../verification/ext-matrix-clean-invoke2/ext-matrix.json)
- [Tool invocation report](../verification/ext-matrix-clean-invoke2/ext-matrix.md)
- [0.5.32 lifecycle JSON](../verification/ext-matrix-clean-0532/ext-matrix.json)
- [0.5.32 lifecycle report](../verification/ext-matrix-clean-0532/ext-matrix.md)
- [0.5.34 retry JSON](../verification/ext-matrix-clean-0534-retry/ext-matrix.json)
- [0.5.34 retry report](../verification/ext-matrix-clean-0534-retry/ext-matrix.md)
- [0.5.36 retry report](../verification/ext-matrix-clean-0536-retry/ext-matrix.md)
- [0.5.38 local-registry JSON](../verification/ext-matrix-local-registry4/ext-matrix.json)
- [0.5.38 local-registry report](../verification/ext-matrix-local-registry4/ext-matrix.md)
- [final all-eight JSON](../verification/ext-matrix-local-registry-final2/ext-matrix.json)
- [final all-eight report](../verification/ext-matrix-local-registry-final2/ext-matrix.md)

The matrix harness also got a Windows fix: an absolute `EXT_MATRIX_PLUGIN` path is
now converted to a `file://` URL before `import()`. Regression test added in
`packages/dsh-tool-mode/tests/ext-matrix-harness.test.ts`.
