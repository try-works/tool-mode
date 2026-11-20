# R2 — digest-executable coverage

**Build:** 0.5.108. **Test:** `packages/dsh-tool-mode/tests/digest-executable.test.ts` (1/1).

The test seeds a workspace authored tool `agent_counts` and a saved workflow
`g1_lang_counts` that calls it, builds the directive digest with the authored tool as the
top candidate and the workflow as a supporting candidate, asserts both names appear, then
runs each advertised name through `tool_mode_run` with the digest's call shape. Both return
`{counts:{pl:1,fi:1}, total:2}`; neither returns a bind refusal.

This is the R2 acceptance form: an artifact the digest prints must execute, not merely be
listed. R1's authored binding and stored-name alias are covered separately in
`authored-program-binding.test.ts` (6/6).
