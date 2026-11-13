# Implementation audit — 2026-11-01

**Scope:** `dsh-tool-mode` against the 317 items in the Tool Mode verification
inventory.
**Method:** four independent read-only audit lanes plus Lead cross-checks. No product
code, tests, verification JSON or generated reports were modified.

Raw lane reports:

- [.agent-scratch/audit/requirements.md](../.agent-scratch/audit/requirements.md)
- [.agent-scratch/audit/runtime.md](../.agent-scratch/audit/runtime.md)
- [.agent-scratch/audit/features.md](../.agent-scratch/audit/features.md)
- [.agent-scratch/audit/models-extensions.md](../.agent-scratch/audit/models-extensions.md)

> **Post-audit update (2026-11-02):** the verification truth layer and stale statuses
> have been repaired; **the entire BASE family (14/14) and the entire MCP family (13/13)
> are DONE**; CODE-01/06/07/08/10/12 close on the real PTC runtime, DECL-08 carries
> byte-derived recipe digests, alongside EXT-32, EXT-34, HLM-10, P26-14, SEC-09,
> DEC-03, DEC-04, DEC-05, DEC-06, DEC-08, DECL-05, DECL-06 and DECL-07; DEC-07 (Jev),
> CODE-09 (Windows confinement acceptance), CODE-04 (pinned PTC runtime lacks a
> structured-data path) and HLM-14 (zero live vision routes) are named
> external/operator blocks. DECL-03 closes with the shared meta envelope embedded in
> every contract schema.
> `status.json` is **220 DONE / 0 PARTIAL / 0 NOT_RUN / 7 BLOCKED** over 227 normative
> rows; the generated 317-item tally is **309 PASS / 0 FAIL / 8 BLOCKED / 0 NOT_RUN**
> after the acceptance-test re-audit (89 AT promoted to DONE, 1 operator-blocked,
> 0 AT remainders; every remaining red row is externally/operator-blocked).
> MOD-16/MOD-19/MOD-17 are corrected from NOT_RUN to PARTIAL
> with their real remainders; TDD-02 likewise; TDD-08 is blocked on an operator-supplied
> Laya checkpoint/statistical run. The report below preserves the
> audit-time findings; see
> [status-reaudit-2026-11-01.md](tool-mode/status-reaudit-2026-11-01.md) for the
> row-by-row decisions.

## The short answer

The README's **18 done / 252 partial / 3 blocked / 44 never started** is the
current recorded tally and is internally consistent with
`verification/evidence.json` and `verification/RELEASE-REPORT.md`.

It is **not a test score, not a stable release verdict, and not a complete
picture of the repository**:

- The 252 are **PARTIAL requirements**, not 252 failing tests. The generated
  `FAIL` label is a projection: `DONE→PASS`, `PARTIAL→FAIL`.
- The status snapshot is **frozen at `verifiedAt 2026-10-16`**, while the code is
  at 0.5.42 and roughly 42 commits later. Multiple records are contradicted by
  shipped code.
- `verification/FINAL-REPORT.md`, linked from the README as the authoritative
  summary, is **stale**: it says 12/250/4/51 and excludes six requirements now
  marked DONE.
- The code that exists is substantially healthier than the score suggests:
  the package suite is green, the built artifact runs a real Tongue inference,
  and 20 extension tools are declared across 8 extensions.

**Best current statement:** the recorded status is a provisional, under-claimed
baseline; the release gate remains correctly red, but the number needs
re-adjudication before it is quoted externally.

## Trustworthy counts

| Item | Count |
|---|---:|
| Total tracked | 317 |
| Normative requirements | 227 |
| Acceptance tests (AT-01..AT-90) | 90 |
| DONE / PASS | 18 |
| PARTIAL / derived FAIL | 252 |
| BLOCKED | 3 |
| NOT_RUN | 44 |
| Normative split | 18 DONE, 186 PARTIAL, 3 BLOCKED, 20 NOT_RUN |
| Acceptance split | 0 DONE, 66 PARTIAL, 24 NOT_RUN |

