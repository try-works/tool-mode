# Extension matrix

- profile base URL: `http://127.0.0.1:3182`
- generated: 2026-10-25T02:45:10.316Z
- exit: 0

| extension | status | duration | blocker / detail |
| --- | --- | --- | --- |
| needle | PASS | 15.6s | already active |
| declarative-recipes | SKIPPED | 1.3s | the invocation host composes no LLM provider (harness limitation; the live host serves declarative recipes via the agent) |

## Tool verdicts

| id | extension | verdict | detail |
| --- | --- | --- | --- |
| tools_plan | needle | SKIPPED | the in-process invocation host composes the host planning adapter but has no Agent turn context, so the frozen planning snapshot is not applied (harness limitation); the live agent host produces a real plan |
| structured_extract | needle | PASS | The extraction must satisfy the CALLER schema in the fixture, and the package's own valid/issues report must agree with an independent re-validation; a blob is never accepted as an extraction. |
| text_title | declarative-recipes | SKIPPED | the invocation host composes no LLM provider (harness limitation; the live host serves declarative recipes via the agent) |
| image_describe | declarative-recipes | SKIPPED | the invocation host composes no LLM provider (harness limitation; the live host serves declarative recipes via the agent) |
