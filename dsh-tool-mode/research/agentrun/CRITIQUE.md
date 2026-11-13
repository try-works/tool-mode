# Independent critique — TOOL-MODE-FROM-AGENTRUN.md

**Verdict: REVISE.** The thesis (receipts/accounting, media ingress, evaluation) survives, but two
headline claims are false, a citation block does not survive checking, one table row flatters the
repository against its own records, and A1/A3/A4 need feasibility fixes before they are actionable.
Nothing here needs a rewrite; all fixes are local edits.

## MUST-FIX (ranked)

- **M1 §0 / §1.2 "nothing in it runs locally."** False. pi-vision's deterministic path (PDF/office
  text, page rendering, fitting to model limits, frame cutting) runs locally (pi-vision README:57-62,
  96-98; the no-key demo). EXTERNAL-FINDINGS:18 is careful ("nothing runs *fully* local"); the report
  dropped "fully". **Fix:** "no model inference runs locally; deterministic extraction and fitting do."
- **M2 §1.3 / G3 / A2 "nothing resolves a path or attachment into typed media", "callers must inline
  bytes."** False for the local family: multimodal_embed and semantic_* take parts with a host
  `path` and decode it themselves (extension-embeddinggemma/src/index.ts:226-262,635,644,684);
  media_find_moments takes `media.path` (:484-485). **Fix:** scope the gap to the
  declarative/harness-model boundary, and add that these path readers have no root allow-list — that
  custody hole is what A2 must actually solve.
- **M3 Citation block does not survive checking.** ≥8 ranges point at the wrong place, e.g.
  LOCAL-SURFACE:200-217 (used at report 56,189,333,379,680) vs the actual usage/string/no-receipt
  text at 234-236; LOCAL-SURFACE:144 (334,678) vs 154; LOCAL-SURFACE:150-154 (A7) vs 160-167;
  :72-80 (ledger 683) vs 82-90; :132-148 (A6) vs 153; :161-164 (69,688) vs 27-31; :219-233 (277) vs
  189-201; and `src/tool-mode-run.ts:287,402` (334,678) vs `src/index.ts:2993` (those are elapsedMs/
  toolCalls). **Fix:** re-resolve every range against the final LOCAL-SURFACE and ledger.
- **M4 §4 table "Usage unknown is not zero | HLM-10".** Presented under "already matches", but
  verification/requirements.json:2229 records "Usage aggregation: absent … the entire usage half",
  and the report's own §5 G1 says usage is dropped. **Fix:** move to gaps; keep only "LlmUsage is a
  known/unknown sum type in the broker".
- **M5 A3 feasibility.** No local or catalog implementation answers typed questions about images:
  Laya is text-only (extension-laya/schema/decision-test.input.json: `prompt` string), `eye` is
  closed-beta/no-SDK, `describe_image` returns prose. So "cheap yes/no/where tier", `image.locate`,
  and A3's "live qualification against two routes" cannot run; Jev is hosted and not integrated.
  **Fix:** scope A3 to a structured-output recipe over the frontier route (not cheap) or mark it
  conditional like A7, naming the provider prerequisite.