The arithmetic is consistent across `README.md:12-14`,
`verification/requirements.json`, `verification/evidence.json:78-84`,
`verification/RELEASE-REPORT.md:27-35` and `docs/tool-mode/TRACEABILITY.md`.

`verification/evidence.json` contains **no test names, exit codes, durations or
observed test outcomes**. `testStatus` is derived from `requirementStatus` by
`scripts/gen-verification.mjs:227-233`; the `command` field is the hardcoded
string `npm run verify`. It is a status record, not proof that a suite ran.

## Current executable state (Lead cross-check)

| Check | Result |
|---|---|
| Package suite (`npx tsx --test packages/dsh-tool-mode/tests/*.test.ts`) | **1403 tests, 1400 pass, 0 fail, 3 skipped** |
| `npm run verify:built` | **PASS** — real Tongue inference: `"kann ich das haben" -> de`; 18 models, 2 runnable, 2 installed |
| `npm run verify:architecture` | **PASS** — no model-specific host code; extensions use only the published SDK |
| `npm run verify:verification` | **FAIL (exit 1)** — `verification/models.lock.json` is stale |
| Runtime audit corroboration | **76/77 pass, 0 fail, 1 skipped** across MCP OAuth, credentials, v2 interop, PTC composition, headless serve and Laya |
| Release gate | **RED by design** — 18 of 317 not PASS |

The `models.lock` failure is additionally a gate bug: `gen-models-index.mjs
--check` prints `models-index OK — ... current` after reporting the file stale,
then exits 1. A reader of the last line would believe the gate passed.

## Recorded status vs current code

### Status-changing staleness

At minimum these recorded statuses are contradicted by shipped code:

| ID | Recorded | Contradiction | Defensible correction |
|---|---|---|---|
| MODEL-02 | BLOCKED | `extension-laya` now registers `decision_choose/test/score`; `qualification/laya.json` records 3 real calls | Not blocked; PARTIAL or DONE |
| TOOL-02 | BLOCKED | Same Laya decision-tool evidence | Not blocked |
| MODEL-03 | BLOCKED | `extension-needle` declares `tools_plan` / `structured_extract` with contracts | Blocker condition no longer stated |
| MOD-11 | NOT_RUN | `semantic_classify` is declared and implemented (`extension-embeddinggemma/tool-mode.extension.json:73-74`) | At least PARTIAL |
| MOD-12 | PARTIAL | `semantic_deduplicate` is declared; "tool not registered" is false | New remainder or DONE |
| TOOL-06 | PARTIAL | `tool-mode-harness-text` ships `text_title`; "no package" is false | DONE candidate |

After these are re-adjudicated, a defensible provisional range is
**DONE 18–20, PARTIAL 253–255, BLOCKED 0–1, NOT_RUN 43–44**. Do not publish a
single corrected number until the rows are actually re-recorded.

### Stale clauses inside otherwise-correct statuses

The lanes found **40+ stale sub-clauses**, not 40+ wrong overall statuses:

- **Runtime/core (26):** ARCH-01/03/06, BASE-11, TOOL-02/06, RUN-01/03/05/06/08,
  RES-02/04/08, SEC-02/03/04/07/09, OBS-02/04, TDD-02/05, AT-03/04/09.
- **Models/extensions (23):** MODEL-01/03, MOD-02/06/07/09/10/11/12/14/15/19,
  NDL-08, LIC-01/02, EXT-06/07/08/13/15/25/31/34.
- **Features (13):** CODE-02/08, MCP-01/04/06/08/09, P26-01/03/06/13/17,
  DECL-06.
- **Evidence-only stale rows:** MOD-20 says 3 tools and text/code only; the
  manifest declares 6 tools and supports image/audio/video. DEC-01/02 are DONE
  while the same TRACEABILITY cells still carry "VERIFIED BLOCKER".

