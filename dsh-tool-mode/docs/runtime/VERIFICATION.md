# Runtime layer — verification gate

Status: gate landed 2026-11-14. Contract this verifies: [PLAN.md](./PLAN.md). Script:
[`scripts/verify-runtime.mjs`](../../scripts/verify-runtime.mjs).

## Run it

```bash
node scripts/verify-runtime.mjs                  # all thirteen packages, strict
node scripts/verify-runtime.mjs --allow-missing   # absent packages are skipped, not fatal
node scripts/verify-runtime.mjs --package tool-mode-runtime-litert
```

No `npm install`, no network, no shell: `typescript` and `tsx` are resolved from the
repository's own `node_modules` and executed through `process.execPath`. It runs in a few
seconds when packages are absent and as long as the slowest suite when they are present
(per-command budget: 300 s, then SIGTERM and a `FAIL`).

## What each package must pass

For `packages/<name>` the gate runs exactly the commands the package declares in its own
`scripts`, so the package config stays the source of truth:

| Step | Command (from repository root) |
| --- | --- |
| Build | `node <node_modules/typescript/bin/tsc> -p packages/<name>/tsconfig.build.json` |
| Typecheck | `node <node_modules/typescript/bin/tsc> --noEmit -p packages/<name>/tsconfig.json` |
| Tests | `node <node_modules/tsx/dist/cli.mjs> --test <absolute paths to packages/<name>/tests/*.test.ts>` |

**Build comes first, and the order is load-bearing.** A cross-package import resolves through
the package name to `@try-works/<pkg>/lib/index.js` per repo convention, so a consumer needs
its dependency **built**, not merely present. Packages are therefore verified in dependency
order — `tool-mode-runtime-core` (phase 0), `tool-mode-runtime-processors` (phase 1),
`tool-mode-runtime-litert` (phase 1), `tool-mode-runtime-dsh` (phase 0),
`tool-mode-runtime-recipes` (phase 2), `tool-mode-runtime-onnx` (phase 3), `extension-redact`
(phase 1), `extension-shapes-recipe` (phase 2), `extension-uhm-recipe` (phase 3),
`extension-clear-recipe` (phase 3), `extension-moderator-recipe` (phase 4),
`extension-ear-recipe` (phase 4), `extension-emo-recipe` (phase 4) — and each one's `lib/` exists
by the time the next package is checked.

**A code-free package is `tests-only`.** `extension-shapes-recipe` ships JSON (manifests, locks,
recipes) and has no tsconfig or build config by design, so build and typecheck report `N/A`
instead of `FAIL`, and its tests are the only executable evidence it can offer. Marking it
`FAIL` would blame a package for a config it is not supposed to have; marking it `PASS` while
skipping the suite would be a false green.

A package that typechecks but does not build is a FAIL, and the two are reported separately on
purpose: `tsx` strips types without checking them, so a suite can be green over source that
does not compile. That is exactly the state `tool-mode-runtime-litert` was in on snapshot 4.

**Working directory is the repository root, deliberately.** This is the repo's convention
(`npm test` passes package-relative test paths from the root) and it is load-bearing: existing
suites resolve fixtures against `process.cwd()`, so running the same tests from the package
directory makes them look for `packages/<pkg>/packages/<pkg>/...` and fail on ENOENT. The gate
was first pointed at `packages/tool-mode-recipes` from the package directory and discovered
exactly that; `tool-mode-recipes` now passes both steps, which is how the runner itself is
regression-tested.

## Result labels and exit codes

| Label | Meaning |
| --- | --- |
| `PASS` | build exit 0 **and** typecheck exit 0 **and** tests exit 0 (for a `tests-only` package: tests exit 0) |
| `FAIL` | any applicable step nonzero, a timeout, a missing `tsconfig.json`/`tsconfig.build.json` on a TypeScript package, unusable tooling, or a package with no `tests/*.test.ts` (a TDD violation per PLAN.md, reported as `tests: no tests/*.test.ts found`) |
| `MISSING` | `packages/<name>` does not exist yet |
| `N/A` | the step does not apply: build/typecheck on a `tests-only` package |

| Exit | When |
| --- | --- |
| 0 | every selected package passed |
| 1 | at least one `FAIL` |
| 2 | no failures, but at least one `MISSING` (unless `--allow-missing`) |

`MISSING` is nonzero on purpose: a gate that goes green over zero packages is a false claim
of coverage. CI for an in-progress phase passes `--allow-missing`; the phase gate does not.

