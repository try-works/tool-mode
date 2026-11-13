# Extension matrix

- profile base URL: `http://127.0.0.1:3199`
- generated: 2026-10-25T11:11:52.386Z
- exit: 0

| extension | status | duration | blocker / detail |
| --- | --- | --- | --- |
| tongue | PASS | 4.7s | prepare: prepared |
| voz | PASS | 65.6s | prepare: prepared |
| embeddinggemma | PASS | 185.9s | prepare: prepared |
| laya | PASS | 76.6s | prepare: prepared |
| minilm-embed | PASS | 122.9s | prepare: prepared |
| minilm-rerank | PASS | 147.5s | prepare: prepared |
| needle | PASS | 95.9s | prepare: prepared |
| declarative-recipes | SKIPPED | 60.7s | the invocation host composes no LLM provider (harness limitation; the live host serves declarative recipes via the agent) |

## Tool verdicts

| id | extension | verdict | detail |
| --- | --- | --- | --- |
| lang_detect | tongue | PASS | The long English fixture must be detected as en with the top candidate agreeing; probabilities are the vendor's uncalibrated values, only bounded here. |
| stt_transcribe | voz | PASS | The fixture is a synthesized 2 s tone, NOT speech: this proves decoding, contract shape and duration-bounded coverage only. It cannot prove word accuracy, and no check here claims it. The silence fixture is used only by the offline honest-empty test. |
| decision_choose | laya | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| decision_test | laya | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| decision_score | laya | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| tools_plan | needle | SKIPPED | the in-process invocation host composes the host planning adapter but has no Agent turn context, so the frozen planning snapshot is not applied (harness limitation); the live agent host produces a real plan |
| structured_extract | needle | PASS | The extraction must satisfy the CALLER schema in the fixture, and the package's own valid/issues report must agree with an independent re-validation; a blob is never accepted as an extraction. |
| text_embed | minilm-embed | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| text_rerank | minilm-rerank | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| multimodal_embed | embeddinggemma | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| semantic_similarity | embeddinggemma | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| semantic_rank | embeddinggemma | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| semantic_classify | embeddinggemma | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| semantic_deduplicate | embeddinggemma | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| media_find_moments | embeddinggemma | SKIPPED | the in-process invocation host does not carry the live host's prepared-asset map (harness limitation); the live host serves this tool after a successful prepare |
| text_title | declarative-recipes | SKIPPED | the invocation host composes no LLM provider (harness limitation; the live host serves declarative recipes via the agent) |
| image_describe | declarative-recipes | SKIPPED | the invocation host composes no LLM provider (harness limitation; the live host serves declarative recipes via the agent) |
