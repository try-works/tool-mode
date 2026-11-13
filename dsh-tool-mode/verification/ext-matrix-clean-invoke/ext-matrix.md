# Extension matrix

- profile base URL: `http://127.0.0.1:3182`
- generated: 2026-10-24T01:49:25.060Z
- exit: 0

| extension | status | duration | blocker / detail |
| --- | --- | --- | --- |
| needle | PASS | 7.6s | already active |
| declarative-recipes | SKIPPED | 1.2s | the invocation host composes no LLM provider (harness limitation; the live host serves declarative recipes via the agent) |

## Tool verdicts

| id | extension | verdict | detail |
| --- | --- | --- | --- |
| tools_plan | needle | FAIL | the host returned a refusal: the pinned Needle engine and weights are not prepared on this machine, so no inference was run.   - needle-engine-win-x64: D:\DEV\dsh-temp\ext-matrix-host-store-QIQPam\extension-private\@try-works\extension-needle\needle.exe could not be read: ENOENT: no such file or directory, stat 'D:\DEV\dsh-temp\ext-matrix-host-store-QIQPam\extension-private\@try-works\extension-needle\needle.exe'   - needle3-weights: D:\DEV\dsh-temp\ext-matrix-host-store-QIQPam\extension-private\@try-works\extension-needle\needle3.cact could not be read: ENOENT: no such file or directory, stat 'D:\DEV\dsh-temp\ext-matrix-host-store-QIQPam\extension-private\@try-works\extension-needle\needle3.cact' Prepare the artifacts (see models.lock.json and PINNING.md) or set NEEDLE_EXTENSION_ENGINE and NEEDLE_EXTENSION_WEIGHTS to |
| structured_extract | needle | FAIL | the host returned a refusal: the pinned Needle engine and weights are not prepared on this machine, so no inference was run.   - needle-engine-win-x64: D:\DEV\dsh-temp\ext-matrix-host-store-QIQPam\extension-private\@try-works\extension-needle\needle.exe could not be read: ENOENT: no such file or directory, stat 'D:\DEV\dsh-temp\ext-matrix-host-store-QIQPam\extension-private\@try-works\extension-needle\needle.exe'   - needle3-weights: D:\DEV\dsh-temp\ext-matrix-host-store-QIQPam\extension-private\@try-works\extension-needle\needle3.cact could not be read: ENOENT: no such file or directory, stat 'D:\DEV\dsh-temp\ext-matrix-host-store-QIQPam\extension-private\@try-works\extension-needle\needle3.cact' Prepare the artifacts (see models.lock.json and PINNING.md) or set NEEDLE_EXTENSION_ENGINE and NEEDLE_EXTENSION_WEIGHTS to |
| text_title | declarative-recipes | SKIPPED | the invocation host composes no LLM provider (harness limitation; the live host serves declarative recipes via the agent) |
| image_describe | declarative-recipes | SKIPPED | the invocation host composes no LLM provider (harness limitation; the live host serves declarative recipes via the agent) |