Preflight also prints the installed `effect` version and warns on nested copies, because
PLAN.md requires "Effect 4.1.2 only, one hoisted copy". The warning is non-fatal — it reports
a violated non-negotiable without masking a package's own result. Current install: `4.1.2`,
no nested copies.

## Current recorded status

The runtime packages land concurrently, so a status snapshot is only true at its timestamp.

**Snapshot 1 — 2026-11-14 10:46, all four absent** (exit 2):

```
Package                       Phase  Typecheck  Tests    Result
----------------------------  -----  ---------  -------  -------
tool-mode-runtime-core        0      MISSING    MISSING  MISSING
tool-mode-runtime-litert      1      MISSING    MISSING  MISSING
tool-mode-runtime-processors  1      MISSING    MISSING  MISSING
tool-mode-runtime-dsh         0      MISSING    MISSING  MISSING

0 passed, 0 failed, 4 missing
```

**Snapshot 2 — 2026-11-14 10:51, after core/processors/dsh/litert landed** (exit 1):

```
Package                       Phase  Typecheck  Tests  Result
----------------------------  -----  ---------  -----  ------
tool-mode-runtime-core        0      PASS       PASS   PASS
tool-mode-runtime-litert      1      FAIL       FAIL   FAIL
tool-mode-runtime-processors  1      PASS       PASS   PASS
tool-mode-runtime-dsh         0      FAIL       FAIL   FAIL

2 passed, 2 failed, 0 missing
```

Findings — snapshot 3 (current). The two snapshot-2 litert defects are fixed by their owner:
LiteRtRuntimeModule now agrees between test and implementation, and the interceptor takes
Parameters of globalThis.fetch. litert and processors now PASS. As reported; this gate does
not fix package source:

- tool-mode-runtime-core — typecheck: two test-side errors, tests/contracts.test.ts(30,28) and
  tests/readiness.test.ts(20,28): Effect of unknown, SchemaError, unknown is not assignable to
  Effect of unknown, SchemaError, never under exactOptionalPropertyTypes. Tests: 63 of 65 pass;
  DeploymentStore.fromMemory fails ports.test.ts:187 (appends events and filters them by model,
  preserving order) and (gives every layer build its own log).
