# Recheck — evidence lens (P5)

First-pass findings from `v2/evidence.md` that touch a changed section (42 of 47), one verdict each;
new issues only where the edits introduced them. Read-only on the plan, no builds. I also read
`docs/tool-mode/ARMS-AND-MDE-DECISION.md` because the plan now rests its whole ablation on it.

Disposition check: §15's v2.2 table claims T1, T3, T4, T5, T6 fixed. T1, T3, T4 verify; **T5 and
T6 do not** — §14.8's Phase 3 row is unchanged and §10.3 is truncated mid-sentence.

## §0 — What changed in v2 (L17–44)
- §0-1 MAJOR **PARTIAL** — reason codes are added (L175–178), but still "a reason string carrying a number": no n/need field, `"0"` still satisfies it.
- §0-2 MINOR **NOT FIXED** — L27 still claims "the only call facts that are both mechanical and new"; §6.1 names the cut, never the candidate population.
- **New:** change-table row 3 has three cells in a four-column table (L26) — "v1 said" and "Why" are missing from the one row recording the gate fix.
- **New:** rows 7 and 12 both describe the suite-pair change with contradictory "v1 said" columns — "(open question)" (L30) vs "used per-session hash arms" (L35).

## §1 — Background (L45–84)
- §1-1 MAJOR **PARTIAL** — a URL and "There is no in-tree copy" (L51) beat a bare name, but the 0.04 comparison is still unqualified and still "shaped this plan" (L55–60).
- §1-2 MAJOR **PARTIAL** — an MDE exists in the cited doc (α 0.05, power 0.80, base 0.80); nothing reconciles it with the plan's "≤2.1% by same-intent text", which it exceeds 2×.
- §1-3 MINOR **NOT FIXED** — L79 still counts "11 `SKILL.md` files in extensions", the SDK template included.
- **New:** "eight borrowed numbers" (L51) is short of its own table by ~4× — Appendix B tabulates about thirty.
- **New:** the citation is a slug URL, not an arXiv id or DOI (L50), with no digest; the precondition it sets is unmet while every number stays load-bearing.

## §2 — Goals and non-goals (L85–107)
- §2-1 MAJOR **PARTIAL** — goal 3 attaches an interval to `D` (L94–97), the right shape; `N` is still undefined and still optional.
- §2-2 MINOR **NOT FIXED** — "did anything change" (L89–90) still names no baseline or window.
- **New:** `N` is "the gap from no-skill to expert use" (L96), but §11's bank supplies "positives and negatives", not an expert reference — `N` has no denominator even with a bank.

## §3 — Decisions in force (L108–133)
- §3-1 MAJOR **NOT FIXED** — D14 (L127) still reopens on "precision ≥ 0.9 on a labelled set": no n, no lower bound, no level.
- §3-2 MAJOR **FIXED** — "An arm is a **suite run condition**, never a production assignment" (L118); §10.3 fixes the unit as the task (L495).
- §3-3 MINOR **NOT FIXED** — D7 (L120) still identifies receipt loss without requiring it reported.
- **New:** D17 thresholds on "the MDE" (L130) but no MDE value appears in the plan; App C names the term and omits the number.

## §5 — The seams (L145–212)
- §5-1 MAJOR **PARTIAL** — §5.3 separates reason codes from outcomes (L175–178); the gate is still a string with no required fields, so the test asked for cannot exist.
- §5-2 MAJOR **PARTIAL** — §10.1 pins "the same model" inside the pair (L478); whether model identity is inside the declaration digest is still unstated (L205–208).
- §5-3 MINOR **NOT FIXED** — the identity test (L209–211) still names no ground truth for the editable set; still indistinguishable from a tautology.
- **New:** the artifact digest list is cut mid-sentence — "…`purpose`, `verification` and" (L199) runs into the Skills bullet; `verifiability` has vanished.
- **New:** the skills bullet repeats "catalog-entry digest (bundled), the playbook digest or file bytes, and the body digest." twice (L207–208).

