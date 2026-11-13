# Audit: “Executor v2 and dsh-tool-mode — architecture analysis and comparative review”

**Audit date:** 2026-11-13  
**Report under review:** the supplied comparison dated 2026-11-12, which studied
dsh at `b8d13b9` / `0.4.7` and Executor at `dff3b77` / `apps@0.0.1-beta.122`.  
**Current dsh:** `5f4a332`, package `0.5.43`, working tree **dirty**.  
**Executor:** materialized at the exact commit `dff3b77` for this audit.

**Method.** Four independent lanes: dsh claims, Executor claims, recommendations,
and a red-team. The Lead reconciled contradictions and fixed two repo artifacts
the audit exposed. No Executor tests were run (the export has no `node_modules`);
all Executor claims are source/read checks. dsh counts are file-evidence counts,
plus a `verify:verification` run.

**Bottom line.** The report is a strong *reading* of both architectures and a weak
*comparison*. Most Executor mechanics are accurate (24/29 claims verified).
The dsh half is materially stale (6/30 stale, 5/30 false), and two of its four
headline “gaps” were already false at the revision the report itself studied.
The report’s central metric (“12 of 317”), its “19 vs 6” contrast, and its
“convergence explains the agent surface” causal story do not survive audit.

---

## 1. Revision drift is not a footnote; it invalidates the headline

- dsh is **26 commits** past the studied revision: `b8d13b9` / 0.4.7 → `5f4a332` / 0.5.43.
- Current inventory: **317 items** (227 normative + 90 acceptance).
  Current status: **309 done, 0 partial, 8 blocked, 0 never started**
  (`verification/requirements.json`, `verification/FINAL-REPORT.md:8`, `README.md:14-15`).
- The report’s `12 done / 250 partial / 4 blocked / 51 never started` was the
  real 0.4.7 state (reproducible with `git show b8d13b9:verification/FINAL-REPORT.md`),
  but it is not the current state. Its “README says 18/252/3/44” was also a real
  earlier snapshot; both files now agree at 309/0/8.
- Consequence: the §6 thesis — “turn 12 of 317 into something defensible” — argues
  against a baseline that no longer exists. The current baseline is 309/0/8.

The current working tree is **dirty**, and `FINAL-REPORT.md` says so itself:
“this describes a state that exists in no commit.” That is a stronger provenance
problem than the report identified: the generated numbers are current, but the
artifact is not reproducible from the named commit.

**Repo drift the audit exposed and the Lead fixed:** the 0.5.43 version bump left
README and FINAL-REPORT printing 0.5.42, so `gen-final-report --check` failed.
The Lead regenerated the verification artifacts and updated the README version;
`verify:verification` now passes. The generator’s contradictory sentence (“Most of
the normative requirements are unimplemented” beside 309 done) was also replaced
with count-derived prose.

---

## 2. Claim scoreboards

### dsh-tool-mode — 30 claims audited

| Verdict | Count | Examples |
| --- | ---: | --- |
| CONFIRMED | 10 | 317 inventory; 17 contracts; 2/18 runnable; capability not branched; contract semver; architecture gate; strict native schema |
| STALE | 6 | 12/250/4/51; README 18/252/3/44; README-vs-report drift; line references |
| FALSE | 5 | “no receipts”; “downloads are not authorization”; “paths unvalidated”; strict-vs-loose schema framing; current report freshness |
| NUANCED | 8 | “19 tools”; native surface; both model_tools schemas; durable receipts; approvals; lifecycle |
| UNVERIFIABLE | 1 | §4.3 absent from the supplied working copy |

The false-at-baseline findings matter most:

- **“No execution receipts.”** `receipt.ts` existed at `b8d13b9` and is wired through
  bindings/headless/index. What is missing is **durability and idempotency**, not receipts.
- **“Downloads are not an authorization event.”** `prepared-assets.ts` already had
  plan → approval gate → digest verify → atomic acquisition → `prepared-cold` at the
  studied baseline, wired into the extension service.
- **“File arguments are unvalidated paths.”** `authority.ts` already had
  `authorizePath` / `realpathSync` / `approvedRoots` at the baseline.

So the report’s “four Executor mechanisms map onto four dsh gaps” is half-wrong:
only **manifest derivation** is a fresh gap as stated; **input-conditioned approval**
is real but the module is unwired; **surface** is real but not “19 vs 2”; **receipts**
and **download authorization** were already present.

### Executor v2 — 29 claims audited

