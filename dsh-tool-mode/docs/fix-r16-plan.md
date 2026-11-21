# Fix plan — R16 on-device model tools enter the standing surface

Target: 0.5.117. E45/E46: adoption follows the digest surface, not task-appropriateness —
a tool in the digest is used even when wrong, and a catalog model tool absent from it stays
invisible even when right. R17 bounds the payoff: wrappers flip adoption only when per-item +
clause-bearing, and weak judgment/extraction tools the solver already handles add overhead.

## Design
A SECOND standing section, `tool-mode:on-device`, next to (not inside) the library digest:

- Lists model tools that are REGISTERED RIGHT NOW by capability: judgment, extraction,
  embedding, vision, speech, language, text, planning. Sources: `STANDARD_CONTRACTS`
  (Laya decision_*, Needle structured_extract, EmbeddingGemma semantic_*/text_embed/
  text_rerank/multimodal_embed, describe_image, stt_transcribe, lang_detect, text_title,
  tools_plan) plus callable catalog rows from the tool-mode catalogue mapped by capability
  family (audio/text/image/video/stroke).
- Registered-only: a catalogue row whose tool is not callable is never named (the F3
  dead-route defect, in a new surface).
- NON-IMPERATIVE: no `Use ...` line. The library digest keeps the single directive, so a
  weak model tool cannot displace the artifact the caller actually needs (E46).
- Bounded: 6 classes / 8 names per class / 900 characters, empty when nothing is callable.
- R17 guidance: use for high-volume detection, binary calls, extraction beyond context,
  embedding/vision; for a one-off judgment or trivial extraction the solver is usually
  better; reuse requires an artifact that runs it per item with a verification clause.

## Why not list every extension's tools
The registry is the source of truth: contracts + the plugin's own catalogue cover the
canonical tools, and any extension that registers one of the contract names is surfaced
automatically. Non-contract third-party tools (for example raw `mirage_*` alongside the
`describe_image` contract) are not guessed at — a guessed class is worse than silence.

## Tests
- Pure: grouping, unregistered omission (mutation: removing the registered filter turns the
  dead-route test red), catalogue mapping, empty result, bounds, no imperative, R17 text.
- Wiring: a freshly registered `decision_test` appears in `tool-mode:on-device`; disposal
  removes it; the library directive stays clean. Mutation: forcing the section empty turns
  both wiring tests red.

## Live acceptance
R16's acceptance ("a neutral solver calls decision_test at least as often as an unrelated
digest artifact") needs a restarted host running this build and a neutral probe; it is NOT
measured in this session (no live restart). The shipped increment is the surface change it
depends on.