These are worth re-adjudicating before the next report. Several are
"production-wired but one named remainder remains"; those stay PARTIAL.

## What actually works

- **Eight first-party extension packages**, declaring **20 tools**:
  tongue (1), voz (1), laya (3), needle (4), minilm-embed (1),
  minilm-rerank (1), embeddinggemma (7), declarative-recipes (2).
- **Tongue** is the strongest local proof: bundled weights, real inference in
  the built artifact.
- **Laya** decision tools exist on the vendored `laya-ts` route with measured
  digests and recorded real calls.
- **MCP** has live socket conformance, official v2 SDK interop with real
  inference, live Ajv schema validation, SSE/progress, per-client grants, and
  catalog-change notification tests.
- **Code Mode** executes real PTC programs through the registry; the
  `tool_mode_run` gate opens from recorded confinement evidence.
- **Custom tools and Tool Insights** are implemented, but they are **outside
  the 317-item checklist**; 1403-test suite includes them while the 18/252 tally
  does not.

"2 runnable models" is a **capability/route** claim. The checkout contains no
vendor model package; Voz additionally needs a ~367 MB first-load download.
Four providers report `prepared-cold` on resolvability without asset evidence,
so "active + tool listed" does not mean runnable. Laya cannot prepare from prose
sources; needle is executable-approval gated; embeddinggemma needs ~2.96 GB;
the MiniLM pair need preparation; declarative recipes need a harness provider.

## Highest-value genuine gaps

1. **BASE-06** — `mcpV3.exportTools` is dead configuration: declared, never
   read, while a comment claims it gates MCP publication. Wire or remove it.
2. **MCP-11** — no confidentiality mechanism on the tool-result path.
3. **HLM-10** — usage aggregation is entirely absent.
4. **HLM-02/HLM-03** — no caller-model capture, no per-client server-owned
   executor profile.
5. **DEC-07/DEC-08** — no Jev native-semantics verification or decision-quality
   evaluation; DEC-03/04 provider-key mapping and probability-vector validation
   are missing.
6. **DECL-01/03/04/05/08** — contract examples, Code Mode type generation,
   discoverable metadata schema, recipe digest and per-recipe revocation.
7. **P26-14** — `catalogTtlMs` / `catalogCacheScope` are declared but unused;
   responses hard-code `ttlMs:0`.
8. **CODE-11/HLM-07** — nested repair/model budget charging.
9. **RES-05/RES-04** — preparation state exists but no real model load path
   consumes it.
10. **SEC-01/SEC-04** — per-client authorization exists; per-client resource and
    credential isolation do not.
11. **BASE-07/SEC-09** — discovery and mutation still share one `model_tools`
    surface.

## Verification-pipeline defects

| # | Defect |
|---|---|
| 1 | `FINAL-REPORT.md` is stale (12/250/4/51), untimestamped, and never checked or regenerated by `verify`; it also hardcodes package versions 0.1.x in its generator. |
| 2 | `gen-verification --check` compares **requirement IDs only**, not statuses, evidence, counts or reports. Status edits can drift while the gate prints "up to date". |
| 3 | `testStatus` is a vocabulary alias for `requirementStatus`; the artifact cannot distinguish incomplete implementation from a failing test. |
| 4 | `evidence.json` has no per-suite observations, contrary to its TDD-09 description. |
| 5 | All 90 AT `evidence` fields are objects (`{status,evidence}`), not strings, because `gen-verification.mjs:291` stores the wrong shape. |
| 6 | 81/317 summaries are empty from a spec-regex failure (`**BASE-01.** text`); `requiredPlatform` is inferred from the same summary and silently defaults to `any`. |
| 7 | 159/317 rows have no real owned module: 42 "not implemented" (including 4 DONE rows) and 107 "unmapped". |
| 8 | `RELEASE-REPORT.md` labels the derived PASS/FAIL table "Requirement status" and hardcodes "not yet run against a real inference/recording" despite real Tongue and Voz evidence; a test enforces the false phrase. |
| 9 | `TRACEABILITY.md` concatenates stale notes into the status cell, so DEC-01/02 read "DONE … VERIFIED BLOCKER". |
| 10 | `gen-models-index --check` prints OK after detecting staleness, then exits 1. |
| 11 | Root README's published-package table still says 0.1.3/0.1.0/0.1.0 while the current identities are 0.5.42/0.1.0/0.1.4; generated package identities disagree across artifacts. |

