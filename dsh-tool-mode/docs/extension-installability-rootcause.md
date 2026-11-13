# Why the first-party extensions would not install, and what was fixed

Status: root causes proven against the live `web` profile on 2026-10-19; fixes in
the working tree, artifact installed into the profile, live host restart pending.

Two independent failures were on the Extensions page at the same time, plus one
misleading presentation and one data-level limitation. They are separate causes;
fixing one does not fix another.

## TL;DR

| # | Symptom as seen | Root cause | Fix |
|---|---|---|---|
| RC1 | Laya Install → `[DEPENDENCY_UNSATISFIED] … exceeds the 3-level depth bound at define-data-property` | The `web` profile ran plugin **0.3.6**, whose source-directory install arm never passed a graph depth bound to the bundled SDK; the SDK falls back to `graph.maxDepth ?? 3`, and Laya's `onnxruntime-node` tree is 6 levels deep (`define-data-property` = level 4). Published 0.4.7 and HEAD both still lack that hunk; only the working tree has it. | Forward the host bound on BOTH arms (`maxDepth: depth`, default 12) and ship it: plugin **0.4.8** built, installed into `~/.dsh/profiles/web/`, profile dependency repointed. |
| RC2 | embeddinggemma `Prepare` never completes; state stays `needs-preparation`; an earlier run surfaced bare `fetch failed` | The asset-cache root defaulted to the state-adjacent path on **C:, with ~0.38 GB free**, while the pinned set needs **2.96 GB** (first asset alone 1.08 GB). The mid-transfer **ENOSPC** surfaced as the transport's generic `fetch failed`; no preflight existed. | Preflight before any transfer (`extension-asset-space-insufficient`, quoting required/available bytes + cache path), plus a configurable `assetCacheRoot`; the `web` profile now points at `E:/dsh-asset-cache` (430 GB free). |
| RC3 | The embeddinggemma row showed badge "active" + toggle ON next to "activation blocked: … needs its model assets prepared"; Laya's pre-install assets hint read like the real blocker | The badge was derived from `active` (the raw lifecycle observation) while the row was `blocked`; the notes loop rendered every unmet requirement as a blocker, including post-install ones on a not-installed row. | New pure derivation `extension-page-state.ts`: a blocked row never renders as plainly active/ON (badge `active · blocked`, toggle visual OFF); row-blocking reasons stay blockers, post-install assets become a muted note. |
| RC5 | Laya can install after RC1 but still cannot prepare | `packages/extension-laya/models.lock.json` records the six artifacts' provenance as **prose** ("the split export of the pinned checkpoint"), no URL — the upstream repo publishes no ONNX export. | Not a fetch bug: the host MUST refuse. The bytes are the documented local export; the new `scripts/seed-prepared-assets.mjs` verifies size + SHA-256 against the lock and seeds the content-addressed cache, where preparation re-verifies and uses them. Seeded for this host. |

## RC1 — the depth bound (install blocker)

The bound is a value the **host** supplies and the **SDK** enforces:

```ts
// packages/tool-mode-extension-sdk/src/install/dependencies.ts
294: const maxDepth = graph.maxDepth ?? 3
310: if (entry.depth > maxDepth) {
314:   `the dependency graph exceeds the ${maxDepth}-level depth bound at ${entry.name}`,
```

The message is parameterized by `maxDepth`; that it said **3** and named
`define-data-property` proves the SDK received no bound. Laya's real tree:

```
0 onnxruntime-node → 1 global-agent → 2 globalthis → 3 define-properties
→ 4 define-data-property → 5 es-define-property
```

- Host default: `src/extensions-service.ts:118` `DEFAULT_REGISTRY_DEPENDENCY_DEPTH = 12`.
- Source-directory arm (the one the `web` profile uses, via `extensionSourceDir`):
  `#dependencyGraph` at `:1163-1176`, `maxDepth: depth` at `:1171` (fixed).
- Registry arm: `#installGraph` `:2004-2034`, `maxDepth` at `:2006` and `:2032` (was already fixed in 0.4.7).
- Graph builder forwards it: `src/extension-dependencies.ts:597`.

**Why 0.4.7 did not help:** extracting the published 0.4.7 tarball shows
`lib/extensions-service.js:737` (`#dependencyGraph`) with **no** `maxDepth`; only
the registry arm (`:1427/:1455`) had it. HEAD `b8d13b9` also lacks the directory-arm
hunk. The profile therefore needed a new build (0.4.8), not a version bump.

