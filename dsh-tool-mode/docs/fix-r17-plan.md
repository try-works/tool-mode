# Fix plan — R17 narrowing: promote only the on-device payoff band

> **SUPERSEDED by 0.5.119 (operator direction): no model tool may be demoted or omitted
> from the capability index. The E47 evidence is retained as GUIDANCE (wrapper shape and
> payoff band), never as an exclusion. See fix-r17-restore-plan.md.**

Target: 0.5.118. E47 measured what R16's surface needed: wrappers flip adoption only when
they are per-item + clause-bearing (agent_judge_greeting 0/3 -> 2/2), and a weak judgment tool
that IS adopted costs a call and is overridden (Laya 1/6 and 2/6, solvers corrected to 6/6).
Single-record extraction stayed unused (0/2). R17 therefore says: surface on-device tools only
where the solver is genuinely worse or slower; do not promote judgment/extraction tools the
solver dominates; shape wrappers per-item with a verification clause.

## What changed (0.5.118)
The `tool-mode:on-device` capability index now promotes ONLY the payoff band:
- kept: high-volume detection / language (lang_detect), speech/OCR (stt_transcribe),
  embeddings (multimodal_embed, semantic_*, text_embed, text_rerank, media_find_moments,
  text_title) and extraction (structured_extract, extract_with_repair, qualified to large
  inputs), plus callable catalog models mapped to those families.
- REMOVED: judgment (decision_choose, decision_test, decision_score) and planning
  (tools_plan). They remain registered and discoverable through their own tool definitions
  and `model_tools`; they are simply not advertised as recommended on-device work.
- The guidance sentence now states the band and the E47 wrapper rule: per-item + verification
  clause; a single-record wrapper earns no adoption.

The index is still non-imperative (the library digest keeps the single `Use ...` line),
registered-only (no dead routes), and bounded (730 characters at the measured library).

## Why this is not a bigger code fix
R17 is explicit: "guidance, not a code fix". Whether a given model is accurate enough to beat
the solver is a measurement (E47 ran live solvers), not something the host can derive from a
catalog row. The host's enforceable contribution is the surface rule: list only the band where
the evidence says adoption pays, and state the wrapper shape that earned adoption.

## Tests
- Pure: judgment and planning are absent even when registered; payoff classes render; only
  registered tools appear; bounded; guidance carries the band and the per-item + clause rule.
- Mutation: re-adding `judgment` to the class table turns the R17 test red.
- Wiring: registering `structured_extract` adds it to the on-device section; the library
  directive stays clean; disposal removes it.

## Live acceptance
R17's evidence is behavioral (E47), and the accuracy band cannot be re-measured offline. A
neutral probe on a restarted host is required before claiming adoption/benefit; that is out of
scope here (no live restart), so no adoption claim is made.
