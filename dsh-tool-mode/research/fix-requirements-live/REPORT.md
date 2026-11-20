# Live probe — fix requirements (R1-R5)

Status: **MEASURED — 8/8 checks, 0 failed, exit 0.** Installed build **0.5.108**, disposable
headless profile `E:/tmp/dsh-exp-f838ffd2a4d64f09b3c0da1d97fad8a1`, newest session
`session-19fa58c0-7092-4697-b422-10ddad58658b` (62 records).

Command:

```bash
node scripts/probe-fix-requirements.mjs --home E:\\tmp\\dsh-exp-f838ffd2a4d64f09b3c0da1d97fad8a1 --json
```

## Results

| Check | Status | Detail |
| --- | --- | --- |
| `session-transcript` | measured | newest transcript read |
| `records` | measured | 62 records parsed |
| `R3-digest-pairs` | measured | digest entry of **667 chars**; all six pairs and the closing instruction; no mid-token cut |
| `R1-authored-tool` | measured | paired result carries `pl:1, fi:1` |
| `R1-stored-workflow` | measured | paired result carries `pl:1, fi:1` |
| `R1-workflow-spelling` | measured | paired result carries `pl:1, fi:1` |
| `R4-unknown-name` | measured | refusal result names `nonexistent_probe_tool` |
| `R4-list-bindable` | measured | list rows expose `bindable` |

## Harness corrections made during this run (probe bugs, not build bugs)

Each of these could have produced a false pass, and one would have:

1. **Digest selection.** The first string containing `->` and `Verify` is the 4.4k system
   prompt, which embeds a copy of the digest. Judging that would have PASSED even if the
   real digest were truncated. The selector now requires a digest ENTRY (a string starting
   `Use ` or `Also available:`) containing `Mislabels`; it reads the 667-char record.
2. **Pair quoting.** The stored value quotes its words (`'Tere'->da`) and embeds the sixth in
   prose (`a 'Por favor' in the pt block->st`), so a bare `Tere->da` never matches. Pairs are
   matched as word -> `->code` with a short gap.
3. **R1 pairing.** A flat search credited one result to all three calls and read the model's
   summary (which names every tool beside a `cannot bind` line) as a refusal. Pairing is now
   structural: `data.callId` on `tool/call` -> `data.message.toolCallId` on `tool/result`, with
   the text block parsed as JSON (escaped-quote regex only as a fallback).
4. **Refusal identity.** The task prompt also names `nonexistent_probe_tool`, so a bare name
   search matched the prompt. The check now requires the paired error result.

## Self-check (no install needed)

```bash
node scripts/probe-fix-requirements.mjs --self-check   # 2/2 measured, exit 0
```

Positive fixture -> all checks `measured`; negative fixture (truncated digest, no results) ->
every check `absent`. That proves the harness fails a bad transcript.

## Final observed JSON