**Verification:** `tests/extension-dependency-depth-live.test.ts` — synthetic
onnxruntime-shaped tree: at bound 12 all six entries materialize; at bound 3 it
reproduces the live refusal verbatim. 2/2 pass. Registry-arm depth tests 4/4.
Packaged 0.4.8 `lib/extensions-service.js` shows `maxDepth: depth` at `:761`,
`:1448`, `:1476`; bundled SDK fallback `?? 3` at `:165`.

## RC2 — the asset-cache volume (prepare blocker)

- Web profile cache root was `…\profiles\web\extensions\profiles\default\asset-cache`
  on C:. The directory did not exist; the prepare never flipped readiness.
- Pinned bytes (`embeddinggemma-2`): 1,084,170,240 + 671,026,176 + 1,172,750,848
  + 32,170,510 = **≈2.96 GB**, vs **≈0.38 GB** free on C:. The first asset alone
  is 1.08 GB, so no transfer could finish; ENOSPC mid-stream collapsed into the
  transport's `fetch failed`. The network was fine (HF HEAD → 200, exact
  Content-Length).
- Fix (`src/prepared-assets.ts`): before transferring, sum the bytes actually
  **missing** from the content-addressed cache (a digest hit transfers nothing)
  and compare with free space at the cache root (injectable probe; default
  `statfs` at the nearest existing ancestor). Refusal:
  `[extension-asset-space-insufficient] … needs <n> bytes … only <free> bytes are free.`
- Config: `assetCacheRoot` (`src/index.ts`), documented in `docs/PLUGIN.md`;
  `web` profile → `E:/dsh-asset-cache`.
- Tests: `tests/asset-cache-preflight.test.ts` — insufficient-space refusal with
  exact numbers and zero source reads; digest cache hit with zero free space;
  configured root surfaced through management prepare. 3/3 + prepared-assets 14/14.

## RC3 — the page said "active" while it was blocked

Host row contract (`extensions-service.ts` ≈:1719-1731): `active` is the raw
lifecycle observation (`observedActivation === 'active'`), `blocked` is
`requirements.some(blocksRow)`, `reason` is the highest-priority blocking
requirement, `requirements` is the per-kind checks. Readiness feeds the `assets`
requirement, not the `active` badge.

Rendering rule now enforced in one place: **a row the host reports blocked — or
that carries any unmet requirement which blocks this row — is never rendered as
plainly "active"/ON; the badge shows "active · blocked" and the toggle visual is
OFF, while the toggle's enabled/disabled state, aria-pressed lifecycle fact and
action title are unchanged.**

- New `src/extension-page-state.ts` (pure) + `tests/extension-page-state.test.ts` (6/6).
- `client/index.template.js` updated; bundle regenerated with `scripts/gen-client-catalog.mjs`.
- Laya: the dependency refusal is the primary blocker; the post-install assets
  hint is a muted note, not a blocker.

## RC5 — Laya's assets are a documented local export, not a download

The six artifacts at `E:\tmp\laya-investigation\laya\model-ml` match the lock
exactly (size + SHA-256 verified). Because the lock's sources are prose, prepare
correctly refuses with `ASSET_SOURCE_UNAVAILABLE` until those bytes are in the
cache. The new script is that bridge:

```
node scripts/seed-prepared-assets.mjs \
  --lock packages/extension-laya/models.lock.json \
  --asset-set laya-decision-onnx \
  --from E:\tmp\laya-investigation\laya\model-ml \
  --cache-root E:\dsh-asset-cache
```

It verifies every asset (size + SHA-256, case-insensitive), copies atomically to
`<cache-root>/<DIGEST>` — the exact filename the host probes — and refuses a
mismatch. Recorded for this host: 6/6 assets seeded (encoder 1,227,816,960 B,
head data 59,899,904 B, tokenizer 34,363,188 B, plus the small ONNX headers and
`rl_agent_config.json`).

## What still needs the operator

1. **Restart the `:3080` host** so the running process loads 0.4.8 (the tarball is
   installed and the profile dependency already points at it). A host restart
   cannot be done from inside this session without killing it.
2. After the restart: retry Laya Install (now succeeds), then Prepare (cache hit,
   no download). embeddinggemma Prepare will download ~2.96 GB to `E:`.
3. 0.4.8 is not yet published to npm; the registry install route keeps serving
   0.4.7 (which lacks the RC1 directory-arm fix) until it is.

## Known limits, recorded honestly

- The preflight estimates only blobs **absent** from the cache; a corrupted
  cached blob's re-download is outside the estimate (digest verification still
  refuses tampered bytes).
- A genuinely interrupted transfer still reports the transport's message,
  retryable, with the partial kept for a ranged resume.
- RC1's live Extensions-page retry is pending the restart; code-level and
  artifact-level proof is complete.
