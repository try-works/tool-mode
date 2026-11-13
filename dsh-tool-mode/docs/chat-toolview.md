# Chat tool view for Tool Mode calls

The generic tool card already shows a call's name, arguments and raw JSON. This view adds
the fields a reader of this plugin needs:

## Code Mode (`tool_mode_run`)

`tool_mode_run` gets its own card because its result is a **program**: a description, the
tool set it could call, an ordered sub-call trace, logs, and the program's result. The trace
is the only place a reader can see how tools were combined — the tool result itself only
reported a count.

The runner records that trace (`meta.calls`): per sub-call `name`, `ok`, `elapsedMs`, an
argument preview and a result preview (or `error`), capped at **50** entries and **160**
characters per preview. The COUNT is never truncated, so a long run still reports its real
size; the trace is provenance, not a data dump.

## How Code Mode is released (CODE-09 + CODE-10)

Exposure needs BOTH the operator grant (`hostedCode: true`) AND confinement evidence.
The evidence is now a **durable, auditable artifact** rather than a test-only flag:

1. **Record it** — `node packages/dsh-tool-mode/scripts/record-confinement-evidence.mjs`
   runs the confinement acceptance suite (`tests/ptc-sandbox.test.ts`, on the real Node PTC
   backend) in a provisioned temp root, and writes
   `verification/ptc-confinement-evidence.json` **only when every arm passes with none
   skipped**. A partial run (e.g. 2 pass / 3 skipped) is refused: a skipped arm never
   proved anything.
2. **Installed for normal hosts automatically** — the recorder also writes
   `~/.dsh/ptc-confinement-evidence.json`, and the runtime reads that standard location when
   `DSH_PTC_CONFINEMENT_EVIDENCE` is unset. A host started normally therefore has a release
   path; a wrapper launcher is not required. The variable still overrides the path, and an
   explicit but broken path fails **closed** (it never silently falls back).
3. **Validate at run time** — the artifact's kind, schema version, pass flag, package
   version, platform, timestamp, test list, command and counts are checked. A missing,
   malformed, failed, stale (different package version) or partial artifact closes the gate
   with its reason; it is never "some file exists".

With the grant but no valid artifact, `tool_mode_run` refuses with the reason, e.g.:

> generated-code execution is withheld until the confinement tests pass (no confinement
> evidence is configured (set DSH_PTC_CONFINEMENT_EVIDENCE to the artifact written by
> scripts/record-confinement-evidence.mjs)); the runtime is mounted and usable in-process,
> and no production client is served it

### Current state on this host — Code Mode RUNS end to end

All five confinement arms pass (5 tests, 5 pass, 0 skipped) and the evidence is recorded
for package **0.5.11**. A live run through the real plugin pipeline (grant + evidence +
workspace-write sandbox) returned:

```json
{ "result": { "language": "fr", "fixture": true },
  "meta": { "receiptId": "rcpt_000001", "elapsedMs": 2437, "toolCalls": 1,
            "calls": [{ "name": "lang_detect", "ok": true, "elapsedMs": 10,
                        "argumentsPreview": "{\"text\":\"bonjour\"}",
                        "resultPreview": "{\"text\":\"bonjour\",\"language\":\"fr\",\"fixture\":true}" }] } }
```

Two things had to be fixed to get there, both real:

1. **The confinement suite was misconfigured, not Windows.** It mounted the sandbox policy
   without a workspace root, so its write target (a directory under `%TEMP%`) was *outside*
   the declared workspace and every workspace-write arm skipped or failed. Mounting the
   policy with `workspaceRoot: <the directory under test>` makes the arms exercise what
   they claim. (With that fixed, the Windows ACL runner enforces correctly.)
2. **`%TEMP%` could not host the sandbox grants.** The inherited ACL of the temp directory
   grants no WRITE_DAC, so ACL provisioning failed (`SetNamedSecurityInfoW … Win32 5`).
   The recorder now runs the suite in a dedicated temp root with an explicit FullControl
   ACE for the user, and `scripts/dsh-code-mode.ps1` starts the host the same way.

**To use Code Mode on the live host**, stop it and start it with the launcher:

```
pwsh -File scripts/dsh-code-mode.ps1 -Port 3080
```

That sets `DSH_PTC_CONFINEMENT_EVIDENCE` and an ACL-provisionable TMP/TEMP for the host.
The profile already carries `hostedCode: true`. The evidence is also discovered from
`~/.dsh` on a normally-started host, but the TEMP root is not: the Windows ACL sandbox
creates its private temp directory under `%TEMP%`, and the machine's own temp directory
cannot be provisioned (`icacls` on it does not complete). **Without the launcher the gate is
open and the program fails at sandbox init**; with it, a program runs confined and its card
shows the ordered trace.

## The other tools

- the **extension, implementation and version** that answered;
- the **route** (`device` or `remote harness`) as a badge;
- the **receipt id** (or an explicit "no receipt" when the tool's schema does not require the
  host envelope — see `docs/tool-expansion-results.md`, finding 1);
- a **family-specific summary**: vector dimensions and the first three values, cosine
  scores, decisions with confidence, extraction validity/attempts, group and ranking counts,
  the top audio window, and so on;
- the full arguments and result behind a disclosure.

## Where it lives

| Piece | Path |
|---|---|
| The authoring source (inlined at build time) | `client/toolmode-toolview.js` |
| Inlining step | `scripts/gen-client-catalog.mjs` (replaces `/*__TOOLVIEW_SOURCE__*/`) |
| Registration call | `client/index.template.js` → `toolviews.register(ctx)` |
| Generated browser bundle | `client/index.js` (do not edit; `npm run build:client`) |
| Pure-surface tests | `tests/client-toolview.test.ts` |

The harness dispatches the slot `tool.call.toolview` by **tool name**
(`@deepseek-ai/dsh-client-ui-tool`); a name with no registration falls back to the generic
card. The module claims one key per tool in `TOOL_NAMES`. Adding a tool from a new extension
means adding its name there — nothing else.

**Why it is inlined, not a chunk.** The client module service serves only the bundle file a
plugin declares as its client entry. A sibling chunk (`require.async('./toolmode-toolview.js')`)
answers **404**, `apply` warns, and every card silently falls back to the generic one — the
first version of this feature shipped a chunk and never appeared. Inlining makes the bundle
self-contained, and a test asserts there is no chunk fetch.

## Behaviour on unusual payloads

`summaryFor` only prints a sentence when the field it reads is present and of the right
type. A foreign or partial payload yields no summary at all rather than "valid false" or a
guessed score; the raw JSON remains available. A failed call shows its error reason; a call
still streaming shows its phase.

## Shipping

The source is inlined into `client/index.js`, which is part of the plugin package, so a UI
change ships with a plugin version bump and a host restart (client assets are served from the
plugin as loaded).
