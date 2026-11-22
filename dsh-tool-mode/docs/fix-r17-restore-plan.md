# Fix plan — restore every capability class (no tool demoted)

Target: 0.5.119. Operator direction: the standing capability index must not demote the
recommendation of any tool. 0.5.118 removed judgment (decision_*) and planning (tools_plan)
and let a six-class cap silently drop `text` and `planning` when all classes were registered.

## What changed
- Restored `judgment` (decision_choose, decision_test, decision_score) and `planning`
  (tools_plan) to the capability map and render order: every registered model tool appears.
- Raised the class bound 6 -> 8 so no capability class can be dropped by budget, and the
  per-class name bound 8 -> 12; the character cap is now 1600 and is a last-resort for a
  pathological registry, never a ranking.
- Guidance is neutral: "they pay off most where you are genuinely worse or slower (...) and
  a judgment call costs you one round trip you can verify or override." The E47 wrapper rule
  stays: per-item rows + verification clause earns adoption; a single-record wrapper does not.
  The study result is no longer used to withhold a capability from the caller.

## Tests
- Grouping includes judgment.
- "renders every capability class, including text and planning" (mutation: class cap 6 turns
  it red — this is the regression that dropped text/planning unnoticed).
- "never demotes a registered tool: judgment and planning are listed too" (mutation: removing
  a decision_* mapping turns it red).
- Existing: unregistered omission, catalog mapping, dead-route, bounds, non-imperative,
  guidance; wiring tests unchanged.

## Boundary
E47's accuracy band cannot be measured offline, so no adoption claim is made. The surface is
complete; the guidance states when on-device work tends to pay, without ranking or removing.