| Verdict | Count |
| --- | ---: |
| VERIFIED | 24 |
| QUALIFIED | 3 |
| DISCREPANCY | 1 |
| UNVERIFIABLE | 1 |

Verified exactly: 133-line app contract, six MCP tools in default mode, 65,536-char /
100-call / 5-minute code-mode limits, `unavailableApps`, decoded-input approvals,
non-replaying resume, workerd on all three hosts, WorkerLoader, per-app supervisor,
six BuildStages, `bundleAccounts`, durable `step.do` with same-transaction receipts,
at-least-once events with 3-day retention/~4.5h retry, 45s webhooks, protocols 1..14,
and the E2E-only rule.

Qualifications the report should absorb:

- **“Ordinary routers” is overstated.** `liveOpenapiRouter` returns
  `RouterDeclaration` synchronously; `mcpRouter`/`graphqlRouter` return
  `Promise<RouterDeclaration>`. They are composable declarations, not bare routers.
- **“Gated in CI” is unproven.** The protocol check is in `bun run check`, but the
  export contains no CI workflow files.
- **“No fetch/process/fs/imports/timers” is unverified.** CodeMode is a pinned AST
  interpreter; no repo test/doc asserts that specific denial set.
- **“Branch v2” is unverified.** The commit exists and is detached; the export has
  `main` and tag `v1.5.35`, not a `v2` branch.
- **Executor’s own README contradicts its code:** it says “two tools, skills and
  execute” while the contracts define six. The report credits six but does not use
  the README inconsistency symmetrically against its “converged” story.

---

## 3. The three comparative claims that fail

### 3.1 “19 vs 6” compares different nouns

- 17 `STANDARD_CONTRACTS` + `model_tools` + `tool_mode_run` = **19** is the
  **headless grant/published list**, not the live native surface.
- Headless registers only contracts with a runnable binding. On this reference host
  (2/18 runnable) that is **4 tools**: `lang_detect`, `stt_transcribe`,
  `model_tools`, `tool_mode_run`.
- Native MCP is a variable set: resolved contracts + extension tools +
  `tool_mode_list`/`tool_mode_describe` + decision tools + optional Jev +
  conditional `tool_mode_run`; `model_tools` is withheld by design.
- Executor’s six tools are **meta-tools over an unbounded app catalog**, not six
  capabilities. “Fixed-size” is a property of its access layer, not its capability
  surface.

Correct comparison: **live agent-facing tools at a named host** (dsh ~4, Executor 6
meta-tools over N app tools), plus a separate **declared capability ceiling** (dsh 17
contracts, 19 headless grants). The report mixes ceiling and live surface.

### 3.2 “Strict native vs loose headless” is the wrong asymmetry

Both definitions exist and differ, but:

- Headless **input** is the stricter one: `additionalProperties:false, properties:{}`
  (accepts no arguments).
- Only the headless **output item** is open (`models: array<object additionalProperties:true>`).
- Native input is action-rich; native output items are closed.

So the drift is real but narrow: an output-item shape asymmetry, not “strict schema vs
loose schema.” The same code existed at `b8d13b9`, so the report’s characterization
would not have survived its own baseline check.

### 3.3 “Better epistemics” is partly contradicted by dsh’s own artifact

The generated report said **309 done / 0 partial / 8 blocked** while its next sentence
said **“Most of the normative requirements are unimplemented.”** That was a hardcoded
generator constant, not evidence. The report’s claim that dsh has better epistemics is
directionally defensible (release gate vs suite distinction; explicit blocked items;
scope-of-claim precision), but the artifact it cites was self-contradictory. The Lead
has now replaced that sentence with count-derived prose.

---

## 4. Recommendations: keep one, revise six, drop four