```json
{
  "probe": "fix-requirements-0.5.108",
  "generatedAt": "2026-11-20T12:43:56.550Z",
  "results": [
    {
      "id": "session-transcript",
      "status": "measured",
      "detail": "read the newest session transcript",
      "evidence": {
        "file": "E:\\tmp\\dsh-exp-f838ffd2a4d64f09b3c0da1d97fad8a1\\sessions\\--E-tmp-dsh-exp-f838ffd2a4d64f09b3c0da1d97fad8a1--\\session-19fa58c0-7092-4697-b422-10ddad58658b\\session.v4.jsonl.zstd"
      }
    },
    {
      "id": "records",
      "status": "measured",
      "detail": "62 record(s) parsed",
      "evidence": null
    },
    {
      "id": "R3-digest-pairs",
      "status": "measured",
      "detail": "all six pairs and the closing instruction are present",
      "evidence": {
        "length": 667,
        "midToken": false,
        "hasClosing": true,
        "missingPairs": [],
        "excerpt": "Use workflow_g1_lang_counts({texts: string[]}) (stored g1_lang_counts) — Count languages through agent_from_draft_051ab807. Pass the whole list in one call.\nEvidence: 10 uses, 0 failures across 5 sessions.\nAlso available: agent_from_draft_051ab807 — Count languages across a list of texts [Verify: Mislabels short one-word items: 'Tere'->da, 'Terve'->hu, 'Dobry'->sk, 'Hej'->pl, 'Labas'->lv, a 'Por favor' in the pt bloc"
      }
    },
    {
      "id": "R1-authored-tool",
      "status": "measured",
      "detail": "the paired result produced pl:1 and fi:1 for agent_from_draft_051ab807",
      "evidence": {
        "callId": "call_00_ET_eguILFntlE3w4dbDHLpC0962",
        "excerpt": "{\n  \"result\": {\n    \"counts\": {\n      \"pl\": 1,\n      \"fi\": 1\n    },\n    \"total\": 2\n  },\n  \"logs\": [\n    \"tool_mode_accounting:{\\\"toolCalls\\\":1,\\\"calls\\\":[{\\\"callId\\\":\\\"call_1\\\",\\\"name\\\":\\\"agent_from_draft_051ab807\\\",\\\"ok"
      }
    },
    {
      "id": "R1-stored-workflow",
      "status": "measured",
      "detail": "the paired result produced pl:1 and fi:1 for g1_lang_counts",
      "evidence": {
        "callId": "call_00_UwmcRMzhYADKZRUwPQzV8314",
        "excerpt": "{\n  \"result\": {\n    \"counts\": {\n      \"pl\": 1,\n      \"fi\": 1\n    },\n    \"total\": 2\n  },\n  \"logs\": [\n    \"tool_mode_accounting:{\\\"toolCalls\\\":1,\\\"calls\\\":[{\\\"callId\\\":\\\"call_1\\\",\\\"name\\\":\\\"g1_lang_counts\\\",\\\"ok\\\":true,\\\"e"
      }
    },
    {
      "id": "R1-workflow-spelling",
      "status": "measured",
      "detail": "the paired result produced pl:1 and fi:1 for workflow_g1_lang_counts",
      "evidence": {
        "callId": "call_00_ET_pX7MhsltMT5oYNXTj4pE6967",
        "excerpt": "{\n  \"result\": {\n    \"counts\": {\n      \"pl\": 1,\n      \"fi\": 1\n    },\n    \"total\": 2\n  },\n  \"logs\": [\n    \"tool_mode_accounting:{\\\"toolCalls\\\":1,\\\"calls\\\":[{\\\"callId\\\":\\\"call_1\\\",\\\"name\\\":\\\"workflow_g1_lang_counts\\\",\\\"ok\\\""
      }
    },
    {
      "id": "R4-unknown-name",
      "status": "measured",
      "detail": "the refusal result names the unknown tool",
      "evidence": {
        "excerpt": "tool/result tool tool call_00_X4mjafVhHUo5eKUzOBVM3402 call_00_X4mjafVhHUo5eKUzOBVM3402 text Error: the program requested tools it cannot bind:\n  nonexistent_probe_tool: not-registered at session scope (session-19fa58c0-7092-4697-b422-10ddad58658b) — Install or activate the tool, or check the spelli"
      }
    },
    {
      "id": "R4-list-bindable",
      "status": "measured",
      "detail": "list rows expose bindable",
      "evidence": {
        "excerpt": "utionKind\": \"host\",\n      \"recipeDigest\": null,\n      \"contract\": null,\n      \"contractVersion\": null,\n      \"schemaAvailable\": true,\n      \"bindable\": false\n    },\n    {\n      \"name\": \"tool_mode_list\",\n      \"description\": \"List the tools this caller may use. `tools` are the names that can be CALLE"
      }
    }
  ],
  "failed": []
}
```

## Not asserted by this harness (stated, not implied)

- **R2** (every digest-advertised artifact executes as printed) is proxied by the one fixture
  line this transcript contains; a full pass needs one program per digest line.
- **R5** (offer acceptance yields a runnable artifact or refuses by name) needs an offer to be
  triggered and accepted; a plain headless run produces none.
- The probe reads a transcript; it cannot prove which module graph the running process held.