- tool-mode-runtime-dsh — typecheck: TS6059, tool-mode-runtime-core/src/*.ts is not under
  rootDir .../tool-mode-runtime-dsh. The paths mapping that fixed snapshot 2 now pulls core
  sources into the dsh program while dsh inherits rootDir "." from the package template
  (tsconfig.json:25). With noEmit true the fix is to drop rootDir from the check config (keep
  it in tsconfig.build.json), or use composite project references, or map paths at the built
  lib/*.d.ts.
- tool-mode-runtime-litert and tool-mode-runtime-processors are green: typecheck and tests.

Snapshot 2 core failure was a mid-write race, not a defect: the gate caught an unterminated
string in tests/contracts.test.ts that was already valid when read moments later. Re-run a
single failing snapshot during active editing before filing it.

**Snapshot 4 — 2026-11-14 11:15, build-first gate** (exit 1):

```
Package                       Phase  Build  Typecheck  Tests  Result
----------------------------  -----  -----  ---------  -----  ------
tool-mode-runtime-core        0      PASS   PASS       PASS   PASS
tool-mode-runtime-processors  1      PASS   PASS       PASS   PASS
tool-mode-runtime-litert      1      FAIL   FAIL       PASS   FAIL
tool-mode-runtime-dsh         0      PASS   PASS       PASS   PASS

3 passed, 1 failed, 0 missing
```

The build-first change confirmed the dependency hypothesis twice over: core's snapshot-3 typecheck
errors and 2 failing tests were fixed by their owner (it now passes all three steps), and dsh went
from FAIL to PASS — its tests import `@try-works/tool-mode-runtime-core`, which only resolves once
core has a `lib/`.

Only litert fails, and it fails in the shape this gate exists to catch: **tests pass while build
and typecheck fail**, because `tsx` strips types instead of checking them. Four src-level errors,
all introduced after the package's previous green state:

- `src/runtime.ts(70,54)` and `(74,54)` — TS2540, cannot assign to read-only property `threads`.
- `src/shim.ts(189,27)` — TS7053, indexing the mime map (`{ '.wasm'`, `'.js' }`) with a `string`.
- `src/shim.ts(242,28)` — TS2322, `unknown` not assignable to `{ exports: unknown }`.

Because the litert build fails its `lib/` is not produced, so any package verified after it that
imported litert by name would fail for that reason alone. None currently does (dsh depends on core).

## Scope — what this gate does NOT prove

- **Build artifacts are not cleaned.** The gate runs `tsc -p tsconfig.build.json`, which writes
  `lib/`, but it does not delete a stale `lib/` first. A package whose build now fails can still
  have an older `lib/` on disk that a dependent package imports. Treat a build FAIL as also
  invalidating every consumer verified after it.
- **No install.** The gate never runs `npm install`; a declared-but-uninstalled dependency
  surfaces as a typecheck error, not as an install step.
- **No real inference by default.** PLAN.md gates a real-assets test behind
  `TOOL_MODE_REAL_ASSETS=1` with a skip reason otherwise, and this gate never sets it, so its own
  green run covers the skipped path. To cover the real path, fetch the assets
  (`scripts/fetch-redact-assets.mjs`) and run the suite directly with the variable set, as
  recorded above: `TOOL_MODE_REAL_ASSETS=1 npx tsx --test packages/extension-redact/tests/real.test.ts`.
- **No socket check.** PLAN.md forbids listening sockets in the LiteRT path. This gate does not
  assert that; litert's own suite does ("never opens a listening socket from the source tree").
- **No host changes.** It reads `packages/<name>` and writes only build output (`lib/`).

**Snapshot 5 — 2026-11-14 11:47, Phase 1 gate: GREEN** (exit 0):

```
Package                       Phase  Build  Typecheck  Tests  Result
----------------------------  -----  -----  ---------  -----  ------
tool-mode-runtime-core        0      PASS   PASS       PASS   PASS
tool-mode-runtime-processors  1      PASS   PASS       PASS   PASS
tool-mode-runtime-litert      1      PASS   PASS       PASS   PASS
tool-mode-runtime-dsh         0      PASS   PASS       PASS   PASS
extension-redact              1      PASS   PASS       PASS   PASS

5 passed, 0 failed, 0 missing
```

All four snapshot-4 defects are fixed by their owners (litert's `threads` mutability, both
`shim.ts` typing errors, and the earlier core regressions), and `extension-redact` was added as
the fifth package in the same dependency order. This is the first fully green gate; it is the
Phase 1 exit criterion for the unit path.

### Real-assets evidence (gate-produced)

```text
command : $env:TOOL_MODE_REAL_ASSETS='1'; npx tsx --test packages/extension-redact/tests/real.test.ts
cwd     : D:/DEV/tool-mode/dsh-tool-mode
run     : 2026-11-14 11:57, Node v24.11.0
result  : EXIT=0    tests 1, pass 1, fail 0, skipped 0   (test 2459.7ms, total 7518.3ms)
```

Assets used, from `.assets/redact` (pinned by `scripts/fetch-redact-assets.mjs`):
`redact.tflite` 23,929,696 B, `tokenizer.json` 2,306,637 B, plus `config.json`, `labels.json`,
`redact_meta.json`, `tokenizer_config.json`.

Observed spans, copied from the run's `redact real spans:` line:

| start | end | label | text | score |
| --- | --- | --- | --- | --- |
| 0 | 5 | GIVEN_NAME | Alice | 0.977166 |
| 6 | 11 | SURNAME | Smith | 0.949971 |
| 21 | 36 | STREET_NAME | 42 Baker Street | 0.86295 |
| 52 | 75 | EMAIL | alice.smith@example.com | 1 |
| 83 | 98 | PHONE | +1 415 555 0132 | 0.9938 |
| 105 | 124 | CREDIT_CARD | 4111 1111 1111 1111 | 1 |

The run also prints two benign environment warnings that do not affect the result: the WebGPU
device could not be created (`requestAdapter` is absent under Node, so LiteRT falls back to the
CPU XNNPACK accelerator), and the NPU accelerator is unavailable. Both appear before the CPU
delegate is created, and the spans above come from that CPU path.

This upgrades the Phase 1 evidence from unit-only to unit plus real-model, for `redact` only.
The scope statement below still holds: the aggregate gate never sets the variable, so a green
snapshot 5 by itself remains evidence about the unit path.

**Snapshot 6 — 2026-11-14 12:51, Phase 2 gate: GREEN** (exit 0, Node v24.11.0, effect 4.1.2):

```
Package                       Phase  Build  Typecheck  Tests  Result
----------------------------  -----  -----  ---------  -----  ------
tool-mode-runtime-core        0      PASS   PASS       PASS   PASS
tool-mode-runtime-processors  1      PASS   PASS       PASS   PASS
tool-mode-runtime-litert      1      PASS   PASS       PASS   PASS
tool-mode-runtime-dsh         0      PASS   PASS       PASS   PASS
tool-mode-runtime-recipes     2      PASS   PASS       PASS   PASS
extension-redact              1      PASS   PASS       PASS   PASS
extension-shapes-recipe       2      N/A    N/A        PASS   PASS

7 passed, 0 failed, 0 missing
```

`extension-shapes-recipe` reports `N/A` for build and typecheck because it is `tests-only` (see
above); its `PASS` rests entirely on its suite.

### Phase 2 evidence

Gate-produced by this run (verifier):

- the table above, exit 0, seven packages.
- `extension-shapes-recipe` 27 tests / 27 pass / 0 fail / 0 skipped, exit 0, and
  `tool-mode-runtime-recipes` 50 tests / 50 pass / 0 fail / 0 skipped, exit 0 — both re-run
  standalone to capture exact counts rather than inferring them from the aggregate result.

Owner-reported; recorded here, not re-run by this gate:

- the real shapes gate passed: `line -> line`, `rectangle -> rectangle`, 702 ms, exit 0.
- host lane 22/22 (fixture, fake factory).
- README coverage green.

**Parser parity 6/6 is owner-reported and unaudited here.** The host owns a structural parser
that duplicates `runtime-recipes`, and parity between the two was measured at 6/6. That number
is a point-in-time observation, not a maintained invariant: the two parsers share no test, so
nothing fails when they drift. Record it as known duplication to retire, or as an obligation to
add a differential test — not as coverage.

**Snapshot 7 — 2026-11-14 13:32, Phase 3 (uhm half): GREEN** (exit 0, Node v24.11.0, effect 4.1.2):

```
Package                       Phase  Build  Typecheck  Tests  Result
----------------------------  -----  -----  ---------  -----  ------
tool-mode-runtime-core        0      PASS   PASS       PASS   PASS
tool-mode-runtime-processors  1      PASS   PASS       PASS   PASS
tool-mode-runtime-litert      1      PASS   PASS       PASS   PASS
tool-mode-runtime-dsh         0      PASS   PASS       PASS   PASS
tool-mode-runtime-recipes     2      PASS   PASS       PASS   PASS
tool-mode-runtime-onnx        3      PASS   PASS       PASS   PASS
extension-redact              1      PASS   PASS       PASS   PASS
extension-shapes-recipe       2      N/A    N/A        PASS   PASS
extension-uhm-recipe          3      N/A    N/A        PASS   PASS

9 passed, 0 failed, 0 missing
```

### Phase 3 evidence

Gate-produced by this run (verifier):

- the table above: nine packages, exit 0.
- `tool-mode-runtime-onnx` — 85 tests / 83 pass / 0 fail / 2 skipped, exit 0, re-run standalone
  for exact counts. Both skips are the real-assets cases, which need `TOOL_MODE_REAL_ASSETS`
  plus the prepared `.assets/uhm` artifacts; they skip rather than silently pass.
- `extension-uhm-recipe` — 30 tests / 30 pass / 0 fail / 0 skipped, exit 0.

### E2E, run first-hand by the verifier

`npx tsx scripts/verify-phase3.ts`, with assets at `.assets/uhm` (`uhm.onnx` 94,042,570 B,
`labels.json` 237 B):

```text
registered tool: detect_fillers
result: {"fillers":[{"startMs":1000,"endMs":1600,"type":"hmm","confidence":0.6419898211956024},
                   {"startMs":2200,"endMs":3000,"type":"hmm","confidence":0.6291886016726493}],
         "coverage":{"complete":true,"processedSeconds":3,"totalSeconds":3}}
PHASE 3 E2E PASS
EXIT=0
```

This confirms the owner-reported E2E (spans 1000-1600 and 2200-3000, coverage 3/3, exit 0) and
upgrades it from quoted to reproduced. Read it as a smoke test, not accuracy: one 3-second clip,
two detections, confidences of 0.64 and 0.63 — comfortably above threshold but not high, so a
second clip and a negative (filler-free) clip would be needed before quoting any rate.

**Snapshot 8 — 2026-11-14 14:02, Phase 3 complete (uhm + clear): GREEN** (exit 0, Node v24.11.0,
effect 4.1.2):

```
Package                       Phase  Build  Typecheck  Tests  Result
----------------------------  -----  -----  ---------  -----  ------
tool-mode-runtime-core        0      PASS   PASS       PASS   PASS
tool-mode-runtime-processors  1      PASS   PASS       PASS   PASS
tool-mode-runtime-litert      1      PASS   PASS       PASS   PASS
tool-mode-runtime-dsh         0      PASS   PASS       PASS   PASS
tool-mode-runtime-recipes     2      PASS   PASS       PASS   PASS
tool-mode-runtime-onnx        3      PASS   PASS       PASS   PASS
extension-redact              1      PASS   PASS       PASS   PASS
extension-shapes-recipe       2      N/A    N/A        PASS   PASS
extension-uhm-recipe          3      N/A    N/A        PASS   PASS
extension-clear-recipe        3      N/A    N/A        PASS   PASS

10 passed, 0 failed, 0 missing
```

### Phase 3 evidence — clear added

- `tool-mode-runtime-onnx` — 134 tests / 131 pass / 0 fail / 3 skipped, exit 0. Attribution
  note: those 134 live in the **onnx** package, not in the code-free recipe package; clear
  added four suites there (`clear-dsp`, `fft`, `provider-clear`, `real-clear`) on top of the
  previous five. The 3 skips are the real-assets cases.
- `extension-clear-recipe` — 30 tests / 30 pass / 0 fail / 0 skipped, exit 0 (lock, manifest,
  recipe).
- `extension-uhm-recipe` — 30 tests / 30 pass, unchanged.

Both E2Es were re-run by the verifier, both exit 0:

```text
$ npx tsx scripts/verify-phase3.ts
registered tool: detect_fillers
result: fillers 1000-1600 hmm 0.6419898211956024, 2200-3000 hmm 0.6291886016726493
        coverage complete true, processedSeconds 3, totalSeconds 3
PHASE 3 E2E PASS

$ npx tsx scripts/verify-phase3-clear.ts
registered tool: enhance_speech
output WAV bytes: 96044 | duration: 1 | coverage: complete true, processedSeconds 1, totalSeconds 1
PHASE 3 CLEAR E2E PASS
```

The uhm output is byte-identical to snapshot 7, so the detector is deterministic on this clip.

**One precision note on the clear output.** The script prints bytes, duration and coverage but
**not** `sampleRate`. The 48 kHz claim comes from the lock's processor contract (`clear/stft-v1`,
48 kHz in/out), not from this E2E's stdout, so it is recorded here as contract-derived rather
than observed.

### Provenance of the clear processor constants

The constants were read from a named primary source, not reverse-engineered from the artifact,
and both the source and the model are pinned in the package:

- repository `https://github.com/Desert-Ant-Labs/desert-ant-core`
- commit `baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7`, fetched 2026-11-14
- file and line ranges (`packages/extension-clear-recipe/models.lock.json:74-81`, asserted by
  `tests/lock.test.ts:143-144`):
  - `Sources/Clear/DSP.swift` L31-46, L271-302, L343-476
  - `Sources/Clear/Features.swift` L20-125
  - `Sources/Clear/Enhancer.swift` L55-73, L185-259
  - `Sources/Clear/Clear.swift` L428-434, L478-494, L518-526
  - `Sources/AudioDSP/Loudness.swift` L24-27, L90-244, L264-285
  - `Sources/AudioDSP/Limiter.swift` L28-30, L169-198
- artifact: model revision `b98f790c8a16d572f47bfdebd39964a0cbc987dc`, 24,801,006 bytes,
  sha256 `4176990296374e972f0c347ddcc7988d216829cafc58e4d54a98dccd715107d9`; loading the pinned
  graph exposes inputs `spec`/`feat_erb`/`feat_spec` and output `spec_enhanced`
  (`models.lock.json:66-69,92-95`).

Why this is worth keeping: `desert-ant-core` is source-available, and a port that carries
constants from its Swift sources into TypeScript is a derivative of those sources. Recording the
commit, the exact files and the line ranges — as this lock does — makes the derivation auditable
and the licence basis explicit. It is the pattern the remaining model ports should follow.

**Snapshot 9 — 2026-11-14 14:27, Phase 4 first model (moderator): GREEN** (exit 0, Node v24.11.0,
effect 4.1.2):

```
Package                       Phase  Build  Typecheck  Tests  Result
----------------------------  -----  -----  ---------  -----  ------
tool-mode-runtime-core        0      PASS   PASS       PASS   PASS
tool-mode-runtime-processors  1      PASS   PASS       PASS   PASS
tool-mode-runtime-litert      1      PASS   PASS       PASS   PASS
tool-mode-runtime-dsh         0      PASS   PASS       PASS   PASS
tool-mode-runtime-recipes     2      PASS   PASS       PASS   PASS
tool-mode-runtime-onnx        3      PASS   PASS       PASS   PASS
extension-redact              1      PASS   PASS       PASS   PASS
extension-shapes-recipe       2      N/A    N/A        PASS   PASS
extension-uhm-recipe          3      N/A    N/A        PASS   PASS
extension-clear-recipe        3      N/A    N/A        PASS   PASS
extension-moderator-recipe    4      N/A    N/A        PASS   PASS

11 passed, 0 failed, 0 missing
```

### Phase 4 evidence — moderator

Counts, first-hand:

- `tool-mode-runtime-litert` — **101 tests / 98 pass / 0 fail / 3 skipped**, exit 0, across 12
  suites. The 3 skips are the gated real-asset cases. This is higher than the 97/94 quoted while
  the phase was closing, because moderator added `moderator.test.ts`, `moderator-real.test.ts`,
  `png.test.ts` and `pillow.test.ts` to the package; the number above is the observed one.
- `extension-moderator-recipe` — 31 tests / 31 pass / 0 fail / 0 skipped, exit 0.
- `tool-mode-runtime-onnx` — 134 / 131 pass / 3 skipped, unchanged from snapshot 8.

E2E, run first-hand (`npx tsx scripts/verify-phase4.ts`; asset `.assets/moderator/moderator.tflite`,
9,618,016 B):

```text
registered tool: classify_nsfw
result: {"isNSFW":true,"score":0.5690590739250183,"threshold":0.5,"policy":"standard",
         "quality":"balanced","regions":{"nipples":0.46547797322273254,
         "genitals":0.4234934449195862,"buttocks":0.3186628818511963,
         "nude":0.5690590739250183,"sexAct":0.29443076252937317},"crops":4}
PHASE 4 E2E PASS
EXIT=0
```

As in every LiteRT run here, WebGPU device creation fails (there is no `navigator.gpu` under
Node) and the NPU registry warns; the CPU XNNPACK delegate is what actually executed.

### What this E2E does and does NOT assert

The assertions are **shape-only** (`scripts/verify-phase4.ts:105-110`): `score` is a finite
number, `isNSFW` is a boolean, and each of the five region heads is a finite number. Nothing
asserts a value, a threshold outcome, or any accuracy property.

The input is a **generated uniform mid-grey 512x384 PNG** — an image containing no anatomy.

**Therefore this snapshot is evidence that the wiring works, and evidence of nothing about
moderation quality.** A uniform grey image is far outside the training distribution, and the
model still returns `isNSFW: true` at 0.569 against a 0.5 threshold. Owner-reported probes of
solid black and solid white score 0.368 and 0.316. A detector that calls a blank grey field
NSFW is showing out-of-distribution behaviour; that is a recorded limitation, not a pass grade.

Do not cite this run as moderator accuracy. An accuracy claim needs labelled real images with
known ground truth (positives and negatives), a stated threshold policy, and a measured
confusion matrix — none of which exists yet. A synthetic mid-grey field is arguably the worst
available probe for it, because it cannot separate "the model detects nudity" from "the model
responds to an unusual image at all".

**Snapshot 10 — 2026-11-14 16:08, Phase 4 ear: GREEN** (exit 0, Node v24.11.0, effect 4.1.2):

```
Package                       Phase  Build  Typecheck  Tests  Result
----------------------------  -----  -----  ---------  -----  ------
tool-mode-runtime-core        0      PASS   PASS       PASS   PASS
tool-mode-runtime-processors  1      PASS   PASS       PASS   PASS
tool-mode-runtime-litert      1      PASS   PASS       PASS   PASS
tool-mode-runtime-dsh         0      PASS   PASS       PASS   PASS
tool-mode-runtime-recipes     2      PASS   PASS       PASS   PASS
tool-mode-runtime-onnx        3      PASS   PASS       PASS   PASS
extension-redact              1      PASS   PASS       PASS   PASS
extension-shapes-recipe       2      N/A    N/A        PASS   PASS
extension-uhm-recipe          3      N/A    N/A        PASS   PASS
extension-clear-recipe        3      N/A    N/A        PASS   PASS
extension-moderator-recipe    4      N/A    N/A        PASS   PASS
extension-ear-recipe          4      N/A    N/A        PASS   PASS

12 passed, 0 failed, 0 missing
```

### Phase 4 ear evidence

Counts, first-hand:

- `tool-mode-runtime-litert` — **141 tests / 137 pass / 0 fail / 4 skipped**, exit 0, across 16
  suites (ear added `mel-v1` alongside redact, moderator, and the provider factories). The 4
  skips are the gated real-asset cases.
- `extension-ear-recipe` — 30 tests / 30 pass / 0 fail / 0 skipped, exit 0.

E2E, run first-hand (`npx tsx scripts/verify-phase4-ear.ts`; assets `.assets/ear`:
`ear.tflite` 10,671,552 B, `mel_filters.f32` 64,328 B, `ear_meta.json`, `languages.json`):

```text
registered tool: identify_language
result: {"language":"en","confidence":0.30894988847297555,"isReliable":false,
         "candidates":[{"language":"en","probability":0.30894988847297555},
                       {"language":"ca","probability":0.13427861870686575},
                       {"language":"ms","probability":0.06712772097043394},
                       {"language":"sv","probability":0.03805977495654931},
                       {"language":"eu","probability":0.0342286941967079}],
         "windows":1}
PHASE 4 EAR E2E PASS
EXIT=0
```

The input is a 3-second synthetic tone, i.e. no speech at all.

### What this E2E does and does NOT assert

`scripts/verify-phase4-ear.ts:99-103` asserts shape and domain only: `language` is a string in
the model's canonical label set, `confidence` is finite, `isReliable` is a boolean, `candidates`
has 1 to 5 entries, and `windows` is a positive integer. Nothing asserts that the language is
the correct one for the input, nor that `isReliable` takes either value.

**So this is wiring evidence, not accuracy.** But it differs from the moderator run in one
respect worth recording: the *result itself* is semantically appropriate. A synthetic tone
carries no language, so a 0.309 top score with `isReliable: false` is exactly what an honest
detector should return — the model declined to claim reliability rather than asserting a
language. That is a sanity signal about the abstention path, not a measurement of language
identification.

To claim any accuracy here we would need real speech in known languages, including short clips
and non-speech controls, with a measured per-language confusion matrix. One synthetic tone
cannot support that, and the label-space check would pass even for a badly miscalibrated model.

### Correction — ear timeout raised to 300 s (task-24 reopened, completed at rev 6)

Snapshot 10 was taken before this change. It records the passing state but not the latency
constraint that was found immediately afterwards, so it is corrected here rather than rewritten:
a timeout that only just clears the measured runtime is a latent flake, not a pass.

**Change:** `recipes/identify-language.json:21` now sets `"timeoutMs": 300000` (was `120000`).

**Why:** the real default 3-window inference measured **98.97 s** on this Windows / WASM / XNNPACK
host — roughly 33 s per 30 s window. Against a 120 s budget that is about 20 % headroom (~21 s),
so a slightly slower host, a longer clip, or extra load would fail a call that is behaving
correctly. The ceiling was raised rather than the work reduced because the cost is the model's,
not ours.

**Companion changes, and only these three** — verified by reading them, not from the report:

- `tests/recipe.test.ts:80` pins the new value: `assert.equal(recipe.limits.timeoutMs, 300000)`.
  The assertion is exact, so a silent regression back to 120 s fails the suite.
- `skills/identify-language/SKILL.md:24` documents the cost for callers: `300 seconds - plan for
  the call instead of assuming it returns immediately.`
- the recipe JSON itself, above.

**Package tests remain 30 / 30.** Re-run by the verifier on 2026-11-14 after the change: 30 tests,
30 pass, 0 fail, 0 skipped, exit 0.

**Post-ear full suite** (owner-reported, not run by this gate): 3405 tests / 3382 pass / 0 fail /
23 skipped; architecture and manifests green.

**Snapshot 11 — 2026-11-14 16:54, Phase 4 emo: GREEN** (exit 0, Node v24.11.0, effect 4.1.2):

```
Package                       Phase  Build  Typecheck  Tests  Result
----------------------------  -----  -----  ---------  -----  ------
tool-mode-runtime-core        0      PASS   PASS       PASS   PASS
tool-mode-runtime-processors  1      PASS   PASS       PASS   PASS
tool-mode-runtime-litert      1      PASS   PASS       PASS   PASS
tool-mode-runtime-dsh         0      PASS   PASS       PASS   PASS
tool-mode-runtime-recipes     2      PASS   PASS       PASS   PASS
tool-mode-runtime-onnx        3      PASS   PASS       PASS   PASS
extension-redact              1      PASS   PASS       PASS   PASS
extension-shapes-recipe       2      N/A    N/A        PASS   PASS
extension-uhm-recipe          3      N/A    N/A        PASS   PASS
extension-clear-recipe        3      N/A    N/A        PASS   PASS
extension-moderator-recipe    4      N/A    N/A        PASS   PASS
extension-ear-recipe          4      N/A    N/A        PASS   PASS
extension-emo-recipe          4      N/A    N/A        PASS   PASS

13 passed, 0 failed, 0 missing
```

### Phase 4 emo evidence

Counts, first-hand:

- `tool-mode-runtime-litert` — **167 tests / 162 pass / 0 fail / 5 skipped**, exit 0, across 19
  suites. emo added `text-v1` (EMTK SemTokenizer + FNV n-gram featurizer) beside redact,
  moderator, ear, and the provider factories. The 5 skips are the gated real-asset cases.
- `extension-emo-recipe` — 31 tests / 31 pass / 0 fail / 0 skipped, exit 0.

E2E, run first-hand (`npx tsx scripts/verify-phase4-emo.ts`; assets `.assets/emo`: `emo.tflite`
10,222,736 B, `emo_tokenizer.bin` 733,197 B, `emo_meta.json` 6,280 B):

```text
registered tool: suggest_emojis
result: {"suggestions":[{"emoji":"💰","confidence":0.6544151902198792},
                       {"emoji":"📄","confidence":0.10537077486515045},
                       {"emoji":"💳","confidence":0.0435272715985775},
                       {"emoji":"💶","confidence":0.03441593050956726},
                       {"emoji":"🏠","confidence":0.01958029717206955}],
         "labels":812}
PHASE 4 EMO E2E PASS
EXIT=0
```

Input was the sentence `pay my bills`.

### What this E2E does and does NOT assert

`scripts/verify-phase4-emo.ts:71-76` asserts shape and domain only: `suggestions` has 1 to 5
entries, each `emoji` is a non-empty string, each `confidence` is finite, and `labels === 812`.
Nothing asserts that any suggestion is *appropriate* for the input.

**So this is wiring evidence, not accuracy.** Two further caveats belong next to it:

1. **The confidence values are uncalibrated**, and the package's own lock says so:
   `models.lock.json` describes confidence as "the label's raw softmax probability and is
   explicitly uncalibrated". A 0.654 is therefore a relative ranking, not a 65 % chance of being
   right, and it must not be read as one.
2. **The exact Swift ↔ JS equivalence of the NFKC normalisation and the featurizer is NOT
   independently proven.** The host-side `emo/text-v1` port was written from
   `Sources/Emo/Tokenizer.swift`; nothing here compares its output against the Swift
   implementation on identical inputs. If NFKC folding, the Viterbi segmentation, or the FNV-64
   n-gram bucketing diverged, the model would still emit well-shaped suggestions — a shape-only
   assertion cannot see that. Proving equivalence needs golden vectors produced by the reference
   implementation on the same inputs, not an eyeball on one sentence.

### Semantic sanity signal (not an accuracy metric)

For the input `pay my bills` the top suggestion is 💰 at 0.654, followed by a long tail (📄 0.105,
💳 0.044, 💶 0.034, 🏠 0.020). Money is the right frame for that sentence, and three of the top
four suggestions are money-adjacent — so the pipeline is plausibly doing what it claims rather
than emitting arbitrary labels. That is corroboration that the port is broadly correct,
and it is the strongest evidence available while the Swift ↔ JS equivalence above remains
unproven. It is recorded as a sanity signal, deliberately **not** as an accuracy figure: one
sentence, no ground-truth label set, no confusion matrix, and an uncalibrated score.

### Provenance of the emo processor

- repository `https://github.com/Desert-Ant-Labs/desert-ant-core`, commit
  `baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7`, fetched 2026-11-14
  (`packages/extension-emo-recipe/models.lock.json:111-120`)
  - `Sources/Emo/Tokenizer.swift` L5-43, L45-110, L112-163, L166-203, L205-242, L251-260, L276-366
  - `Sources/Emo/Model.swift` L19-30, L33-79
  - `Sources/Emo/EmoMeta.swift` L7-35
  - `Sources/Emo/Emo.swift` L38-43, L109-120
- artifact: model revision `7c2e137cb0300ecf8e31b7deab4c4e9734d06b74`, sha256
  `2c382e8da94bab64172c0694b0350abb96829bf89eb623008ed0085128621de2`
- processor contract as pinned: EMTK SemTokenizer (Viterbi maxLen 24, NFKC lowercase,
  `sem_pad_index` 48000, at most 64 ids + float32 `[1,64]` mask), host-side FNV-64 n-gram
  hashing (five bucket seeds, importance seed `0xFF51AFD7ED558CCD`, fmax 512, 3 hashes) producing
  the four n-gram feeds; outputs `float32 [812]`. Emoji strings are read from
  `emo_meta.json labels[index]`, never hardcoded, and a meta/model count mismatch is
  `RuntimeUnavailable` rather than a truncation.

This is the same source-available provenance pattern as clear: the port is a derivative of named
Swift sources at a pinned commit, so the commit and line ranges are recorded to keep the
derivation auditable.

Re-run the gate when any package changes; replace this snapshot rather than appending.
