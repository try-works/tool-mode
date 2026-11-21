# Arms and MDE — the decision

**Status:** DECIDED (single option). This supersedes the three-option draft of the same date; the
rejected options are kept only as a record of why they lost.

**Decision.** An arm is a **suite run condition**, never a production assignment. The counterfactual
for a skill is the same pre-registered task list executed twice — once with the skill body injected,
once with it suppressed through the existing static `skills.disabled` switch — with outcomes paired
**per task**. Deletion and admission are decided there, with an exact sign test, an interval, a
pre-registered MDE and a minimum pair count. The observational store keeps guardrails and never
votes on whether a skill helps.

## 1. Why the word "arm" exists at all

One question: *would this task have gone better without this text?* Without a counterfactual there
is only volume and correlation — the thing the repository already falsified once
(`library-digest.ts:215-219`). So a comparison is not optional. What is optional is **where** it
happens, and that is the whole decision.

## 2. Why not in production

Three independent reasons, any one of them sufficient:

1. **The mechanism does not exist.** The disabled set is static config plus environment, parsed once
   and consulted at registration (`src/index.ts:1926`, `:3120`, `:5905`); registration happens per
   plugin mount, not per session. A hash-derived per-session arm is a label nobody applies, so both
   arms receive the body, every Δ is 0, and the plan's old rule then read 0 as "not helping" — the
   v2 review's T1.
2. **Making it exist changes the product.** It is buildable (a per-assembly prompt section carrying
   `agent.sessionId` at `src/index.ts:3433-3452`, plus `modelInvocable: false` on the registered
   copy), but it moves skill delivery out of the shared catalog and puts half of a deployment's
   sessions on no guidance. That is a different product, not a measurement detail.
3. **It could not answer the question anyway.** For a two-arm proportion (one-sided α 0.05, power
   0.80), the minimum detectable effect at a base rate of 0.80 is:

| sessions per arm | MDE (pp) |
| --- | --- |
| 50 | 19.9 |
| 200 | 9.9 |
| 400 | 7.0 |
| 800 | 5.0 |
| 2000 | 3.1 |

   Sessions are clusters (several calls each), so the effective n is smaller and these are
   optimistic. At this product's scale a field experiment cannot detect a plausible skill effect;
   building the seam would buy an underpowered result at a real product cost.

   **Not the same quantity as the paper's 2.1%.** That figure is the share of the teacher–student
   **KL gap** closed by same-intent instructions, measured on next-token distributions. This table is
   about a **task success rate** and a paired difference. Neither converts into the other, and no
   conclusion in this plan is drawn from the 2.1% figure.
- **Per-session arms in production.** Rejected on the three grounds above. Reopen only if the
  product is willing to ship an ablation profile *and* the sample sizes grow by an order of
  magnitude.
- **Cross-configuration comparison** (two deployments, joined by config digest). Rejected as a
  basis for any per-skill claim: it is confounded by time, model version, users and workload, and
  per-skill ablation needs 2^k configurations. It survives as an optional sanity check a human may
  eyeball; nothing implements it.
- **Observational removal matrix in the store.** Rejected: at the sample sizes available it marks
  every skill harmful or none, and it is the exact "gate satisfied by doing nothing" failure the
  review found (T6).

## 4. The design

**Mechanism.** The runner mounts the plugin twice — with the skill enabled and with it listed in
`skills.disabled` — and executes the same task list in both. This is already supported and already
tested: `skill-disable.test.ts` proves that disabling a skill leaves its tool registered and
callable, which is the property the comparison depends on. No new seam, no hash, no session id, no
config digest, no product change.

**Unit and pairing.** The unit of analysis is the **task**, not the session or the call. Outcomes are
binary (the task's own validator decides), and the analysis is the paired difference over discordant
pairs.

**Statistics, all pre-registered before the run.**
- exact one-sided sign test on discordant pairs, minimum 6 pairs, Clopper-Pearson lower bound;
- paired difference in percentage points with its interval;
- an MDE fixed in advance at a value the operator will act on (recommended: **5 percentage points**
  over the suite's task count, which paired designs reach with ~20-40 tasks where 800 sessions
  could not);
- a cell whose interval spans zero prints **"no evidence"**, never "no effect";
- below the pair floor: `insufficient(n, need)`.

**What may be concluded.**
- *Deletion candidate*: the paired difference shows harm, its interval excludes the equivalence
  margin, and the effect clears the MDE.
- *Admission*: a `pass` predicate over the same numbers — no harm interval below the equivalence
  margin, and where a pre-registered reference exists, recovery meets its bound. An uncomputable
  predicate is `insufficient`, never `pass`.
- *Cross-family effects*: run the other families' suites with this skill suppressed. The removal
  matrix survives as a **suite** matrix; the observational one is deleted.
- The report says "on these tasks". It never says "in the field", and it never says a skill "works".

**What the store still does.** Guardrails: volume, errors, consumption, call-shape rates per
`ArtifactRef`, and an `applied` flag recording whether the body was injected for that use. It has no
arm column and no matrix, and its report cannot raise or lower a suite verdict.

## 5. What changed in the plan

| plan section | now says |
| --- | --- |
| §2 goal 3 | `D` is a paired suite difference in percentage points, never an observational contrast; `N` is recovery against a pre-registered reference |
| §7 store | no arm column; skill rows carry `applied`, `tokens`, `declarationDigest` |
| §10.1-10.5 | the counterfactual is a suite pair; per-task pairing; sign test, interval, MDE; suite matrix; equivalence margin for the length sweep |
| §10.6 | report holds `suites[]`; `recovery` only with a reference and above the gap and pair floors |
| §11 | `pass` is an explicit suite predicate; demotion is suite harm; `admitted-insufficient` is printed when there is no bank |
| §14.4 | tests: one suite run suppresses the skill while the tool stays registered; below `minPairs` reports `insufficient`; a zero-spanning cell prints "no evidence" |
| §14.8 | Phase 3 gate is "`verify:skills` exits 0"; Phase 4 is a suite gate; Phase 5 is the pass predicate |
| D5, D17 | an arm is a suite run condition; deletion/admission are suite decisions |

## 6. Open questions

1. Who owns the suites, where do they live, and who freezes them before a run? (Same answer as the
   reference bank in §11 — without an owner and a frozen path, no deletion can be audited.)
2. Is 5 percentage points the effect worth acting on for this product? The MDE follows from the
   answer, not the other way round.
3. Is there one suite per family, or one cross-family suite? The former powers per-skill deletion
   better; the latter costs fewer fixtures.
4. Do we build the suite runner before any skill is deletion-candidate, or gate deletion on the suite
   existing? (Recommended: the gate, as Phase 4's threshold now says.)

## 7. Decision record

> **D17 — Deletion and admission are suite decisions.** Deletion and admission are decided by a
> pre-registered capability suite: the same task list run with the skill injected and with it
> suppressed through the static `skills.disabled` switch, paired per task, exact one-sided sign test
> over ≥ 6 discordant pairs, interval against a pre-registered MDE (recommended 5 pp). Below the pair
> floor or the MDE the answer is `insufficient(n, need)`; a cell whose interval spans zero is "no
> evidence". The observational store keeps guardrails only, has no arm column and never votes on a
> skill. Production arms and cross-configuration comparison are rejected (§2, §3 of this paper).
