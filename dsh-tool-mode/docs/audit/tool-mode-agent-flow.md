---
styles:
  plugin: (color=#e8eefc)
  core: (color=#eef7ee)
  engine: (color=#fdf0e6)
  outside: (color=#f4eefc)
---

## Components
- header: Request header (caption="pinned tool list", color=#d9ead3)
- prompt: System prompt assembly (caption="schemas + sections", color=#eef7ee)
- loop: Agent loop (color=#eef7ee)
- model: DeepSeek model (color=#eef7ee)
- tools: Tool registry (caption="ctx.tools", color=#eef7ee)
- exec: Tool execution pipeline (color=#eef7ee)
- boot: Tool Mode apply() boot (caption="once per host restart", color=#e8eefc)
- catalog: Catalog and config (caption="18 models · enabled set", color=#e8eefc)
- lifecycle: Extension lifecycle (caption="install then prepare then activate", color=#e8eefc)
- composer: Description composer (caption="when / when not / limits / example · 700 chars", color=#e8eefc)
- promptsec: Tool Mode prompt section (caption="readiness · discovery · receipts", color=#e8eefc)
- control: Control and discovery tools (caption="model_tools · tool_mode_*", color=#e8eefc)
- contracts: Contract tools (caption="text_embed · lang_detect · decision_*", color=#e8eefc)
- extools: Extension tools (caption="shape_recognize · enhance_speech", color=#e8eefc)
- skills: Catalog model skills (caption="one per model · whenToUse", color=#e8eefc)
- extskills: Extension manifest skills (caption="registerSkill · requiresTools gate", color=#e8eefc)
- readiness: Readiness gate (caption="failed · needs-preparation · prepared-cold", color=#e8eefc)
- engines: Model engines (caption="LiteRT · ONNX · declarative recipes", color=#fdf0e6)
- mcp: MCP gateway (caption="external clients · same composed text", color=#f4eefc)

## Workflows
### boot: Host load — when the tools are registered
Registration happens once per host process, not per chat turn. Since 0.5.63 every registration takes its model-facing description from one composer, so the registry and MCP cannot disagree.

#### load: The plugin applies its configuration
[tool-mode](#boot) reads [the catalog and config](#catalog): which models the operator enabled, which extensions are installed, and whether unavailable models may be exposed at all.

- boot -> catalog: reads enabled models and routes
- boot -> promptsec: registers one Tool Mode section

#### register: Control tools and contract tools enter the registry
The host always registers its control surface; every enabled model binds its contract tool. A model whose route cannot run stays unregistered unless `exposeUnavailable` is on. [The composer](#composer) turns the declared text into the model-facing description (purpose, when to use, when not to use, inputs/outputs, limits, one example).

- boot -> control: registers control tools
- control -> tools: registers model_tools and tool_mode tools
- catalog -> contracts: binds enabled model tools
- catalog -> composer: declared text and skill guidance
- composer -> contracts: composed description
- contracts -> tools: registers a contract tool

#### activate: Installed extensions publish their tools
The extension lifecycle activates installed packages. Manifest tools and declarative recipe tools register through [the composer](#composer); the readiness fact decides whether a model-backed tool is callable. Manifest skills are contributed too and registered by the host hook.

- lifecycle -> readiness: activation records readiness
- lifecycle -> extools: publishes manifest and recipe tools
- extools -> composer: manifest and recipe text
- composer -> extools: composed description
- extools -> tools: registers an extension tool
- lifecycle -> extskills: contributes declared skills
- extskills -> prompt: registers skill bodies
- readiness -> exec: gates every call

#### guide: Skills teach when to use the tools
The plugin registers one skill per catalog model when skills are enabled, and since 0.5.63 also registers the skills declared by extension manifests (resolving `requiresTools` tool ids through the manifest before gating). The harness advertises the skill catalog so the model can learn usage before calling anything.

- skills -> prompt: catalog model guidance
- extskills -> prompt: extension guidance

### turn: One model step — what the agent sees and how it decides
This repeats for every model step of every turn. Discovery through the control tools and Code Mode is detailed in the next workflow.

#### assemble: The prompt collects the model-facing schemas
[The tools service](#tools) wires every registered tool into [system prompt assembly](#prompt) as name, description and parameters. The description is the composed text, not the raw catalog or contract string: it carries when to use, when not to use, limits and one example. Registration is the filter; readiness is not. The PTC and tools-SDK sections describe Code Mode.

- tools -> prompt: wireSchemas with composed descriptions
- skills -> prompt: model and extension skill catalog
- promptsec -> prompt: readiness and discovery guidance

#### pin: The agent loop pins that list in the request header
The loop compares the assembled tools with the header in force. The header is the model-facing list; a schema or description change is an explicit additions-or-removals event, not a silent mutation.

- prompt -> loop: assembly.tools
- loop -> header: pinned tool schemas and descriptions
- header -> model: request carries the tool list

#### decide: The model chooses among the tools it can see
The model sees names, composed descriptions, parameter schemas and skill text, never the UI cards. It decides: answer without a tool, call a visible tool directly, load a skill first, or compose tools through Code Mode using the control tools. Embedding-family descriptions name the sibling to choose instead, so the choice is not left to the name alone.

- model -> exec: direct call to a visible tool

#### run: The call executes through the registry
Execution is the only place readiness is enforced. A failed or needs-preparation deployment refuses with its reason; prepared-cold loads the engine on first use; a contract tool dispatches to its provider.

- exec -> readiness: gates the selected tool
- readiness -> engines: dispatches to the provider
- engines -> exec: result or named refusal
- exec -> model: model-facing result

#### next: The step settles and the header may change
The result becomes context for the next step. If the tool set changed through activation or install, the loop logs a new header; otherwise the pinned list stays identical. Heavy-schema deferral is an opt-in flag (off by default): it marks selected schemas with deferLoading at registration, and the activation caveat is documented.

- exec -> model[0]
- loop -> header[0]
- header -> model[0]

### codemode: Code Mode — discovering tools the model cannot see directly
Code Mode is the second discovery path: the model sees tool_mode_run but not the bindings, so it must ask what exists.

#### open: The program door is visible
[tool_mode_run](#control) is a normal tool. Its description tells the model that Tool Mode tools are only reachable through a program.

- model -> control: tool_mode_run advertised

#### list: Ask what can be called here
`tool_mode_list` returns the permitted surface with readiness. `tool_mode_describe` returns the full schema, semantics, examples and unsupported cases for the selected names. Registered tools and unavailable models come back in separate lists (P4); only tools may be bound in a program.

- model -> control: tool_mode_list
- control -> tools: live permitted surface
- tools -> control: names and readiness
- model -> control: tool_mode_describe
- control -> model: schemas semantics examples

#### program: Write a program against the discovered bindings
The program's calls are real registry calls, so each sub-call passes the same readiness gate and produces its own receipt.

- model -> exec: tool_mode_run with program and tools
- exec -> readiness: gates each sub-call
- readiness -> engines: dispatches each sub-call
- exec -> model: program result and bounded trace

### external: MCP — when a non-DSH client calls the same tools
The MCP surface is a third consumer, not part of the model loop. Since 0.5.63 it publishes the SAME composed description as the registry, so an external client and the model read one text.

#### list: The external client asks what is exported
The MCP host publishes the plugin's contract tools and extension contributions, with withheld tools carrying their reason; the advertised description comes from [the composer](#composer).

- mcp -> tools: tools list from the MCP surface
- tools -> mcp: contracts and withheld reasons
- composer -> mcp: same composed description

#### call: The external client invokes a tool
The call enters the same execution pipeline as a model call, so readiness and receipts are not weaker on this path.

- mcp -> exec: callTool
- exec -> readiness: same gate as the model path