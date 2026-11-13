# Custom tools — implementation plan

Status: **implemented** (see [custom-tools-verification.md](custom-tools-verification.md)).

This plan adds a **Create tool** tab to the Tool Insights page. Users can author a
tool manually or ask an agent to draft one, test it, save it, and make it available
to agents and optionally to MCP.

## 1. Scope

### In scope

- Durable, profile-scoped custom-tool records.
- Runtime registration through the real DSH tool registry (`ctx.tools.register` /
  `defineTool`).
- Three safe execution types: **HTTP**, **prompt**, **composite**.
- A manual form, JSON Schema editor, test panel, and versioned save.
- An agent draft assistant that fills the form but never saves or executes.
- Agent exposure immediately after save; MCP exposure opt-in.
- Custom tools appear in Tool Inventory, Tool Insights, and the MCP tab.
- Restart durability and enable/disable/delete.

### Non-goals for v1

- Arbitrary JavaScript or shell tools.
- Installing custom tools outside the profile store.
- Auto-saving an agent draft.
- Automatic MCP exposure.
- Multi-user authoring or cross-profile sharing.
- Running tools inside the client.

## 2. Definition of done

- A user can create and test an HTTP tool without writing code.
- A prompt tool and a composite tool can be created from the same form.
- Saving registers the tool; the next agent turn sees its name, description and
  input schema.
- The tool survives a host restart and remains callable.
- Disable/delete removes it from the agent tool list and (if exposed) MCP.
- MCP exposure is off by default; enabling it makes `tools/list` and `tools/call`
  work through the existing MCP pipeline.
- Tool Inventory shows it as `custom`, and Tool Insights records its calls.
- Invalid definitions, name collisions, SSRF attempts, secret leakage, cycles and
  timeouts have named refusals and tests.
- The client tab is keyboard-accessible, responsive, and has a narrow-screen layout.
- Clean-profile end-to-end evidence is captured.

## 2.1 Confirmed v1 decisions

1. **Composite tools are in v1.** They are a bounded sequential pipeline, not a
   general workflow engine: no loops, no recursion, maximum 10 steps, a tool
   allowlist, and an approval gate for destructive steps.
2. **Agent exposure is on by default.** A saved, enabled tool is visible to agents on
   their next turn; the user can disable it. Drafts are never exposed or saved
   automatically.

## 2.2 Confirmed security decisions

1. **Private networks: deny in v1.** HTTP tools may only target origins on the tool's
   explicit public-HTTPS allowlist. Loopback, private, link-local, multicast,
   unspecified and cloud-metadata addresses are refused even if DNS later resolves to
   them. There is no per-tool override in v1. A user who needs an internal API should
   expose it through an operator-controlled MCP/bridge endpoint, not by letting a
   user-authored tool probe the host network.
2. **Secrets use the DSH credential-reference seam.** A definition contains a
   reference name such as `WEATHER_API_KEY`, never a value. At execution the host
   resolves it through `ctx.credentials.resolve(credentialRef(name))`, per call.
   Missing credentials fail closed with a named error. Values are never written to
   the custom-tool store, returned to the client, or logged.

## 3. Architecture

```
Create-tool form ──► draft assistant (host model)
        │                    │
        └──── draft ◄────────┘
              │
        validate / test
              │
        custom-tool store (profile)
              │
        compile CustomToolRecord
              │
        ctx.tools.register(defineTool)
              │
   ┌──────────┼────────────┐
 agent turn  MCP host   Tool Inventory / Insights
```

The authoring record is the source of truth. The runtime definition is compiled from
it and never edited directly.

## 4. Data model

### 4.1 CustomToolRecord

```ts
interface CustomToolRecord {
  schemaVersion: 1
  id: string                 // stable id, e.g. "custom.weather-lookup"
  name: string               // DSH tool name, e.g. "custom_weather_lookup"
  title: string
  description: string
  parameters: JsonSchema      // object schema for arguments
  outputSchema?: JsonSchema
  kind: 'http' | 'prompt' | 'composite'
  execution: HttpExecution | PromptExecution | CompositeExecution
  policy: ToolPolicy
  examples: ToolExample[]
  version: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}
```

### 4.2 HTTP execution