## §6 — Phase 0, signals (L213–335)
- §6-1 MAJOR **PARTIAL** — "in the **same session, before that call**" (L231) is one crossing closed; the receipt cap, the unit and the rate denominator are still absent.
- §6-2 MAJOR **FIXED** — D18 moves edges to where the receipt is built; "it does not touch the stored evidence, and the report distinguishes `null` from `0`" (L272).
- §6-3 MAJOR **NOT FIXED** — the precision gate (L304–310) still gives no confidence level, no sampling frame, no agreement floor.
- **New:** Lane 1 lost its object — "The host dispatches / and `createDispatchForContract`" (L282–283); the contract and resolver are no longer named.
- **New:** §6.4 still removes "a skill row whose session is forgotten … from the ablation matrix" (L331), which D17/§10.6 make a suite matrix with no store rows.

## §7 — Phase 1, the use store (L336–363)
- §7-1 MAJOR **FIXED** — "**There is no arm column.** An arm is a property of a **suite execution**" (L350), with `applied` recording injection.
- §7-2 MAJOR **NOT FIXED** — "one row per **use**" (L343–344) still never defines a use.
- §7-3 MINOR **FIXED** — "**90 days** for tool, error and edge rows; **30 days** for rows derived from operator words" (L354).
- **New:** the retention bullet's last sentence is duplicated — "two apart." is followed by "outcome from `insufficient`, because … two apart." (L354–356).

## §8 — Phase 2, the observed check (L364–392)
- §8-1 BLOCKER **FIXED** — "Until the pass exists, `unreproduced` is **`null`, not 0**" (L380), refused with `EVIDENCE_UNREPRODUCED_UNKNOWN`; the gate can now fail.
- §8-2 MAJOR **NOT FIXED** — precedence unchanged, and §15 now admits it: "the two sentences still disagree" (L832–834).
- §8-3 MINOR **NOT FIXED** — "copy up to three **argument paths**" (L366) still has no order and no "n omitted".
- **New:** §8 says §14.8's Phase 2 gate names as "reproduced" a "**reproduction pass** over a stored failure" (L373–375); the gate there is the observed check recurring on the next 3 failing uses.

## §9 — Phase 3, the skill module contract (L393–470)
- §9-1 MAJOR **NOT FIXED** — "default 1200 tokens" / "4000" (L420–421) still underived, and `decision-decomposition` (L408) still estimates over the cap.
- §9-2 MAJOR **NOT FIXED** — C2/C3 (L447–448) still say near-identical and contradictory while the shipped checks are exact-normalised equality and two regexes.
- §9-3 MINOR **NOT FIXED** — "one flow skill of each shape" (L407) still labels a one-tool skill a flow skill.
- **New:** §9.1 says a flow skill "must name the composition it assumes" and then that `requiresTools` is "never 'this guidance composes them'" (L401–406) — no field is left to name it.

## §10 — Phase 4, skill measurement (L471–525)
- §10-1 BLOCKER **FIXED** — "run once with the skill body injected and once with it suppressed" (L479–480); production claims nothing causal (L480–482).
- §10-2 BLOCKER **PARTIAL** — §11 replaces the sign rule with "interval excluding the equivalence margin, cleared against the MDE" (L538); no multiplicity correction survives — §11's Holm is "across a pre-registered family of one" (L547–548).
- §10-3 MAJOR **FIXED** — "interval lies inside the pre-registered **equivalence margin**, never a non-significant result" (L508–510).
- **New:** §10.3 is truncated at "(minimum 6 pairs, as §11 already" (L497) — the report list T6 points at as the fix (interval, MDE, multiplicity) does not exist.
- **New:** "≥ 6 discordant pairs" and a 5 pp MDE are not connected: at a 0.80 base rate a 5 pp shift yields ≈0.05n discordant pairs, so 6 needs ≈120 tasks; the cited doc says "~20-40".

## §11 — Phase 5, admission and demotion (L526–556)
- §11-1 BLOCKER **FIXED** — §14.8 states the predicate: "an explicit predicate over the suite (no harm interval below the equivalence margin" (L754).
- §11-2 MAJOR **NOT FIXED** — the "explicit `admitted-insufficient` marker" (L535) is still an unbounded bypass.
- §11-3 MAJOR **NOT FIXED** — "minimum 6 pairs" (L547) still carries no power basis.
- **New:** "Holm-corrected across a pre-registered family of one" (L547–548) is a no-op; the matrix in §10.3 is the family that needs correcting.
- **New:** "interval excluding the equivalence margin" (L538) is not evaluable — an interval excludes a value, not a margin.