| ID | Verdict | Why |
| --- | --- | --- |
| 5.1 Derive manifests | REVISE | Duplication is real (9 hand-written manifests; identity repeated in `tools[]`/`implementations[]`; `defineExtension` validates only). But deriving extension manifests does **not** fix the host’s native-vs-headless schema asymmetry. Narrow it to per-extension manifest generation + check. |
| 5.2 Fixed-size surface | REVISE | Surface inversion is **already implemented** in headless (4 live). Only “reasons in call results” remains: a withheld tool call currently returns a bare “Tool … not found.” |
| 5.3 Input-conditioned approvals | REVISE | Real gap, but `approval.ts` has **zero production importers** and is scope-bound, not decoded-input-bound. Wire the existing module first; do not port elicitation/pause-resume yet. |
| 5.4 Receipts-as-durable-steps | REVISE | “No receipts” is false; receipts are an in-memory 200-ring. The real slice is durable persistence + an idempotency key for acquisition, not a workflow engine. |
| 5.5 Capability versioning | DROP | Capability is a display-only string and nothing branches on it. Executor versions protocols, not capability ids; there is no analogue to copy. |
| 5.6 Lazy pinned skills | DROP | Solves remote app-scoped skills; dsh has 9 local model skills and no app catalog. No mechanism to transfer. |
| 5.7 Shared credentials | DROP | Requires an app/user account model dsh does not have. |
| 5.8 Reasons in results | KEEP | Small, accurate, testable: return the recorded withholding reason instead of “not found.” |
| 5.9 Generate Executor status | DROP for dsh | Advice to the other project; dsh already generates its own status. |
| 5.10 Suite green vs scope complete | REVISE | Two layers exist; the defect is stale counts/prose, not a missing distinction. |
| 5.11 Machine-readable non-capabilities | REVISE narrow | `unsupported[]`/`semantics` already exist on contracts; `tool_mode_describe` simply omits them. Surface them. |

### §6 v2 core

Of the proposed 8 items:

- **Already done as work items:** 1 (`lang_detect` + `stt_transcribe` end-to-end),
  6 (surface half), 8 (root-allow-listed paths).
- **Already true:** 7 (one extension-SDK lifecycle strategy).
- **Load-bearing but unevidenced:** 2 — two packages already implement `text.title`
  and `image.describe`, but there is no recorded **swap proof** that disabling one
  makes the other serve the same contract. This is the only item that proves
  substitutability, and it needs no new mechanism.
- **Keep:** 2 (record the swap), 3 (narrowed derivation), 4 (durable receipts +
  idempotency), 5 (wire approvals first), 6 (reasons-only).

The claim that the core “converts four gaps into three Executor mechanisms” is
overstated: only item 2 tests the central abstraction, and it is an experiment, not
an architecture.

---

## 5. What the report gets right

- The Executor architecture reading is substantially accurate: one app primitive,
  six-surface declaration, workerd on all hosts, BuildStage derivation, durable
  steps, code mode, decoded-input approvals, fixed-size access layer.
- The dsh layer distinction is real: model-free contracts → public SDK →
  model-specific extensions, enforced by `verify:architecture`.
- The four-gap *intuitions* are useful even where the baseline is wrong: manifest
  duplication, surface proliferation, authorization as an event, and receipts as
  idempotency are all good lenses.
- “Suite green ≠ scope complete” is a genuine governance insight, even if dsh’s
  current counts and prose no longer match the report’s numbers.
- The recommendation to prove substitutability before growing the catalog is the
  single best strategic line in the report.

---

## 6. Corrected verdict

**Executor** is a converged product with a deliberately narrow access layer; its
architecture claims mostly check out, but its own README undercounts its tool surface
and “branch v2” is not in the public export.

**dsh-tool-mode** is a broad conformance/specification project with real
architecture discipline, a credible test/verification culture, and a live surface much
smaller than the report’s “19.” Its current status is **309/317 done, 8 blocked**, not
12/317. Its genuine remaining gaps are narrower than the report claims: derived
extension manifests, durable receipts/idempotency, wiring approvals, and withholding
reasons in call results.

**The report should be rebased, not retracted.** Keep the architecture reading and the
four lenses; delete the stale baseline, the ceiling-vs-live “19 vs 6” contrast, the
“strict vs loose” schema characterization, and the causal claim that convergence
explains the agent surface. Then add the one experiment the comparison actually needs:
**swap two implementations of the same contract and record the proof.**

---

## 7. Evidence

Lane reports (read-only, same checkout):

- [dsh-claims.md](.agent-scratch/audit/dsh-claims.md) — 30 claims, current file:line evidence.
- [executor-claims.md](.agent-scratch/audit/executor-claims.md) — 29 claims at `dff3b77`.
- [recommendations.md](.agent-scratch/audit/recommendations.md) — §5/§6 audit and falsifying tests.
- [redteam.md](.agent-scratch/audit/redteam.md) — framing, metric validity, selection bias.

Repo artifacts changed as a result of the audit: `README.md` version row,
`verification/FINAL-REPORT.md`, `verification/evidence.json`,
`verification/RELEASE-REPORT.md`, and `scripts/gen-final-report.mjs` (count-derived
objective prose). After regeneration, full `npm run verify` is **EXIT 0**:
**2,712 tests, 2,697 pass, 0 fail, 15 skipped**, with 317 requirements / 309 PASS
and traceability current.