```json
{
  "method": "GET",
  "url": "https://api.example.com/weather?q={{city}}",
  "headers": {
    "Authorization": { "secret": "WEATHER_API_KEY" }
  },
  "bodyTemplate": null,
  "response": { "extract": "current" }
}
```

- `{{arg}}` is the only templating syntax. It interpolates a scalar argument; it is
  never evaluated as code.
- JSON bodies are generated from a JSON template with `{{arg}}` leaves.
- `headers` may contain literal values or `{ "secret": "NAME" }` references.
  Secret values are resolved at execution time and never returned, logged, or
  persisted.
- `response.extract` is a dot-path subset, not a general expression language.

### 4.3 Prompt execution

```json
{
  "template": "Summarize the following text for {{audience}}: {{text}}",
  "model": null,
  "maxOutputTokens": 512,
  "outputSchema": { "type": "object", "...": "..." }
}
```

- Uses the deployment's configured harness model.
- No tool calls, no file access, no arbitrary code.
- If no model provider is composed, creation is allowed but **Test** and invocation
  return a named `prompt-provider-unavailable` refusal.

### 4.4 Composite execution

```json
{
  "steps": [
    { "tool": "weather_lookup", "args": { "city": "{{city}}" } },
    { "tool": "text_title", "args": { "text": "{{steps.0.result}}" } }
  ],
  "output": "{{steps.1.result}}"
}
```

- Only calls tools the profile already exposes.
- Maximum 10 steps, maximum 2 minutes total, no recursion, no cycles.
- Each step may be marked `requiresApproval`; destructive tools cannot run without
  an explicit user confirmation in the test panel and at runtime.
- A failed step stops the pipeline; no silent fallback.

### 4.5 Policy

```ts
interface ToolPolicy {
  timeoutMs: number                 // default 15s, max 120s
  readOnly: boolean                 // advisory to the agent
  networkOrigins: string[]          // exact origins for HTTP, e.g. https://api.example.com
  mcpExpose: boolean                // default false
  agentExpose: boolean              // default true
}
```

## 5. Storage and versioning

- Default root: `dirname(config.stateFile)/custom-tools/`.
- Each version is immutable:
  `<root>/<id>/<version>.json`.
- `<root>/index.json` stores the active version per id and enabled state, written
  atomically (temp file + rename).
- Editing creates `version + 1`; saving never mutates a compiled definition in place.
- On save, the service validates the record, writes the new version, compiles and
  registers it, then switches the active pointer.
- On delete, dispose the registration, remove the index entry, and leave prior
  version files for audit (or a future compaction).
- On host restart, apply loads the index and re-registers every enabled tool.

## 6. Runtime compilation

```ts
defineTool({
  name: record.name,
  description: record.description,
  parameters: record.parameters,
  output: {
    schema: record.outputSchema ?? { type: 'object', additionalProperties: true },
    render: (args, value) => [/* text or JSON content */],
  },
  timeoutMs: record.policy.timeoutMs,
  async execute(args, exec) { /* dispatch by kind */ },
  presentCall: args => ({ card: 'generic', title: record.title, kind: 'read' }),
})
```

Rules:

- Name must match `^custom_[a-z0-9_]+$`.
- Validate against the existing registry before registration; a collision refuses
  with `custom-tool-name-conflict`.
- Keep one disposer per active version. Disable/delete/rollback disposes it.
- The registry emits `tools/change`; agents see the new definition on their next
  turn.
- Tool owner is `custom`; Tool Inventory and Insights must treat it as a first-class
  origin.

## 7. Host service and Remote API

New host module: `packages/dsh-tool-mode/src/custom-tools/`.

Suggested members:

```ts
describe(): Promise<CustomToolsSnapshot>
draft(input: { prompt: string; current?: CustomToolDraft }): Promise<CustomToolDraftResult>
validate(draft: CustomToolDraft): Promise<ValidationReport>
test(draft: CustomToolDraft, args: JsonValue): Promise<TestResult>
save(draft: CustomToolDraft): Promise<CustomToolRecord>
setEnabled(id: string, enabled: boolean): Promise<CustomToolRecord>
delete(id: string): Promise<void>
```

Additive Remote methods on the existing `modelTools` namespace:

```text
customToolsDescribe
customToolsDraft
customToolsValidate
customToolsTest
customToolsSave
customToolsSetEnabled
customToolsDelete
```

Wire changes follow the existing `remote/spec.mjs` → generated artifacts pattern.
Older hosts without these methods must not break the page: the tab shows
`not available on this host` and the rest of Tool Insights keeps working.

## 8. Client UX

### Tab

Add a fifth tab: **Create tool** (deep link `#create`). Tab order:

`Tool Insights · Tool Inventory · MCP · Create tool · Settings`

The tab has two states:

1. **Empty/list state** — saved custom tools with enabled state and edit/clone/delete.
2. **Editor** — form plus assistant/test panels.

### Editor layout

- **Left: definition form**
  - Basics: title, name (auto-suggested from title), description, examples.
  - Inputs: argument table with add/remove, type, required, description, enum,
    default; raw JSON Schema preview.
  - Behavior: HTTP / prompt / composite; type-specific fields.
  - Output: optional schema and preview.
  - Policy: timeout, read-only, network origins, agent exposure, MCP exposure.
- **Right: assistant**
  - Prompt textarea and **Draft with agent** button.
  - Draft questions/warnings.
  - Per-field diff/apply; no automatic save.
- **Bottom: preview/test**
  - Agent-visible preview: name, description, parameters JSON.
  - Test arguments editor; **Test** button.
  - Request/response viewer with headers and secrets redacted.
  - **Save** disabled until validation passes.

### Interaction rules

- Agent drafts never overwrite user edits without an explicit apply.
- Secrets are shown only as names; values never enter client state.
- Unsaved changes trigger a confirm on tab/route change.
- Test uses the draft, not the saved record.
- On save, reset to the list and show the registered tool.

## 9. Agent draft assistant

Host method only; the client never calls a model directly.

```ts
draft({ prompt, current? }) -> {
  draft: CustomToolDraft,
  questions: string[],
  warnings: string[]
}
```

- Strict output schema (`CustomToolDraftSchema`) validated by zod.
- The model receives a system prompt describing the allowed kinds and security
  rules; it must not invent URLs, secret names, or auth details.
- No execution, network access, file access, or save in the draft path.
- Maximum one model call per request; timeout and token budgets apply.
- If the model provider is absent, return an `unavailable` result; the manual form
  still works.
- The result is a draft, never a trusted record; the same validation as manual save
  runs before registration.

## 10. Security and trust

### HTTP

- Require `policy.networkOrigins` to contain the target origin.
- Resolve DNS at execution time; reject loopback, private, link-local, multicast,
  unspecified, and cloud metadata addresses even if an allowlist is configured.
  There is no per-tool private-network override in v1.
- Revalidate after redirects; default `maxRedirects: 0`.
- Cap response bytes (default 1 MiB), timeout, and redirect count.
- Resolve `{ "secret": "NAME" }` through the host credential seam per call; missing
  credentials fail closed and values never enter the record or client.
- Redact `Authorization`, `Cookie`, and secret-backed headers in test output/logs.
- Do not forward agent-supplied headers beyond the definition.

### Prompt

- Treat input as data, never as instructions that can change policy.
- No tool access from the prompt path.
- Enforce output schema and max tokens.

### Composite

- Reject cycles and unknown tools.
- Enforce step/time limits and per-step approval for destructive tools.
- Do not allow a composite tool to call itself.

### General

- Custom tools are profile-scoped and disabled by default on import.
- MCP exposure is opt-in and uses the same token/grant model as built-ins.
- `model_tools` remains withheld from MCP by design.
- No arbitrary code execution in v1. Code tools require a separate sandbox design,
  explicit trust, and a different approval gate.

## 11. MCP and observability

- Default `mcpExpose: false`; withheld tools are named in the MCP tab.
- When true, add the compiled definition to the MCP host’s `listTools` and route
  `tools/call` through the same executor.
- Tool Inventory: `owner: 'custom'`, `kind: 'custom'`, state active/disabled,
  MCP exposed/withheld.
- Tool Insights: attribute calls to the custom tool and owner `custom`; the
  projection/ledger already record registry calls.
- The tool’s description and schema are the only model-visible fields; the
  definition and secrets stay host-side.

## 12. Implementation slices

