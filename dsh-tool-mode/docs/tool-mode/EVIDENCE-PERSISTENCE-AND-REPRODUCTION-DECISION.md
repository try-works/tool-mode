# Evidence persistence and reproduction — two decisions

**Status:** DECIDED. **T2 = (a)** signals persist where the receipt is built, not in the session
projection. **T3 = (a)** `unreproduced` is `null` until a reproduction pass exists, and promotion is
refused while it is `null`. Both close blockers from the v2 review
(`research/reuse-evidence-review/v2/SYNTHESIS.md`, T2 and T3).

## Decision 1 (T2) — signals persist where the receipt is built

**The defect.** The plan said signals fold at run completion into a **session projection**. The events
a projection folds carry turn/step/callId/name/arguments/isError/error.code/content — no
`dataFlow`, no `receiptId` (`tool-usage-projection.ts:254-288`). So `consumed` and
`unexplained` are unreachable from a projection, and a re-fold from the log can never recover them.

**The decision.** Emit the edge-derived signals in the **composition path**, where the receipt and
the run report already exist (`index.ts:4344, 4391-4392`), and write them into the evidence store
keyed `(session, call, ref)`. The projection keeps only what it can actually see: tool name, error
class, `isError`, and the counters that derive from them.

**Why (a) and not (b).** Extending what a projection sees would change a host-owned contract for one
plugin's benefit, and the projection is a *cache* — its `stateVersion` bump re-folds to `null`,
which is correct for a cache and would be data loss for evidence. The composition path already has
the report, the edges and the arguments in hand.

**What it costs.** Signals are written once and are not re-derivable from the log. That is
acceptable because the store is authoritative (D3) and the log was never the evidence. A missed write
is an explicit hole — the report counts it `unresolved`, never "not consumed" — and §6.4's retention
cascade applies to the stored rows exactly as it would to a projection.

**What does not change.** The edge vocabulary stays `consumed | unexplained | unresolved`; a direct
call still has no edge and is `unresolved`, never `unexplained` (data-flow edges exist only inside a
Code Mode composition, `data-flow.ts:2,47-48`).

**Tests.**
- a composed run with an observed edge writes exactly one `consumed` row keyed by its call;
- a direct call writes no edge row and the report counts it `unresolved`;
- a projection `stateVersion` bump does not change the store's edge counts (the cache re-folds, the
  evidence does not);
- a run whose composition report is missing writes no edge row and is counted `unresolved` with a
  reason — never `unexplained`.

## Decision 2 (T3) — `unreproduced` is `null` until the pass exists

**The defect.** §8 required promotion to satisfy `unreproduced === 0`, but `unreproduced` is set only
by a reproduction pass the plan calls "a work item" and does not schedule. Until it exists the field
is 0 by default, so the gate passes by default — the plan guarded against deleting failures to
manufacture `failures === 0` and then manufactured `unreproduced === 0` by never running the check.

**The decision.** `unreproduced` is **`null`**, not 0, until the pass exists. Promotion is allowed
when one of these holds:

- `failures === 0` (nothing to reproduce); or
- the reproduction pass has run for this declaration and `unreproduced === 0`.

While `unreproduced` is `null` and `failures > 0`, promotion is refused with
`EVIDENCE_UNREPRODUCED_UNKNOWN` and the release report prints `unreproduced: unknown`.

**Why not simply require `failures === 0`.** That would delete the retained-failure allowance (D9)
and recreate the pressure to erase failures that the v1 review already killed. Keeping the failures
and refusing the promotion is the honest middle.

**Consequences.**
- An artifact with any recorded failure is unpromotable until the pass exists. That is a real
  tightening, and it is stated in the report rather than discovered at the gate.
- D11 (`null` ≠ `0`) now has a gate that enforces it rather than a rule that asks for it.
- Phase 2's gate becomes: "either `failures === 0`, or the reproduction pass ran and every observed
  check reproduced".

**Tests.**
- no pass, `failures > 0` → promotion refused with `EVIDENCE_UNREPRODUCED_UNKNOWN`;
- no pass, `failures === 0` → promotion allowed;
- pass present, `unreproduced === 0` → allowed;
- pass present, `unreproduced === 1` → refused, and the failure is still counted;
- the release report prints `unreproduced: unknown` rather than 0 when the pass is absent.

## What changes in the plan

| section | change |
| --- | --- |
| §3 | new D18 (persistence) and D19 (`unreproduced` null) |
| §6.2 | the fold moves to the composition path; the projection keeps counters only |
| §8 | `unreproduced` is `null` until the pass; promotion refused while unknown |
| §14.4 | four tests from this paper, one per failure mode |
| §14.8 | Phase 2 gate restated as "failures === 0, or the pass ran and reproduced" |

## Open questions

1. Who owns the reproduction pass, and when does it exist? Until D19's second branch is available,
   any artifact with a recorded failure is frozen at its current scope.
2. How long are `failurePaths` retained? They are argument *paths*, not values, but they are still
   metadata about a user's call; the retention window in §6.4 should name them explicitly.
