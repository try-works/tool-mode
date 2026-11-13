# Proposed spec changes

The pinned specification is the text of record. A requirement is never silently
edited to match the implementation.

## Mechanism

1. **Propose.** Add a numbered entry to `proposals/` (or a PR description when the
   repository has no proposal directory yet) naming the requirement ID, the current
   text, the proposed text, the reason, and the compatibility impact.
2. **Review.** The proposal is reviewed by the requirement owner and a second
   reviewer; an implementation change that depends on it stays PARTIAL until the
   proposal is accepted.
3. **Accept or reject.** On acceptance, update the pinned spec version, regenerate
   `verification/requirements.json`, and record the new `sourceDigest`. On rejection,
   the implementation changes, not the requirement.
4. **Never rewrite history.** A superseded requirement keeps its status record and is
   marked by the proposal ID; the generator's source digest makes an unrecorded edit
   visible.

`docs/tool-mode/status.json` may carry `proposalId` on a requirement that is
implemented only under an accepted proposal. A proposal ID is evidence of review, not
a way to turn a failing behavior into a pass.