- **M6 A3 contradicts §3.8 rules 8-9.** It mints `image.ask`/`image.locate` while rule 8 says extend
  `describe_image`/`media_find_moments` before minting a name, and rule 9 says grow by composition,
  not tool count (pi-vision's judge is a code-mode global, not a tool). **Fix:** add optional
  `ask`/`locate` arguments to describe_image (or a global) or justify the new identity.
- **M7 A1's `sources` depends on A2.** Slice 1 would hash "each input file's bytes", but no tool
  accepts a file input today: describe_image takes JSON bytes, recipes take typed media, and file
  resolution is exactly the unimplemented half of HLM-11 (requirements.json:2241). **Fix:** move
  `sources` to slice 2, or land media-reference admission first.
- **M8 §7 dependency claim.** "Without it, slices 2-4 cannot show that they help" is false: they are
  verifiable on fixtures; slice 1 enables the *economics* verification and slice 5's cost column only.
- **M9 A4. (a)** `escalated` rewrites CODE-02's pinned ToolModeRunOutput (spec:447-457) and needs a spec
  revision, not a result field. **(b)** package-supplied programs put executable code into the
  declarative model that §4 praises for having none and spec:1568 forbids ("Reject a declarative
  package with an executable entry"); CODE-10 consent (spec:478) is unaddressed. **Fix:** state the
  interface version bump and trust-and-consent story, or keep the program host-authored, digest-pinned.

## SHOULD-FIX

- **§3.8** says "eight rules follow" and lists nine. Fix the count.
- **§5 "stale in the flattering direction"** contradicts its own examples: the manifest *understates*
  ONNX capability and the tool text *understates* video. That is self-deprecating, not flattering.
  Reword to "stale against the code in both directions".
- **"a single measured run" (line 46):** there are two n=1 measurements — the live document-check
  ($0.54 / ~8 min, README:44-45) and the find per-step table for one 47-minute film
  (find SKILL.md:77-90). Say "two n=1 measurements, no baseline".
- **A1 `costUsd: number | null`** conflicts with RES-10's `MonetaryAmount`
  {known,currency,amount}|{known:false,reason} (harness-budgets.ts:20-30) and drops the currency;
  reuse it or say why. Strongest form of the finding: `describeCost` has **zero production callers**
  (only tests/asset-acquisition.test.ts), i.e. the renderer exists and nothing calls it.
- **A6 "typed `no-route`"** invents a code; RCP-11's vocabulary already has
  `EXECUTOR_NOT_CONFIGURED` (spec:1536). **A3's `self-reported-probability`** duplicates the existing
  `vendor-reported-probability` (tool-mode-contracts/src/contracts/lang-detect.ts:77).
- **AT-51 is NOT_RUN** and its adjudication is a stale round-59 record (requirements.json:3498-3510) —
  the same defect §5 names; cite its requirement text, not its status. DEC-04's probability-vector
  validation is the recorded remainder (requirements.json:1965) — exactly A3's "bad mass rejected".
- **A4/TMX:** the protocol is TMX 1.1 (spec:1566-1570); a 1.2 `execution.kind` needs a protocol
  revision and feature negotiation. **A5 path:** `qualification/` does not exist, and
  `verification/evidence.json` already exists and is regenerated by `npm run verify` (git b8d13b9,
  dirty) — say how an eval merges rather than "writes into".
- **Baseline 88359ab is one commit behind HEAD 49be50c**; the intervening commit ("Restore
  prepared-asset handles after a restart") fixes exactly the dispatch path §8a calls "wired".
  Re-pin and qualify "wired" as same-process.
- **"No reusable workflow artifact"** ignores the existing skill + `tool_mode_run` route and RCP-09
  draft authoring; state the delta (pin, inspect, dry-run, tool identity) instead of "absent".

## Claims verified (they survived)

- Jev is TypeSafe's hosted typed-question API (noul/choice/score/box, probabilities, keys/OpenRouter,
  16 MiB & 280-1568 px limits, cost null-never-0) — jev README:3,32-34,53-66,82,104-108.
- pi-vision adds no model-visible tool, keeps `read`'s eight arguments, exposes 3 code-mode globals,
  ships 5 skills and 9 miss codes — README:64-66,96-98; contract.ts (MISS_CODES, VISION_*).
- No savings benchmark, no accuracy eval; $1 cap, ~$0.54/~8 min; the gif is explicitly "not a cost
  benchmark" (docs/assets/README.md).
- Receipt fields, memo key over source/selector/question/model/contract/plan, `kept` — evidence.ts:16-55,100-103.
- Usage is dropped: `return outcome.text` at harness-serving.ts:169; declarative output is
  `type:'string'` (index.ts:3849-3851, :3881) and no receipt is recorded on that path.
- `tool_mode_run` records `modelIdentity:'none'` (index.ts:2993) and reports only elapsedMs/toolCalls.
- No price is computed anywhere; no result cache; `ToolMeta` is closed over nine fields (meta.ts:29-70);
  InvocationReceipt has no tokens/timing/price (receipt.ts:32-71).
- describe_image contract requires `image_path` (standard.ts:64-72) while the recipe declares typed
  `image` (images.ts:75-82), and a closed binding refuses it (recipe-format.ts:1352-1361).
- Video is implemented (extension-embeddinggemma/src/index.ts:1059-1098) while manifest:94 and
  contracts.ts:196 still say "VIDEO media is refused by name"; manifest:6 still says "wires no ONNX
  session yet" while inference.ts:106-167 creates real ORT sessions.
- spec:505 defers saved programs; spec:507 is CODE-11; status.json:45's `input` refusal is real in
  code (tool-mode-run.ts:370-378).
- "227 normative requirements" reconciles with README:12 and VERIFY.md:50 (317 rows = 227 + 90); the
  spec yields 210 bolded requirement paragraphs, so cite the docs, not the file.

## Evidence-file claims too weak to rely on

- **"406 commits"** (EXTERNAL-FINDINGS:3): the clone is shallow — `git rev-list --count HEAD` = 1.
  Unverifiable locally; version 0.1.0-beta.18 checks out.
- **TypeSafe doc-site claims** (no Jev grammar/language spec; "calibrated probabilities"; primitive
  limits) are not archived in the evidence file, and EXTERNAL-FINDINGS:231 admits one doc fetch came
  back redacted. "Jev is not a language" rests on a negative web check plus repo absence.
- Marketing-page claims ride on a third-party tweet archive; PyPI authorship and the pi.dev download
  count are explicitly unverified (EXTERNAL-FINDINGS:78,152,232). Do not promote them into prose.
- **LOCAL-SURFACE is internally damaged**: the §2 table is split by the "Installed set" paragraph and
  an orphaned row sits at :62; with the offset mismatches above, the report was likely drafted against
  an earlier version of its own evidence.
- **LOCAL-SURFACE describes one machine at one time** (pid 26620, `C:\Users\erikb\...`): "installed",
  "prepared-cold" and "real ONNX" are dated host facts, not repository facts.
- **requirements.json / release.json are the same status artifacts §5 distrusts**: good for *absences*
  (M4), not for positive claims without a code cite.