## §13 — Not in this programme (L594–611)
- §13-1 MAJOR **NOT FIXED** — "A model may veto (§12); it may not grade" (L610) unchanged, so the `correction` label still writes durable evidence with no slot in the taxonomy.

## §14 — Development method and gates (L612–756)
- §14-1 BLOCKER **NOT FIXED** — §14.8 Phase 3 still reads "zero `error`-severity lint findings; every registered skill reports a digest and a token count" (L752); it still passes with no checker installed.
- §14-2 MAJOR **PARTIAL** — "order spread reported" is gone from the gate row; §10.4 still ships a prose criterion with no bound and now no gate.
- §14-3 MAJOR **PARTIAL** — Phase 4 gained "the MDE is fixed before the run" (L753); the 8-session floors (L749–750), the 3-use rule (L751) and Phase 0's "programme stops" remain.
- **New:** §15 says T5 is fixed as "`verify:skills` exits 0" and points at §14.8, which says the opposite (L752 vs L826).
- **New:** §14.7 still tests that a non-reproducing failure "is counted `unreproduced`" (L724–725), three sections after D19 made it `null`.

## §15 — Review record (L757–837)
- §15-1 MAJOR **NOT FIXED** — "the deletion of unreproducible evidence" (L766) still contradicts D9, D19 and §8.
- §15-2 MINOR **NOT FIXED** — the one-point-gap rationale (L794–796) still sits beside `gapFloor 0.05` (L521) with no derivation.
- **New:** the v2.2 table marks T5 and T6 "fixed" (L826–827) but points at §14.8 (unchanged) and §10.3 (truncated); a reader who trusts the index stops looking.

## §16 — Decisions not made (L838–854)
- §16-1 MAJOR **NOT FIXED** — the defect moved: the pair floor is a pre-registered threshold in §14.8 and an open question in §16.6.
- **New:** one number, three statuses — decided in D17 ("minimum 6 pairs", L130), pre-registered in §14.8 (L753), open in §16.6 (L852–853).

## §17 — Implementation status (L855–900)
- §17-1 MAJOR **PARTIAL** — "**It is not persisted yet**" (L871) is honest; no mutation-check run was captured and the module-not-found run was not replaced.
- §17-2 MAJOR **NOT FIXED** — "recorded as a pre-existing timing flake" (L886) is still unsupported by anything offered.
- §17-3 MINOR **NOT FIXED** — 4084/4058/25/1 (L881–882) still carry no command, commit or date.
- **New:** §14.2 says "Two runs of it are already on record: the red run captured…" (L640–642) while §17 says that run "is not persisted yet" (L871).

## Appendix A — section map (L901–917)
- A-1 MAJOR **NOT FIXED** — still no finding-id mapping for the 36 v1 findings, so "every adopted finding is retained" (L5–6) stays unauditable.
- **New:** "| §5 Phase 2 observed check | §8, unchanged |" (L910) — §8 changed in this pass (D19, reproduction pass), so the map is now false.

## Appendix C — Definitions (L932–948)
- **New (no first-pass finding):** "window | a **session**" (L939) contradicts §6.3, where the window is the interval from the tool result to the next tool call.
- **New:** "MDE | the pre-registered minimum detectable effect" (L941) states no value while D17 and §14.8 threshold on it.

## Counts
FIXED **8** · PARTIAL **11** · NOT FIXED **23** · total **42** findings (all first-pass findings in changed sections).
New issues introduced by the edits: **25** — two in §0, §1, §5, §6, §10, §11, §14, Appendix C; one in §2, §3, §7, §8, §9, §15, §16, §17, Appendix A; none in §13.

**Reading.** The redesign is right and three of five blockers are genuinely fixed. The remaining
failures cluster where a claim was edited but its carrier was not: the disposition table, the gate
table, the truncated §10.3 list, and the duplicated §5.5/§7 text.