## Recommended order of work

1. **Stop quoting a precise done count externally** until the six status rows
   are re-adjudicated. Keep "release gate RED".
2. Regenerate `FINAL-REPORT.md`; add a `final-report --check` gate; make the
   generator read package identities instead of hardcoding 0.1.x.
3. Fix the AT evidence shape, summary regex and ownership mapping; make
   `gen-verification --check` compare content, not just IDs.
4. Re-record the six stale statuses and the 40+ stale clauses; regenerate
   traceability.
5. Fix the models-index stale artifact and its misleading OK/exit-1 behavior.
6. Scope the README: 317 covers the Tool Mode specification checklist, not the
   custom-tools/Tool Insights work; state that distinction explicitly.
7. Then address the ranked genuine gaps above, starting with BASE-06 (dead
   security config) and MCP-11/HLM-10.

## Current remaining red (2026-11-02)

At generated tally **309 PASS / 0 FAIL / 8 BLOCKED / 0 NOT_RUN**, every row is either
DONE/PASS or externally/operator-blocked. All 90 acceptance rows are DONE or externally
BLOCKED.

The isolated-temp-DSH-home, real-model and retry checks closed rows that were not truly
external:

- **AT-01 / AT-25 / AT-03 — DONE.** Packed host installed into fresh temp-DSH profiles,
  host-only profile booted without model packages, and profile-configured MCP served
  `server/discover`/`tools/list` with restart and stop.
- **MOD-06/MOD-10 — DONE.** Official EmbeddingGemma task prefixes are implemented as a
  versioned recipe; query/document roles and title formatting are applied by every tool.
- **AT-42/44/45/47 — DONE.** The REAL multimodal suite passed 11/11 (text, image, WAV,
  video, dimensions, group isolation).
- **AT-43 — DONE.** A pinned 768-value golden embedding matches within 1e-5, and
  512/256/128 match golden truncation + L2 renormalization.
- **AT-46 — DONE.** Real cross-modal positives outrank distractors for text→image,
  image→text, text→video and text→audio.
- **AT-41 — DONE.** EmbeddingGemma 2 is a separate first-party TMX package with its own lock;
  its real multimodal adapter and measured artifacts now pass the modality, golden and
  cross-modal suites, so the packaged default is runnable and no host adapter substitutes.
- **AT-10/AT-15 — DONE.** The authorized pipeline now has a repeated-call loop detector
  (`MODEL_LOOP_DETECTED` after 32 identical calls) and a nested-program depth bound
  (`MODEL_NESTED_DEPTH_EXCEEDED` at 4); a real `while (true) {}` program terminates on a
  300 ms deadline in 437 ms.
- **AT-53/55 — DONE.** The pinned Laya checkpoint (6/6 digests) runs through the vendored
  laya-ts ONNX runtime; the standard `decision_choose` returns an option index + confidence
  bucket, and the local path preserves labels/probabilities.
- **AT-26 — DONE.** A clean external-author project installed ONLY the packed SDK/contracts
  and ran an author fixture under plain Node; `npm ls` contains no host or `@deepseek-ai/dsh-*`.
- **AT-06 — DONE.** The official `@modelcontextprotocol/client@2.3.1` modern client connected
  through `dsh-tool-mode mcp-stdio` and completed discover/list/call. This retry fixed a real
  launcher bug (`bridge.start()` did not exist) and added a spawned-launcher regression test.