### Slice 0 — decisions

- Confirm secret-reference source (existing credential store vs. new store).
- Confirm default network policy and private-network override.
- Confirm whether composite step approval is required in v1.
- Confirm tab order and default agent exposure.

### Slice 1 — record, store, validation (TDD)

- `custom-tools/schema.ts`, `store.ts`, `record.ts`.
- JSON Schema validation, name rules, version/index atomicity.
- Tests: round-trip, corrupt record, concurrent save, version immutability, delete.

### Slice 2 — compiler and registration

- Compile record → `defineTool`; register/dispose; restart restore.
- Name collision and duplicate active version tests.
- Tool Inventory owner mapping.

### Slice 3 — HTTP executor

- Template interpolation, secret references, response extraction.
- SSRF/private-address guard, origin allowlist, redirect/byte/time limits.
- Redaction tests and a local HTTP fixture.

### Slice 4 — manual Create-tool UI

- Form, argument table, JSON Schema editor, preview, test, save.
- Accessibility and narrow layout.
- Client tests for validation, dirty state, error display.

### Slice 5 — prompt and composite executors

- Prompt tool with fake provider in tests.
- Composite step limits, cycle refusal, approval gates.
- No-model-provider named refusal.

### Slice 6 — agent draft

- Host draft method, strict schema, provider-absent handling.
- Client diff/apply; no auto-save.
- Tests for malformed drafts, invented secrets, and refusal paths.

### Slice 7 — MCP, Inventory, Insights

- MCP exposure toggle and listing/call path.
- Inventory owner/kind and MCP column.
- Insights attribution and custom filters.
- Regression tests that `model_tools` stays withheld.

### Slice 8 — end-to-end verification

- Fresh disposable profile, empty custom-tool store.
- Create an HTTP tool manually; test; save; call from an agent; restart; call again.
- Create a prompt tool and a composite tool; verify real results.
- Enable MCP exposure; `tools/list`/`tools/call`; disable and confirm removal.
- Capture screenshots/JSON evidence; run anti-slop lint.

## 13. Test matrix

| Area | Required coverage |
|---|---|
| Schema | valid/invalid names, bad schemas, unsupported keywords |
| Store | atomic write, corrupt index, concurrent versions, delete |
| Compiler | defineTool shape, name collision, dispose |
| Restart | enabled tools re-register; disabled do not |
| HTTP | allowlist, SSRF, redirects, cap, timeout, redaction |
| Prompt | fake provider, output schema, provider absent |
| Composite | cycle, depth, timeout, destructive approval |
| Remote | additive methods, old-host fallback, error shapes |
| Client | tab, form validation, draft apply, test result, responsive |
| MCP | withheld default, expose/call, disable removes |
| Insights | owner `custom`, call and error accounting |

## 14. Acceptance evidence

- Unit/integration tests pass, including anti-slop lint.
- `gen-client-catalog --check` and `gen-remote-artifacts --check` pass.
- Disposable instance evidence:
  - tool created and tested;
  - agent call uses the real tool and returns a result;
  - host restart preserves it;
  - disable/delete removes it;
  - MCP withheld by default and callable only after opt-in;
  - no secret appears in client payloads, logs, or evidence.
- A short user-facing README section with an HTTP example and security notes.

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| SSRF / DNS rebinding | resolve and validate every request; deny private ranges; origin allowlist |
| Secret leakage | secret references only; redact test output; never persist values |
| Agent draft hallucination | strict schema, preview, test, user save only |
| Name collision | `custom_` prefix + registry check |
| Version/binding drift | immutable versions; dispose/re-register; restart test |
| Prompt injection | prompt tools cannot call tools or change policy |
| Composite runaway | step/time limits, cycle refusal, approvals |
| MCP over-exposure | default withheld, explicit toggle, existing grants |
| Schema evolution | `schemaVersion` and migration refusal for unknown versions |

## 16. Decisions

Resolved:

1. **Composite tools are v1**, with bounded steps and destructive-step approval.
2. **Agent exposure defaults on** after save; MCP remains opt-in.
3. **Private networks are denied in v1**, with no per-tool override.
4. **Secrets use `ctx.credentials` references** resolved per call; the MCP client
   credential store is not used for upstream API keys.