- **AT-86 — DONE.** The packed at03 profile was exercised by the modern official HTTP client
  and an independent raw probe; `qualification/at86-packed-server.json` records the sanitized
  wire exchange and schemas.
- **AT-30 — DONE.** A CLEAN registry install of the external tongue package published
  `lang_detect` over MCP; the modern client called it through hosted Code Mode and received
  structured `fr` detection with probabilities. This supersedes the earlier native-tool
  evidence and the temporary reopening.
- **AT-08 — DONE.** Real unchanged leaf tools (`text_embed`, native `stt_transcribe`) ran in
  DSH PTC and returned structured fields, not prose.
- **AT-57 — DONE.** Held-out Laya evaluation (8 prompts) is reproducible: coverage 1.000,
  accuracy 0.625, raw-confidence ECE 0.486, recorded uncalibrated with every probability.
- **AT-58 — DONE.** The real pinned Needle engine activates (`tools_plan` published) and the
  prepared provider suite passed 27/27: real planning, extraction, cancellation, timeout and
  output caps. The earlier failure was the install fixture omitting the SDK peer.
- **ARCH-04 — DONE.** The local Voz extension is exposed as one host-local `speechToText`
  provider backed by the same `stt_transcribe` tool/native dispatch; registration and a
  bridged transcription are tested, so no second Voz instance is started.
- **CODE-04 — DONE.** `input` crosses a JSON binding, never source interpolation; the real
  runtime evaluates `input.n * 2`.
- **CODE-09 / AT-14 — DONE.** Windows sandbox passes read-only and workspace-write file
  policy on `D:\DEV\dsh-temp`, and explicit probes deny process, network, unlisted imports
  and host environment secrets. `verify:confinement` is 4/4 accepted.
- **CODE-02 — DONE.** `tool_mode_run` is exported over MCP when the confinement evidence and
  operator consent are both present, with a conforming projection.
- **EXT-31 — DONE.** Running-host per-tool toggle and guarded uninstall.
- **EXT-17 — DONE.** Published corrected SDK 0.1.5 and contracts 0.1.1; a clean
  registry-installed external fixture runs with 17 contracts and no host/DSH dependency.
- **EXT-15 — DONE.** Voz’s lock now pins HF revision ed129427… and six measured assets;
  the network meta.json digest matched the cached bytes.
- **AT-54 — DONE.** Laya maintainer-export artifact binds the source checkpoint/config/
  tokenizer/export hashes, 3/3 parity, and a Python-free packed consumer.
- **AT-17 — DONE.** Live PTC agent + MCP direct calls; a new session stayed Standard.
- **AT-72 / HLM-14 — DONE.** DeepSeek Flash and Kimi k3.1-pro, same recipe and image.
- **HLM-12 — DONE.** Invalid PNGs are refused before inference; valid image facts matched.
- **AT-27 — DONE.** Real matrix: exact npm version, pinned HTTPS tarball and local `.tgz`
  each installed inactive with a digest; the version stays pinned after restart.
- **AT-73 — DONE.** A recipe authored outside the workspace passed
  create → validate → fixture test → pack, then staged inactive into the real at03 store.
- **AT-88 — DONE.** The combined drift gate checks 11 manifests, 7 locks, 36 assets,
  processor identities, 6 recipes and the protocol constant; a bad digest fails by file+field.
- **AT-24 — DONE.** The metadata-only profile writes no bodies and names every residual
  surface; harness no-retention conflicts are denied, and the auxiliary journal records the
  exact request without parent history.
- **AT-62 — DONE.** Two concurrent real Needle callers produced distinct, schema-valid
  proposals while a Windows connection monitor observed zero needle.exe network connections;
  cancellation/overflow and scrubbed telemetry env tests remain green.
- **AT-37 — DONE.** A real mid-inference kill of needle.exe rejects truthfully, leaves no
  orphan process, and a clean retry succeeds.
- **TDD-08 — DONE.** Versioned Laya fixture + quality gate; statistical accuracy is reported
  with a 95% Wilson interval and coverage is gated at 0.9.
- **AT-18 — DONE.** A real published 0.5.41 profile booted, upgraded in place to 0.5.42 and
  booted again; the disabled extension choice and store path survived.
- **AT-40 — DONE.** An independent author module extension ran natively, over direct MCP and
  through hosted Code Mode; the package, schemas and release evidence are archived.
- **AT-87 — DONE.** A genuine TMX 1.0 module package normalized to `execution.kind: module`
  without byte edits, activated and returned `{sum:9}`.
- **AT-74 — DONE.** A declarative title recipe installed INACTIVE, activated in a real host,
  published `text_title` over MCP and served the same tool through hosted Code Mode.
- **AT-52 — DONE.** Added a persistent embedding index that records space/model identity;
  legacy 384-d vectors survive an upgrade and 768-d reuse is refused.
- **AT-75 — DONE.** Malicious recipe validation was covered; the live identity-change probe
  found and fixed a ghost-active row, now recorded `failed` with no tools.
- **AT-66 — DONE.** Caller-model recipes are refused for an external surface without an
  approved server-owned profile and succeed when the grant names it; live generation is optional.
- **SEC-05 — DONE.** A direct MCP call, a concurrent hosted Code Mode composition, and a later
  direct call all succeeded on one host; no presentation toggle or forged parent token.
- **AT-09 — DONE.** Voz transcribed a real WAV and Laya decided on the transcript in one
  local Code Mode program with no harness provider; the title harness half was separately live.
- **AT-19 — DONE.** A real Windows CPU matrix records Voz, Laya, EmbeddingGemma 2
  text/image/audio/video, Needle and preserved MiniLM tools; title/image harness rows are marked remote.
- **AT-21 — DONE.** Voz explicit language requests now refuse undocumented codes; tests cover
  silence, WAV chunk boundaries, byte/duration caps and timestamp omission.
- **AT-63 — DONE.** The canonical declarative image recipe is callable over Native, direct MCP
  and hosted Code Mode; the missing per-client grant/remote-destination seam was implemented.
- **AT-76 — DONE.** Both mixed programs ran with real outputs; the supported `logs` channel
  now carries an authoritative subcall accounting line (3 calls, names/ok/elapsed/previews).
- **AT-22 — DONE.** Title-faithfulness evaluation recorded (5/5 completed titles faithful);
  the 2 long-input truncations are preserved as a quality defect, not hidden.
- **AT-23 — DONE.** Native activation, the MCP export allowlist and the durable distribution
  basis are separate decisions; tests pin the separation and no false consent.
- **TOOL-02 — BLOCKED only on the external Jev artifact.** In-repo standard `decision.choose`
  and full-option revalidation are done.

The remaining 8 BLOCKED rows are the documented external conditions: operator clean-checkout/
release artifacts (AT-90, TDD-10), independent reference/corpus (MOD-16/17), missing
Jev artifact (TOOL-02/DEC-07), and human/release processes (LIC-03, TDD-02). No row
remains PARTIAL or NOT RUN, and no red row was promoted without evidence.

### Remaining normative work plan (historical)

Both previously planned items are resolved: EXT-31 is DONE and TOOL-02's in-repo clauses
are DONE, with only the Jev artifact blocking the row.

## Caveats

Three audit lanes could not execute `pwsh` because their session sandbox failed
with a Windows-ACL temp-grant error; their verdicts are static, source/test-file
based, and say so. The Lead session could execute commands and supplied the
1403-test, built-artifact and verification-gate results above. The runtime lane
also labelled `TOOL-02` as a false blocker, which the Lead's 76/77 corroboration
supports. The 317-inventory status itself is manually curated; no automated
mapping from test names to requirement IDs exists, so "DONE" and "PARTIAL" remain
judgements until that provenance layer is built.
