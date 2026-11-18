/**
 * dsh-tool-mode — install on-device models as DSH tools and skills.
 *
 * The plugin composes five layers: a JSON catalog describing every model, a
 * capability resolver that decides which of them can run in this process, an
 * adapter per runnable model, a registrar that turns each one into a DSH tool,
 * and a skill per tool that teaches the agent when to reach for it.
 *
 * Nothing is imported from a model package at plugin load, so a deployment that
 * installs none of them still starts cleanly and reports exactly what is
 * missing. A model only becomes a tool when its adapter can really invoke it.
 *
 * @module @try-works/dsh-tool-mode
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
// Type-only: resolves the required ctx.skills service declaration. The skill
// service is read opportunistically via ctx.get(), so it stays optional.
import type {} from '@deepseek-ai/dsh-skill'
import { loadCatalog, modelOperations } from './catalog.ts'
import { resolveCapability, type ResolvedModel } from './capability.ts'
import { createAdapter } from './adapters/index.ts'
import { registerModelTool, shouldDeferHeavySchema, toolSchemaBytes } from './registrar.ts'
import { registerContractTool, registerContractImplementationTool, type ContractBinding, type HostIdentity } from './bindings.ts'
import { contractToolDescription, extensionToolDescription } from './tool-description.ts'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createContributionRegistrar, type RegistrableTool } from './extension-registrar.ts'
import { createInvocationAuthority, resolveApprovedRoots } from './authority.ts'
import { createExternalGrantContext, createProgramRunner, TOOL_MODE_RUN_CONTRACT, PTC_SERVICE, type RunReport } from './tool-mode-run.ts'
import {
  agentToolContract,
  createAgentAuthoringStore,
  defaultAgentAuthoringFile,
  runAuthoredProgram,
  workflowToolName,
  type AgentToolDefinition,
  type AgentToolSummary,
  type AgentWorkflow,
  type AgentWorkflowSummary,
  type ArtifactScope,
} from './agent-authoring.ts'
import { ArtifactScopeError, buildScopeContext, type BuiltScopeContext } from './artifact-scope-context.ts'
import { registerAuthoringTools } from './authoring-surface.ts'
import { createArtifactUsageStore } from './artifact-usage.ts'
import { createRepetitionTracker, type RepetitionTracker } from './adoption-candidates.ts'
import { buildLibraryDigest } from './library-digest.ts'
import { registerRuntimeTools } from './runtime-surface.ts'
import { createModelToolsControl } from './discovery-surface.ts'
import { captureDisclosure } from './authoring-quality.ts'
import { createAuthoringLedger, type AuthoringReceipt } from './authoring-ledger.ts'
import { createRunCaptureStore, type RunCaptureStore } from './run-capture.ts'
import { createSessionLedger, type SessionLedger } from './session-ledger.ts'
import { findRepeatedShapes, type RepeatedShape } from './repeated-shapes.ts'
import {
  createSandboxTempScope,
  DEFAULT_SANDBOX_TEMP_MAX_AGE_MS,
  pruneSandboxTempRoot,
  resolveSandboxTempRoot,
} from './sandbox-temp.ts'
import { PACKAGE_VERSION } from './version.ts'
import { prepareDeclarative } from './harness-serving.ts'
import type { InvocationAccounting } from './invocation-accounting.ts'
import { createFileCredentialStore, defaultCredentialStoreFile } from './mcp/credential-store.ts'
import {
  CustomToolRegistrar,
  CustomToolStore,
  CustomToolsService,
  customToolExecutor,
  customToolPublishedTools,
  type CustomToolDispatchDeps,
} from './custom-tools/index.ts'
import { buildHarnessLlmProvider, discoverDefaultHarnessModel, resolveRunnableHarnessModel, type HarnessLlmRuntimeSurface, type HarnessModelConfig } from './harness-llm.ts'
import { chooseWithJev, JEV_CHOOSE_CONTRACT, JEV_JUDGMENTS_CONTRACT, JevError, judgeWithJev, type JevConfig } from './jev.ts'
import { combineDecision, DECISION_COMBINE_CONTRACT } from './decision-combine.ts'
import { DECISION_EVALUATE_CONTRACT, DECISION_ROUTE_CONTRACT, evaluateDecisions, routeConfidence } from './decision-evaluate.ts'
import { interpretRecipeResponse, parseRecipe, narrowBrokerPolicy, INITIAL_HOST_POLICY, type BrokerRecord, type LlmProvider, type RecipeManifest } from '@try-works/tool-mode-recipes'
import { createManagedWorkerRegistry } from './managed-workers.ts'
import { PROTECTED_BUILTIN_IDS } from './builtins.ts'
import { createDispatch, createDispatchForContract, describeDispatchFailure, resolveImplementation, type DispatchEnvironment, type DispatchManifest } from './extension-dispatch.ts'
import {
  captureToolSchemaSnapshot,
  describePlanningRejections,
  filterPlanningLiveTools,
  hasPlanningInputShape,
  offerToolsFromSnapshot,
  PLANNING_EXCLUDED_TOOLS,
  PLANNING_TOOL_INPUT_SCHEMA,
  PLANNING_TOOL_NAME,
  recheckProposals,
  type RegistryToolSchema,
  type ToolSchemaSnapshot,
} from './planning.ts'
import {
  discoverExtension,
  loadExtensionModule,
  resolveDeclarativeImplementations,
  resolveExtensionEntry,
  type ExtensionContextV1,
  type InstalledRecord } from '@try-works/tool-mode-extension-sdk'
import type { JsonValue } from './adapters/types.ts'
import { ExtensionStore, ExtensionLifecycle, type LifecycleAuditEvent } from '@try-works/tool-mode-extension-sdk'
import { authorizeTool, createGrant } from './authority.ts'
import { isModelRuntimeRecipe, parseModelRuntimeRecipe } from './model-runtime-recipe.ts'
import { createModelRuntimeTool } from './model-runtime-lane.ts'
import { ProviderBridge } from './provider-bridge.ts'
import { createUpdateHostSurface, type UpdateHostSurface } from './update-surface.ts'
import { SubscriptionRegistry, deliverCatalogChange, MemoryDeliverySink } from './mcp/subscriptions.ts'
import { TOOL_MODE_DESCRIBE_CONTRACT, TOOL_MODE_LIST_CONTRACT } from './discovery-contracts.ts'
import { createBindingResolver } from './discovery-binding.ts'
import { registerDiscoveryControlTools } from './discovery-control.ts'
import { restoreExtensions } from './extension-lifecycle.ts'
import { startMcpSurface } from './mcp-surface.ts'
export { discoveryBucket } from './discovery-control.ts'
export { describeModelCard, describeModels } from './model-cards.ts'
export type {
  ModelDescriptor,
  ModelOperationCard,
  ModelParameterCard,
  ModelRuntimeCard,
} from './model-cards.ts'
import {
  createPreparedAssetRegistry,
  identityFor,
  lockGroups,
  parseAssetLock,
  plannedAssets,
  type LockGroup,
  type PrepareAssetsSurface,
  type PreparedAssetRegistry,
} from './prepared-assets.ts'
import { planPreparation } from './deployment-coordinator.ts'
import { createHttpSource } from './http-acquisition.ts'
import type { AcquisitionSource } from './asset-acquisition.ts'
import { buildSurface, type CatalogGeneration, type ImplementationCandidate } from './publication.ts'
import { admitsLogRecord, buildInvocationReceipt, buildLifecycleRecord, DEFAULT_LOG_POLICY, MAX_RETAINED_RECEIPTS, type LifecycleRecord } from './receipt.ts'
import { createReceiptSurface } from './receipt-surface.ts'
import { admit } from './resource-governance.ts'
import { createMcpHost, type PublishedTool } from './mcp/host-binding.ts'
import { normalizeCachePolicy } from './mcp/protocol.ts'
import { applyMcpExportPolicy } from './mcp/export-policy.ts'
import type { ClientGrantConfig } from './mcp/client-grant.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { STANDARD_CONTRACTS, assertAgainstSchema, assertValidContract, assertValidOutput, compileSchema, projectSchemaToDsh, toDshParameters, type ToolContract, type ToolMeta } from '@try-works/tool-mode-contracts'
import { renderSkillBody } from './skills.ts'
import { loadPlaybooks } from './playbook.ts'
import { commandExists, DEFAULT_CLI_COMMAND } from './transport.ts'
import {
  createFileStateStore,
  createMemoryStateStore,
  defaultStateFile,
  resolveDshHomePath,
  resolveSelection,
  withChoice,
  type PersistedState,
  type StateStore,
} from './state.ts'
import type { ModelCatalogEntry } from './types.ts'
import { runLegacyStartupMigration } from './legacy-migration.ts'
import { ApprovalStore } from './approval.ts'
import { createExtensionsService, DEFAULT_TRUSTED_PREBUILT_DEPENDENCIES, selectInstalled, type HarnessProviderStatus } from './extensions-service.ts'
import { provideModelToolsService } from './extensions-remote.ts'
import { installVozSpeechProvider, type SpeechRegistryLike } from './speech-bridge.ts'
import type { ModelToolsRemote, McpCallsQuery, ToolSourceRow, UsageReportQuery } from './extensions-api.ts'
import { TOOL_USAGE_KEY, toolUsageDayKey, toolUsageProjectionDefinition, type ToolUsageState } from './tool-usage-projection.ts'
import { buildUsageReport, rangeWindow, type SessionUsageInput, type UsageReport, type UsageRange } from './tool-usage-report.ts'
import { buildToolInventory } from './tool-inventory.ts'
import { resolveToolOwner, staticToolOwner, TOOL_MODE_OWNER } from './tool-sources.ts'
import { McpUsageLedger, recordFromAccounting } from './mcp-usage.ts'
import { buildMcpStatus, type McpStatusView } from './mcp-status.ts'
import type { BoundEndpoint } from './mcp/http.ts'
import type { SessionEvent, SessionHeader, SessionLogOffset, SessionStore } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition, SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'

export const name = 'model-tools'
export const inject = ['tools']

/**
 * The version this host reports in every receipt and MCP `serverInfo`.
 *
 * Read from the shipped manifest: the previous hard-coded `'0.1.1'` was stale by four
 * minor versions, so provenance named a build nobody could match to a release.
 */
const HOST_VERSION = PACKAGE_VERSION

/** Largest extension tool schema read at registration, in bytes. */
const MAX_SCHEMA_BYTES = 512 * 1024

/**
 * Largest extension SKILL body loaded into the prompt, in bytes.
 *
 * A manifest skill is markdown guidance that rides the context; a package must not be
 * able to put unbounded bytes there. The body is refused (and the activation kept) over
 * this cap, which is the same size class as the tool-schema cap above.
 */
const MAX_SKILL_BYTES = 512 * 1024

/** The DSH value-schema keywords a recipe input may advertise (mirrors contracts/dsh.ts's DSH_SUPPORTED). */
const DSH_PARAMETER_KEYWORDS = new Set([
  'type', 'enum', 'const', 'description', 'default', 'examples',
  'items', 'properties', 'additionalProperties', 'required',
])

/**
 * THE ONE Tool Mode system-prompt section (P5).
 *
 * It says the four things a model cannot learn from a single tool description: the
 * callable/unavailable split, "list and describe before you compose", that a
 * prepared-cold model loads on its first call, and that receipts exist per call.
 *
 * It is deliberately NON-COMPLETE and bounded: an agent preset that supplies its own
 * complete section must remain the sole prompt, and this contribution must never fight
 * for the whole prompt. Keep it under 1200 characters; the test pins the text.
 */
const TOOL_MODE_PROMPT_SECTION = `## Tool Mode
On-device model tools run beside your other tools.

- **callable vs unavailable.** \`tool_mode_list\` splits callable tools (\`tools\`) from catalogued-but-unavailable models (\`unavailable\`, with state and reason). A program may bind only rows with \`bindable: true\`; control tools are callable but not bindable.
- **list and describe first in Code Mode.** Call \`tool_mode_list\`, then \`tool_mode_describe\` for schemas. A non-callable name returns \`callable: false\` with the reason and clearing action.
- **prepared-cold loads on the first call.** A \`prepared-cold\` model starts its engine on its first call, which is slower and may exceed the timeout; retry once.
- **per-call receipts.** Every invocation records a receipt; read them with \`model_tools\` action \`receipts\` instead of re-running a call.
- **author your own.** \`tool_mode_workflows\` saves/re-runs programs; \`tool_mode_tools\` defines persistent \`agent_*\` tools (callable after the defining run; a program's bindings are fixed at start). Running is gated.`

/** Plugin configuration. */
export interface Config {
  /** Catalog document to load; defaults to the bundled Desert Ant catalog. */
  catalogFile?: string
  /** Playbook document to load; defaults to the bundled playbooks. */
  playbookFile?: string
  /**
   * Model ids to expose. An empty list (the default) means every model that can
   * run here; a non-empty list is intersected with what can run, so naming an
   * unsupported model never registers a tool that would fail at call time.
   *
   * The field is an empty array rather than `undefined` when unset: the config
   * schema materializes a declared array, so the code treats empty as "no
   * explicit allowlist" instead of "expose nothing".
   */
  models?: string[]
  /** Model ids to exclude, applied after `models`. */
  exclude?: string[]
  /**
   * Register a tool for a model whose runtime is missing, so the failure is
   * reported at call time instead of the tool being absent. Off by default:
   * exposing a tool that cannot work wastes a model turn.
   */
  exposeUnavailable?: boolean
  /** Publish one skill per registered tool. Default true. */
  registerSkills?: boolean
  /** Register the `model_tools` inspection tool. Default true. */
  registerControlTool?: boolean
  /**
   * Register the separate management tool (`model_tools_manage`). Default false:
   * discovery (`model_tools`) is read-only unless the operator explicitly grants
   * model/extension/credential mutations.
   */
  managementGrant?: boolean
  /**
   * Tool names whose canonical result is confidential (MCP-11). They are blocked at
   * the MCP and Code Mode boundaries before any value is returned; native callers
   * unaffected by this external-surface policy.
   */
  confidentialTools?: string[]
  /**
   * The operator's CONSENT to hosted code execution (CODE-10).
   *
   * Code execution is a SEPARATE consent from ordinary model-tool access, and it
   * ships disabled until granted. This flag is the grant: the operator turns it
   * on explicitly. It is checked in addition to — never instead of — the
   * confinement gate (CODE-09), which remains closed until the confinement
   * acceptance tests pass, so flipping this flag alone cannot expose the runtime.
   * Default false.
   */
  hostedCode?: boolean
  /**
   * Agent-authored workflows and tools (default TRUE).
   *
   * When on, the host exposes `tool_mode_workflows` (save/version/run programs) and
   * `tool_mode_tools` (define persistent `agent_*` tools). Authored code runs ONLY through
   * the same confined runner `tool_mode_run` uses, so this flag changes what can be
   * STORED and NAMED, never how code is confined. Off removes both surfaces and does not
   * register any stored authored tool.
   */
  allowAgentAuthoring?: boolean
  /** Where authored workflows/tools are stored; default is beside the state file. */
  agentAuthoringFile?: string
  /**
   * Capture successful Code Mode run programs for define-from-run (default TRUE).
   * The capture stores the program and a shape-only input schema, never input values.
   */
  captureRunPrograms?: boolean
  /** Where run captures are stored; default is beside the authoring file. */
  runCaptureFile?: string
  /**
   * Adoption experiments. All levers are OFF by default; enabling one is an
   * explicit experiment arm choice, never an implicit prompt change.
   */
  adoption?: {
    /** Offer a save after repeated identical calls. */
    saveOffer?: boolean
    /** Show a bounded caller-scoped artifact digest. */
    digest?: boolean
    /** Prewarm the top listed tool after enable. */
    prewarmAfterEnable?: boolean
    /** Identical calls before a save offer (default 3). */
    maxRepeats?: number
  }
  /**
   * Authored-artifact scoping. Disabled by default: every artifact is global and
   * behaviour is byte-identical to the pre-scoping store.
   */
  artifactScopes?: {
    enabled?: boolean
    defaultScope?: 'session' | 'workspace' | 'global'
    workspaceRoot?: string
    globalPromotion?: 'human' | 'off'
    promoteMinUses?: number
    expireSessionArtifacts?: boolean
  }
  /**
   * The temp root DSH's PTC sandbox is pointed at (Windows ACL fix).
   *
   * On Windows the `windows-acl` sandbox creates a private temp directory with
   * `os.tmpdir()` and writes a DACL on it. An inherited TEMP/TMP on a volume that refuses
   * `SetNamedSecurityInfoW` (Win32 5) makes Code Mode fail with an AclSandbox error. When
   * resolved, the plugin points TEMP/TMP at this directory for each Code Mode run and
   * restores them afterwards; the host lifetime never owns the process-global override.
   *
   * RESOLUTION: unset -> on Windows `~/.dsh/tool-mode-sandbox/tmp`, elsewhere no override;
   * an absolute path -> use it; an empty string -> DISABLE the override explicitly.
   */
  sandboxTempRoot?: string
  /**
   * LIC-04: a strict no-network deployment. Extensions whose DECLARED network
   * behaviour is not eligible are refused at activation, rather than having their
   * telemetry silently suppressed. Default `any`.
   */
  networkPolicy?: 'any' | 'no-network'
  /**
   * The Desert Ant CLI transport, which runs on macOS and Linux and can reach
   * every shipping model — including the Apple-only ones that have no npm
   * package.
   */
  cli?: {
    /** Whether the CLI may be used when it is found on PATH. Default true. */
    enabled?: boolean
    /** Command name or absolute path. Default `desertant`. */
    command?: string
  }
  /**
   * A user-hosted bridge, reached over HTTP, for models this machine cannot run
   * itself — most importantly the Apple-only models.
   *
   * The plugin does not run this service; the user does, on a machine that can
   * execute the model. The licence forbids re-hosting the models as a service,
   * so point this at your own machine.
   */
  remote?: {
    /** Bridge base URL, for example `http://mac-studio.local:8787`. */
    endpoint?: string
    /** Optional bearer token sent to the bridge. */
    token?: string
  }
  /**
   * Whether in-process npm packages may be used. Set false to force every call
   * through the CLI or the bridge. Default true.
   */
  allowNpm?: boolean
  /**
   * Where the user's enable/disable choices are persisted. Defaults to
   * `<DSH_HOME>/model-as-tool/state.json`.
   */
  stateFile?: string
  /**
   * Root of the profile-scoped custom-tool store. Defaults to
   * `<dirname(stateFile)>/custom-tools`.
   */
  customToolsDir?: string
  /** Whether the custom-tools service loads and registers tools. Default true. */
  customToolsEnabled?: boolean
  /**
   * Where generated external MCP client credentials are persisted (SEC-01).
   *
   * Defaults to `<DSH_HOME>/model-as-tool/credentials.json`, next to the state file,
   * so the store inherits the operator profile's owner-only protection. A deployment
   * that disables persistence refuses generation rather than issuing a credential a
   * restart would forget.
   */
  credentialsFile?: string
  /**
   * Directory of the operator-owned EXTENSION store.
   *
   * When set, the host mounts the extension lifecycle and restores the extensions the
   * operator approved as active. A RELATIVE path resolves under the DSH home
   * (`DSH_HOME`, or `~/.dsh`), so `profiles/web/extensions` works on any machine. Left unset, no extension is mounted and behaviour is
   * exactly as before - which is why this is a directory rather than a boolean: an
   * absent directory is a deployment that has no extensions, not one that forbade them.
   */
  extensionStore?: string
  /**
   * Directory that holds first-party extension PACKAGE checkouts, one directory per
   * package, for the Settings → Model as Tool install path.
   *
   * A package lives in the directory named by its final identity segment: a package
   * `@try-works/extension-laya` is installed from
   * `<extensionSourceDir>/extension-laya`. Left empty, no first-party source is
   * advertised and `describe()` reports `sourceDir: null`; an install then needs an
   * explicit source directory.
   *
   * This is DEVELOPER MODE (EXT-06): the directory is only ever used when
   * `extensions.allowSourceDirectories` explicitly allows it, the installer copies
   * the tree rather than linking it, and the installation lands INACTIVE.
   */
  extensionSourceDir?: string
  /**
   * How an install with no explicit source directory gets its package bytes.
   *
   * - `registry`: resolve the package from the npm registry (`extensionRegistry`),
   *   verify the registry-declared sha512 and install the tarball.
   * - `directory`: the developer-mode source-directory path above.
   * - `auto` (default): prefer the registry; fall back to the source directory
   *   ONLY when the registry is unreachable (transport/timeout/5xx/unconfigured)
   *   and `extensions.allowSourceDirectories` is on. A package-level registry
   *   refusal (404, missing integrity, bad tarball, digest mismatch) is always a
   *   named error and is NEVER silently retried against a local directory.
   */
  extensionInstallSource?: 'registry' | 'directory' | 'auto'
  /**
   * The npm registry registry installs resolve against. Defaults to the public
   * npm registry; set it empty to disable the registry route (directory installs
   * still need `extensions.allowSourceDirectories`).
   */
  extensionRegistry?: string
  /** Hard cap on one registry package tarball download. Default 256 MiB. */
  extensionTarballMaxBytes?: number
  /**
   * IDLE timeout for one registry tarball download, in ms. Default 10 minutes.
   * Applies only when NO bytes arrive; a slow large download is not aborted.
   */
  extensionTarballTimeoutMs?: number
  /** Registry packument/metadata timeout in ms. Default 30 s. */
  extensionMetadataTimeoutMs?: number
  /**
   * Dependency-graph depth bound for registry installs. Default 12.
   *
   * Preinstalled dependencies are leaves (their own tree travels with them);
   * registry-resolved graphs are bounded by this, and a refusal names the level
   * and the package.
   */
  extensionDependencyDepth?: number
  /**
   * Package-count bound for dependency graphs (both arms). Default 256: the SDK
   * default of 64 refused the real transformers/minilm engine trees.
   */
  extensionDependencyPackages?: number
  /**
   * Operator gate: allow dependency content that arrived already materialized.
   *
   * OFF by default. When off, a declared dependency whose package.json carries
   * install-time scripts refuses (EXT-10), exactly as before. When on, the
   * resolver may supply the host's installed tree for such a dependency (for
   * example onnxruntime-node after the operator's npm ran its postinstall); the
   * SDK copies it into the extension's own installation directory and records
   * `provenance: 'preinstalled'` with the source — stating that the installer
   * did NOT run the scripts, rather than silently skipping them.
   */
  allowPreinstalledDependencies?: boolean
  /**
   * The root a preinstalled dependency directory must live under.
   *
   * Required when {@link allowPreinstalledDependencies} is on: the SDK refuses a
   * preinstalled directory outside it as a path escape. Point it at a root that
   * contains the host dependency tree (for example the repository or profile
   * root); never a world-writable location.
   */
  preinstalledDependenciesRoot?: string
  /**
   * Exact `name@version` dependencies whose published tarball ships prebuilt
   * runtime artifacts. Their lifecycle-script declarations are admitted but the
   * scripts are NEVER executed. Defaults to the first-party allowlist; an empty
   * array restores the strict EXT-10 refusal for every package.
   */
  trustedPrebuiltDependencies?: string[]
  /**
   * The operator's STANDING RES-02 approval for executable asset preparation
   * initiated from the client/Remote path (Settings → Model as Tool → Prepare).
   *
   * DEFAULT FALSE. With it off, a preparation plan that contains an executable
   * asset returns the exact RES-02 refusal: acquiring a downloaded engine is a
   * separate approval from approving a model download, not a checkbox riding along
   * with it. With it on, the Remote `prepare` call is the operator's approval for
   * every executable asset of the digest-pinned, first-party plans the host
   * resolves — which is why it should be enabled only for such engines, never for
   * an arbitrary package source. The management channel (`model_tools`
   * `extensions-prepare`) keeps its own PER-CALL `allowExecutable` flag and is not
   * affected by this setting.
   */
  allowExecutablePreparation?: boolean
  /**
   * SEC-09: require an explicit operator approval for extension ACTIVATION.
   *
   * OPT-IN, default false, and deliberately so for this slice: mounting the gate
   * unconditionally would turn the Settings Enable action — and every existing host
   * composition — into a pending refusal, because no approval UI/management path ships
   * yet. A deployment that has one turns this on; the default is the documented
   * PRE-APPROVED direct path, not a silent bypass (the switch is explicit).
   */
  requireActivationApproval?: boolean
  /** INTERNAL TEST SEAM: the acquisition source extensions-prepare uses instead
   * of the ranged HTTP source. A suite injects a local file source so the
   * acquisition path is exercised with ZERO network; a deployment never sets
   * this, and the default stays the real opt-in source. */
  assetSourceFactory?: () => AcquisitionSource
  /** TASK-99 test seams: the bounded-retry interval/cap (defaults 250 ms / 30 s). */
  harnessRetryIntervalMs?: number
  harnessRetryCapMs?: number
  /**
   * TASK-127 test seam: the retry SCHEDULER. A suite injects a fake
   * {setInterval, clearInterval} so the tests advance the retry by explicit
   * ticks instead of wall-clock (deterministic under full-suite load). A
   * deployment never sets this; the default is the global scheduler, so the
   * product behavior is byte-identical.
   */
  harnessRetryScheduler?: {
    setInterval: (handler: () => void, ms: number) => unknown
    clearInterval: (handle: unknown) => void
  }
  /**
   * TASK-131 (RC2): the prepared-assets cache root. Defaults to the
   * state-file-adjacent `<DSH_HOME>/model-as-tool/asset-cache`; a RELATIVE value
   * resolves under the DSH home. Set it to a larger volume only deliberately (the
   * embeddinggemma set is ~3.2 GB). The prepare preflight refuses with
   * `extension-asset-space-insufficient` when the free space cannot hold the missing bytes.
   */
  assetCacheRoot?: string
  /** TASK-131 test seam: the free-space probe the prepare preflight uses. */
  assetFreeSpaceProbe?: (path: string) => number
  /** §12 config v3: the nested shape + the fixed-false flags (see the zod). */
  schemaVersion?: number
  extensions?: {
    protocolMajor?: number
    manifestVersion?: string
    registry?: string
    allowHttpsArchives?: boolean
    allowLocalArchives?: boolean
    allowSourceDirectories?: boolean
    automaticUpdates?: boolean
    runInstallScripts?: boolean
  }
  mcpV3?: {
    enabled?: boolean
    protocolVersions?: string[]
    legacyCompatibility?: boolean
    host?: string
    port?: number
    path?: string
    /**
     * A file holding the operator bearer token, trimmed on read.
     *
     * DSH_TOOL_MODE_MCP_TOKEN still wins when set (a launch override); the file exists
     * so a desktop-launched host, whose environment the operator does not control, can
     * serve MCP with a durable credential. The raw token never enters this config.
     */
    tokenFile?: string
    allowedOrigins?: string[]
    /**
     * MCP-only export allowlist, separate from the native `models` selection.
     * `['*']` (the default) preserves the full surface; an empty list exports no
     * inference tools; otherwise only the exact listed names are published.
     */
    exportTools?: string[]
    /** Operator client-grant policy passed to the MCP server (see ClientGrantConfig). */
    grants?: ClientGrantConfig
    catalogTtlMs?: number
    catalogCacheScope?: string
    auth?: { mode?: string; authorizationServerProfile?: string | null }
  }
  compositionV3?: {
    enabled?: boolean
    defaultTimeoutMs?: number
    maxTimeoutMs?: number
    maxToolCalls?: number
    maxConcurrentBindings?: number
    maxHarnessModelCalls?: number
  }
  multimodalV3?: {
    defaultDimensions?: number
    defaultOverflow?: string
    maxVideoFrames?: number
    audioSampleRateHz?: number
    selectiveEncoderLoading?: boolean
  }
  harnessExecutorV3?: {
    enabled?: boolean
    nativeSelection?: string
    externalDefaultProfile?: string | null
    profiles?: Readonly<Record<string, unknown>>[]
    defaultMaxAttempts?: number
    defaultRepairAttempts?: number
    defaultMaxOutputTokens?: number
    defaultTimeoutMs?: number
    inheritConversation?: boolean
    allowModelToolCalls?: boolean
  }
  recipesV3?: {
    schemaVersion?: string
    allowLocalAuthoring?: boolean
    automaticActivation?: boolean
    allowExecutableTemplates?: boolean
  }
  clientsV3?: Readonly<Record<string, unknown>>[]
  captureV3?: {
    bodies?: boolean
    retentionDays?: number
    maxBytes?: number
    auxiliaryLlmJournal?: { enabled?: boolean; retentionDays?: number }
  }
  /**
   * Whether `enable`/`disable` persist across restarts. Default true; false
   * restores the earlier session-scoped behaviour.
   */
  persist?: boolean
  /**
   * Which model serves each standard contract, as `{ "stt.transcribe": "voz" }`.
   *
   * Provider selection is host configuration (BASE-02), not something a caller
   * chooses per call. An override naming a model that cannot run here is ignored
   * in favour of the first eligible implementation rather than silently
   * registering a tool that would fail.
   */
  providers?: Record<string, string>
  /**
   * Register the deprecated per-model compatibility aliases.
   *
   * Off by default so they stay out of the default catalog and a caller sees one
   * transcription tool rather than two (BASE-03). When on, the alias keeps its
   * original argument and result contract through a tested adapter — it is never
   * silently reinterpreted as the new contract.
   */
  legacyAliases?: boolean
  /**
   * Filesystem roots this deployment authorizes (SEC-06).
   *
   * Empty by default, which fails closed: a path-bearing tool then refuses every
   * call rather than admitting an arbitrary path. An operator adds the roots this
   * machine may read from. A RELATIVE entry resolves against the DSH home
   * (`DSH_HOME`, or `~/.dsh`), so `["files"]` means `<DSH_HOME>/files` on every
   * machine; an absolute entry is still accepted for a deliberate volume root but
   * is not portable.
   */
  approvedRoots?: string[]
  /** Grant identity recorded in receipts; defaults to `local-interactive`. */
  grantId?: string
  /** Whether receipts may be recorded (SEC-03); default true. */
  recordReceipts?: boolean
  /**
   * The CODE-11 repair-attempt ceiling for bounded-repair tools.
   *
   * The FLAT key is the deprecated-alias-compatible spelling that drives
   * behaviour; `harnessExecutorV3.defaultRepairAttempts` is its v3 equivalent.
   * An integer 0..8; 0 disables repairs. Default 1. An invalid value refuses
   * at config parse, never silently clamps.
   */
  repairAttempts?: number
  /**
   * Which capture profile this deployment runs under (OBS-03).
   *
   * `standard` is the default. `metadata-only` is for a headless local-specialist deployment: it
   * REFUSES harness-backed execution where a no-retention policy cannot be honoured alongside
   * DSH's requirement that model-visible inputs be reconstructable — rather than logging bodies
   * against the policy or bypassing DSH, both of which are forbidden.
   */
  captureProfile?: 'standard' | 'metadata-only'
  /**
   * The deployment's harness provider, for executing DECLARATIVE packages (HLM-01).
   *
   * Supplied by the DEPLOYMENT rather than constructed here, because which model answers a
   * harness call is not this plugin's business — and the architecture gate forbids
   * model-specific code in the host. Absent means a declarative package resolves but is not
   * served, and the refusal says so at preparation rather than at the first invocation.
   */
  harnessProvider?: LlmProvider
  /**
   * Operator-bound logical executor profiles for approved-profile recipes
   * (HLM-02/RCP-05). Each binding is a provider plus the version the operator
   * approved; an unresolved profile makes the recipe's tool unavailable.
   */
  harnessProfiles?: Readonly<Record<string, { readonly provider: LlmProvider; readonly version: string }>>
  /**
   * Opt the host INTO a REAL DSH-backed harness provider (HLM-01/02/03).
   *
   * DEFAULT OFF: absent, nothing is wired and every existing test and packed probe is
   * unchanged. When set, the host builds a {@link DshLlmProvider} over the deployment's
   * DSH LLM surface (`ctx.llm`), reading the model's OWN capability descriptor, and uses
   * it for declarative recipes — with the image transport minted only when the DSH
   * attachment service is reachable, otherwise capabilities honestly report `unknown`
   * and the broker refuses image recipes rather than dropping them. An explicit
   * `harnessProvider` wins over this option (test doubles and prebuilt providers).
   */
  harnessModel?: HarnessModelConfig
  /**
   * Optional remote Jev (TypeSafe System One) provider (TOOL-02, DEC-07).
   *
   * Jev is a remote typed-question API, never local weights. When `enabled`, the
   * host registers `decision_choose_jev` on the standard `decision.choose`
   * contract. The key comes from `apiKey`, then the DSH credentials service
   * (`credentialRef`, default `jev/api-key`), then `apiKeyEnv` (default
   * `TYPESAFE_API_KEY`); a missing key is a diagnostic, never a fake answer.
   */
  jev?: JevConfig
  /**
   * Opt the host INTO routing extension invocations through managed worker
   * processes (EXT-20).
   *
   * DEFAULT OFF: absent, every extension runs in-process exactly as before, and no
   * child process is ever spawned by this plugin. When set, each extension's module
   * entry runs in a scrubbed-environment managed process — ONE process per extension
   * per activation generation, disposed when the generation advances — and the host's
   * dispatch discipline is unchanged: grant authorization and schema validation stay
   * HOST-side before the worker call, and the worker's result is validated against
   * the declared output schema exactly like the in-process path.
   */
  managedWorkers?: boolean
  /** Maximum one managed-worker invoke may wait before it is failed and disposed. */
  managedWorkerInvokeTimeoutMs?: number
  /**
   * Auto-provision the plugin's first-party extensions on boot (DEFAULT false).
   *
   * After the restore pass, the host installs every first-party extension that is
   * available from the configured source directory (or already installed), prepares
   * the assets the readiness report names as the blocker, and activates it — in the
   * background, without blocking plugin load and without bypassing an operator
   * refusal. `disabledExtensions` always wins. Set false to keep provisioning manual.
   */
  autoProvisionExtensions?: boolean
  /**
   * P3 of the agent tool-selection plan: request DEFERRED LOADING for heavy schemas
   * (DEFAULT false).
   *
   * When true, the model-facing declaration of a selected tool carries
   * `deferLoading: true`. The selection is the pure helper in the registrar: the six explicit
   * ids (`multimodal_embed`, `media_find_moments`, `extract_with_repair`,
   * `structured_extract`, `tools_plan`, `semantic_*`) plus any declaration whose serialized
   * name+description+parameters exceed 1024 bytes. The catalog and `tool_mode_list` stay the
   * on-demand index, so a deferred tool remains discoverable, and the MCP surface is
   * unchanged (contract-based exports never carry the marker).
   *
   * DSH CAVEAT, so this is not sold as a byte win it may not be: the DeepSeek serializer
   * still writes name/description/input_schema for a deferred tool and appends
   * `defer_loading`; activation needs a `developer/message` `tool-addition`, which the harness
   * emits when the tool LIST changes. With a stable first-party tool list no tool-addition is
   * emitted, so the flag is a provider loading hint and NOT a local request-byte reduction.
   * Default off keeps every existing probe unchanged until the activation path is wired.
   * See docs/audit/deferred-loading.md for the operator-facing semantics and the selected ids.
   */
  deferHeavySchemas?: boolean
  /**
   * Extension ids the operator switched OFF in Settings.
   *
   * The store still holds them and their desired activation is unchanged; the
   * host simply does not restore them, so their tools never register. Removing
   * an id re-activates the extension on the next load.
   */
  disabledExtensions?: string[]
  /**
   * Environment names to pass through to managed workers, on top of the SDK's
   * bootstrap allowlist. Explicit names only — never `process.env` wholesale.
   */
  workerEnvPassthrough?: string[]
  /** Hard resource limits overriding the conservative defaults. */
  limits?: {
    maxInputBytes?: number
    maxAudioSeconds?: number
    maxResultBytes?: number
    maxModelCalls?: number
    maxOutputTokens?: number
    maxImages?: number
    deadlineMs?: number
  }
}

/** Validate and default the plugin configuration. */
/**
 * Mark one Config field as Settings-UI editable.
 *
 * schemastery exposes a field to the settings mirror only when it carries the
 * volatile marker (the reference plugin `@try-works/dsh-memory` documents this:
 * "Only .volatile() fields are exposed to the Settings UI and may be written by
 * the config editor"). `.volatile()` also narrows the schema's inferred type, so
 * this helper keeps the declared `z<Config>` surface intact.
 * @param schema - the field schema.
 * @returns the same schema with the runtime volatile marker.
 */
function settingsField<T>(schema: z<T>): z<T> {
  return schema.volatile() as unknown as z<T>
}

export const Config: z<Config> = z.object({
  catalogFile: z.string(),
  playbookFile: z.string(),
  stateFile: z.string(),
  customToolsDir: z.string().default(''),
  customToolsEnabled: z.boolean().default(true),
  credentialsFile: z.string(),
  /**
   * Where first-party extension package checkouts live (developer-mode installs).
   * Empty by default: a deployment with no first-party source advertises none.
   */
  extensionSourceDir: z.string().default(''),
  /**
   * Install route for the Settings page: registry, directory, or auto (registry
   * first, directory only for a transport failure when directory installs are
   * allowed). Default auto.
   */
  extensionInstallSource: z.union([z.const('registry'), z.const('directory'), z.const('auto')]).default('auto'),
  /** npm registry base URL; empty disables the registry route. Default: public npm. */
  extensionRegistry: z.string().default('https://registry.npmjs.org/'),
  /** Hard cap on one registry tarball download, in bytes. Default 256 MiB. */
  extensionTarballMaxBytes: z.number().min(1).default(256 * 1024 * 1024),
  /**
   * IDLE timeout for one registry tarball download, in ms. Default 10 minutes.
   * Aborts only when NO bytes arrive for this long; a large dependency streaming
   * slowly is not aborted by the short package-metadata timeout.
   */
  extensionTarballTimeoutMs: z.number().min(1000).default(10 * 60_000),
  extensionMetadataTimeoutMs: z.number().min(1000).default(30_000),
  /** Depth bound for registry dependency graphs. Default 12 (SDK default is 3). */
  extensionDependencyDepth: z.number().min(1).max(64).default(12),
  /** Package-count bound for dependency graphs. Default 256 (SDK default is 64). */
  extensionDependencyPackages: z.number().min(1).max(4096).default(256),
  allowPreinstalledDependencies: z.boolean().default(false),
  preinstalledDependenciesRoot: z.string().default(''),
  /**
   * Exact prebuilt dependency pairs admitted on the registry arm. Their
   * lifecycle scripts are never executed; unlisted versions still refuse.
   */
  trustedPrebuiltDependencies: z.array(z.string()).default([...DEFAULT_TRUSTED_PREBUILT_DEPENDENCIES]),
  /**
   * Standing RES-02 approval for executable assets prepared from the client path.
   * FALSE by default: a downloaded engine still needs the explicit approval.
   */
  allowExecutablePreparation: z.boolean().default(false),
  /**
   * SEC-09: gate extension ACTIVATION behind request/approve/commit.
   *
   * Default FALSE for this slice: no approval UI/management path ships with it, so an
   * unconditional gate would make the Settings Enable action a pending refusal. With
   * it on, `enable` records a pending request and refuses and only `commitApproval`
   * mutates; with it off, the documented pre-approved direct path is preserved.
   */
  requireActivationApproval: z.boolean().default(false),
  persist: z.boolean().default(true),
  providers: z.dict(z.string()).default({}),
  legacyAliases: z.boolean().default(false),
  /**
   * Settings → Model as Tool.
   *
   * Only volatile fields are exposed to the Settings UI and may be written by
   * the config editor; every other field is config-file only. Keep this surface
   * the operator knobs the client page edits.
   */
  approvedRoots: settingsField(z.array(z.string()).default([])),
  grantId: z.string().default('local-interactive'),
  recordReceipts: z.boolean().default(true),
  repairAttempts: settingsField(z.number().min(0).max(8).default(1)),
  limits: z.object({
    maxInputBytes: z.number(),
    maxAudioSeconds: z.number(),
    maxResultBytes: z.number(),
    maxModelCalls: z.number(),
    maxOutputTokens: z.number(),
    maxImages: z.number(),
    deadlineMs: z.number(),
  }),
  models: settingsField(z.array(z.string()).default([])),
  exclude: settingsField(z.array(z.string()).default([])),
  exposeUnavailable: settingsField(z.boolean().default(false)),
  registerSkills: settingsField(z.boolean().default(true)),
  registerControlTool: settingsField(z.boolean().default(true)),
  managementGrant: z.boolean().default(false),
  confidentialTools: z.array(z.string()).default([]),
  hostedCode: z.boolean().default(false),
  allowAgentAuthoring: z.boolean().default(true),
  agentAuthoringFile: z.string().default(''),
  captureRunPrograms: z.boolean().default(true),
  runCaptureFile: z.string().default(''),
  adoption: z.object({
    saveOffer: z.boolean().default(false),
    digest: z.boolean().default(false),
    prewarmAfterEnable: z.boolean().default(false),
    maxRepeats: z.number().min(2).default(3),
  }).default({ saveOffer: false, digest: false, prewarmAfterEnable: false, maxRepeats: 3 }),
  /**
   * Authored-artifact scoping. ENABLED by default: new artifacts are
   * session-scoped, existing global rows remain resolvable, and
   * session > workspace > global resolution plus promotion/expiry is active.
   * Set enabled:false for the pre-scoping global-only behaviour.
   */
  artifactScopes: z.object({
    enabled: z.boolean().default(true),
    defaultScope: z.union([z.const('session'), z.const('workspace'), z.const('global')]).default('session'),
    workspaceRoot: z.string().default('auto'),
    globalPromotion: z.union([z.const('human'), z.const('off')]).default('human'),
    promoteMinUses: z.number().min(0).default(2),
    expireSessionArtifacts: z.boolean().default(true),
  }),
  // Deliberately NO default: undefined selects the platform policy (the win32 DSH-home
  // default), while an explicit '' must be able to DISABLE the override.
  sandboxTempRoot: z.string(),
  networkPolicy: z.union([z.const('any'), z.const('no-network')]).default('any'),
  cli: z.object({
    enabled: z.boolean().default(true),
    command: z.string().default(DEFAULT_CLI_COMMAND),
  }),
  remote: z.object({
    endpoint: z.string(),
    token: z.string(),
  }),
  harnessModel: z.object({
    provider: z.string(),
    model: z.string(),
  }),
  jev: z.object({
    enabled: z.boolean().default(false),
    apiKey: z.string(),
    apiKeyEnv: z.string().default('TYPESAFE_API_KEY'),
    credentialRef: z.string().default('jev/api-key'),
    baseURL: z.string().default('https://api.typesafe.ai'),
    model: z.string().default('jev-1.14'),
  }),
  managedWorkers: settingsField(z.boolean().default(false)),
  autoProvisionExtensions: z.boolean().default(false),
  deferHeavySchemas: z.boolean().default(false).description(
    'Request deferred loading (defer_loading) for heavy tool schemas. DEFAULT: false. '
    + 'Selects the six explicit ids (multimodal_embed, media_find_moments, extract_with_repair, '
    + 'structured_extract, tools_plan, semantic_*) plus declarations over 1024 bytes. '
    + 'Honest limit: DSH still writes the full schema on the wire, so this is a provider loading '
    + 'hint, not a local byte reduction. Activation needs a developer/message tool-addition, which '
    + 'DSH emits only when the tool list changes, so a stable first-party list may leave selected '
    + 'tools unactivated; enable only when the activation path is wired. '
    + 'See docs/audit/deferred-loading.md.',
  ),
  managedWorkerInvokeTimeoutMs: z.number(),
  workerEnvPassthrough: z.array(z.string()).default([]),
  allowNpm: settingsField(z.boolean().default(true)),
  disabledExtensions: settingsField(z.array(z.string()).default([])),
  /**
   * §12 CONFIG V3: the proposed nested schemaVersion-3 shape. The spec's
   * fixed-false flags are parsed here and REJECTED when set true (unsupported
   * values refuse rather than being accepted as ineffective flags); the
   * remaining nested fields are carried as data for the launcher's doctor and
   * future wiring. The flat legacy fields above remain the deprecated aliases
   * that actually drive behavior, so existing v1/v2 configs stay green.
   */
  schemaVersion: z.number(),
  extensions: z.object({
    protocolMajor: z.number(),
    manifestVersion: z.string(),
    registry: z.string(),
    allowHttpsArchives: z.boolean(),
    allowLocalArchives: z.boolean(),
    allowSourceDirectories: z.boolean(),
    automaticUpdates: z.boolean(),
    runInstallScripts: z.boolean(),
  }),
  mcpV3: z.object({
    enabled: z.boolean(),
    protocolVersions: z.array(z.string()),
    legacyCompatibility: z.boolean(),
    host: z.string(),
    port: z.number(),
    path: z.string(),
    tokenFile: z.string().default(''),
    allowedOrigins: z.array(z.string()),
    exportTools: z.array(z.string()).default(['*']),
    /**
     * The operator's MCP client-grant policy. Before this field existed the
     * HTTP server always received `{}` (allowedHarnessProfiles [], allowedTools
     * all), so no external caller could ever name a server-owned executor
     * profile even when the operator configured one.
     */
    grants: z.any(),
    catalogTtlMs: z.number(),
    catalogCacheScope: z.string(),
    auth: z.object({ mode: z.string(), authorizationServerProfile: z.any() }),
  }),
  compositionV3: z.object({
    enabled: z.boolean(),
    defaultTimeoutMs: z.number(),
    maxTimeoutMs: z.number(),
    maxToolCalls: z.number(),
    maxConcurrentBindings: z.number(),
    maxHarnessModelCalls: z.number(),
  }),
  multimodalV3: z.object({
    defaultDimensions: z.number(),
    defaultOverflow: z.string(),
    maxVideoFrames: z.number(),
    audioSampleRateHz: z.number(),
    selectiveEncoderLoading: z.boolean(),
  }),
  harnessExecutorV3: z.object({
    enabled: z.boolean(),
    nativeSelection: z.string(),
    externalDefaultProfile: z.any(),
    profiles: z.array(z.any()),
    defaultMaxAttempts: z.number(),
    defaultRepairAttempts: z.number().min(0).max(8),
    defaultMaxOutputTokens: z.number(),
    defaultTimeoutMs: z.number(),
    inheritConversation: z.boolean(),
    allowModelToolCalls: z.boolean(),
  }),
  recipesV3: z.object({
    schemaVersion: z.string(),
    allowLocalAuthoring: z.boolean(),
    automaticActivation: z.boolean(),
    allowExecutableTemplates: z.boolean(),
  }),
  clientsV3: z.array(z.any()),
  captureV3: z.object({
    bodies: z.boolean(),
    retentionDays: z.number(),
    maxBytes: z.number(),
    auxiliaryLlmJournal: z.object({ enabled: z.boolean(), retentionDays: z.number() }),
  }),
})

/**
 * §12: the spec's fixed-false flags REJECT unsupported values instead of being
 * accepted as ineffective flags. A config that sets any of them to true fails
 * the configuration with the named flag, never silently ignores it.
 * @param config - the parsed configuration.
 * @throws Error naming the first flag set to an unsupported value.
 */
export function assertConfigV3DisabledFlags(config: Config): void {
  const fixedFalse = [
    ['extensions.automaticUpdates', config.extensions?.automaticUpdates],
    ['extensions.runInstallScripts', config.extensions?.runInstallScripts],
    ['recipes.automaticActivation', config.recipesV3?.automaticActivation],
    ['recipes.allowExecutableTemplates', config.recipesV3?.allowExecutableTemplates],
    ['harnessExecutor.inheritConversation', config.harnessExecutorV3?.inheritConversation],
    ['harnessExecutor.allowModelToolCalls', config.harnessExecutorV3?.allowModelToolCalls],
  ] as const
  for (const [name, value] of fixedFalse) {
    if (value === true) {
      throw new Error(
        `${name} is fixed false in this implementation (spec §12); setting it to true is refused rather than `
        + 'accepted as an ineffective flag. Remove the field or set it to false.',
      )
    }
  }
}

/**
 * The CODE-11 repair-attempt ceiling for one configuration (task-74).
 *
 * The flat `repairAttempts` key drives; the v3 nested spelling
 * `harnessExecutorV3.defaultRepairAttempts` is its equivalent; absent both,
 * the default is 1. An out-of-range value is a REFUSAL, never a silent clamp:
 * a ceiling the operator did not write is a budget nobody approved.
 * @param config - the parsed configuration.
 * @throws Error naming the invalid value.
 */
export function repairCeilingOf(config: Config): number {
  const ceiling = config.repairAttempts ?? config.harnessExecutorV3?.defaultRepairAttempts ?? 1
  if (typeof ceiling !== 'number' || !Number.isInteger(ceiling) || ceiling < 0 || ceiling > 8) {
    throw new Error(
      `repairAttempts must be an integer between 0 and 8 (CODE-11); received ${JSON.stringify(ceiling)}. `
      + 'A repair ceiling outside this range is refused rather than silently clamped.',
    )
  }
  return ceiling
}

/** One registered model, as reported by `model_tools`. */
interface InstalledModel {
  readonly entry: ModelCatalogEntry
  readonly toolName: string
  readonly dispose: () => void
  disposeSkill?: () => void
  /** Disposer for the opt-in deprecated alias, when one was registered (BASE-03). */
  disposeAlias?: () => void
}

/**
 * Register the Desert Ant model tools and skills.
 * @param ctx - the plugin context whose tool registry receives the definitions.
 * @param config - deployment configuration for which models to expose.
 */
/**
 * The Config fields the Settings page edits (marked volatile in the schema).
 *
 * schemastery parses a volatile field into a LIVE REFERENCE (`{ get() }`) rather
 * than a plain value, so the settings editor can commit a new value into the
 * running fiber. Every consumer here reads the plain value, so apply unwraps
 * them once and re-unwraps on `loader/volatile-update`.
 */
const VOLATILE_CONFIG_KEYS = [
  'approvedRoots', 'repairAttempts', 'models', 'exclude', 'exposeUnavailable',
  'registerSkills', 'registerControlTool', 'managedWorkers', 'allowNpm', 'disabledExtensions',
] as const

/** Read a plain value out of a volatile reference (or return it untouched). */
function unwrapVolatile<T>(value: T | { get(): T }): T {
  const candidate = value as { get?: () => T } | undefined
  return candidate !== undefined && typeof candidate.get === 'function' ? candidate.get() : value as T
}

/** Replace every volatile field on the config object with its current value. */
function absorbVolatileConfig(config: Config): void {
  const writable = config as unknown as Record<string, unknown>
  for (const key of VOLATILE_CONFIG_KEYS) {
    if (key in writable) writable[key] = unwrapVolatile(writable[key])
  }
}

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  // Volatile fields arrive as live references; the rest of apply reads values.
  absorbVolatileConfig(config)
  // A Settings save commits a new volatile value into the running fiber; without
  // this the page would persist the change and the plugin keep the old value.
  // The event is declared by the harness loader (not by the cordis types this
  // package compiles against), so the name is cast rather than left unchecked.
  ctx.on('loader/volatile-update' as never, (() => {
    try {
      absorbVolatileConfig(config)
    } catch (error) {
      ctx.logger?.warn?.(`could not re-read volatile configuration: ${error instanceof Error ? error.message : String(error)}`)
    }
  }) as never)
  // §12: the fixed-false flags REFUSE unsupported values before anything runs.
  assertConfigV3DisabledFlags(config)
  /**
   * THE PTC SANDBOX TEMP ROOT (task-58, Windows ACL fix).
   *
   * DSH's sandbox-local resolves `os.tmpdir()` when it materializes a private temp.
   * TEMP/TMP are PROCESS-GLOBAL, so the override must not outlive the Code Mode run
   * that needs it: keeping it for the host lifetime made every plugin inherit the
   * sandbox tree and let that tree grow without bound. The scope installs it for a
   * run and restores it when the last run ends. No directory is created at boot and
   * the retention prune runs after the first program run, never on the boot path.
   */
  const sandboxTemp = resolveSandboxTempRoot({ configured: config.sandboxTempRoot })
  const sandboxTempScope = createSandboxTempScope(sandboxTemp.root, {
    onError: (error) => {
      ctx.logger.warn(
        `model-tools: could not create the sandbox temp root ${sandboxTemp.root}: `
        + `${error instanceof Error ? error.message : String(error)}; using the platform temp`,
      )
    },
  })
  let sandboxPruneScheduled = false
  /** Prune once, a second after the FIRST program run (never during boot). */
  const scheduleSandboxTempPrune = (): void => {
    if (sandboxPruneScheduled || sandboxTemp.root.length === 0) return
    sandboxPruneScheduled = true
    const pruneTimer = setTimeout(() => {
      try {
        const removed = pruneSandboxTempRoot(sandboxTemp.root, {
          maxAgeMs: DEFAULT_SANDBOX_TEMP_MAX_AGE_MS,
        })
        if (removed > 0) {
          ctx.logger.info(`model-tools: pruned ${removed} abandoned sandbox temp director${removed === 1 ? 'y' : 'ies'}`)
        }
      } catch (error) {
        ctx.logger.warn(
          `model-tools: could not prune the sandbox temp root ${sandboxTemp.root}: `
          + `${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }, 1_000)
    pruneTimer.unref()
  }
  const entries = loadCatalog(config.catalogFile)
  /**
   * STORAGE LAYOUT: extensions and downloaded model assets live under the DSH home.
   *
   * A relative config value resolves against DSH_HOME (or ~/.dsh), so the same
   * profile works on another machine; an absolute value is kept for an operator who
   * deliberately chose a larger volume. Extension bytes go to `extensionStore`, and
   * prepared model assets go to `assetCacheRoot` (default: the state-file-adjacent
   * `asset-cache`).
   */
  const extensionStoreDir = resolveDshHomePath(config.extensionStore ?? '')
  const assetCacheRoot = resolveDshHomePath(config.assetCacheRoot ?? '')

  /**
   * Declared at the apply top so the catalog-change notifier (below) can read
   * the generation without a temporal-dead-zone window during the startup
   * install loop; the extension-store block assigns it.
   */
  let extensionLifecycle: ExtensionLifecycle | undefined
  /**
   * Authoring inventory, published by tool_mode_list.
   *
   * Declared OUTSIDE the authoring block because discovery is registered earlier and
   * still has to report what exists. Undefined means authoring is disabled.
   */
  let authoringSnapshot: ((exec: { agent?: unknown }) => {
    readonly tools: AgentToolSummary[]
    readonly workflows: AgentWorkflowSummary[]
    readonly recent: AuthoringReceipt[]
    readonly repeatedShapes: RepeatedShape[]
  }) | undefined
  /** Authoring receipts for the receipts action (undefined when authoring is off). */
  let authoringReceipts: (() => readonly AuthoringReceipt[]) | undefined
  /** The caller scope resolver, wired only when authoring is enabled. */
  let scopeForAuthoringCaller: ((
    exec: { agent?: unknown } | undefined,
    requested?: string,
  ) => BuiltScopeContext) | undefined
  /** True unless the name is an authored tool absent from this caller's scope. */
  let authoredToolVisibleAt: ((name: string, scope: BuiltScopeContext) => boolean) | undefined
  /** Run capture for define-from-run; on by default, disabled by config. */
  let runCaptureStore: RunCaptureStore | undefined
  /** Workflow tools registered from the durable workflow store. */
  const workflowToolNames = new Set<string>()
  const workflowDisposers = new Map<string, () => void>()
  /** Cycle guard for workflow-calls-workflow composition. */
  const workflowCallStack = new AsyncLocalStorage<ReadonlySet<string>>()
  /** Per-session adoption ledger (offered/called/authored/reused). */
  let sessionLedger: SessionLedger | undefined
  /** Repetition candidates for the optional save offer (flag default off). */
  let repetitionTracker: RepetitionTracker | undefined
  /**
   * The session identity on a DSH Agent. The live Agent has `id`; simple hosts and
   * older fixtures used `sessionId`, so both are accepted. Reading only the latter
   * made every live scoping decision look session-less (U24).
   */
  const sessionIdOfAgent = (agent: unknown): string | undefined => {
    const candidate = agent as { readonly id?: string; readonly sessionId?: string } | undefined
    return candidate?.sessionId ?? candidate?.id
  }

  /**
   * TASK-117: the catalogue-vs-extension tool-name reconciliation.
   *
   * OWNERSHIP RULE: an INSTALLED extension that declares a tool with a given
   * name OWNS that name — its activation registers the tool, so the catalogue
   * must SKIP its own registration for a contract-backed entry with the same
   * tool name (the live EXTENSION_FAULT was the catalogue winning the race at
   * boot). The skip is recorded; when the owning extension deactivates, the
   * catalogue registration is RESTORED. Deterministic in both orders: the
   * probe reads the durable store, not an in-flight registry.
   */
  const extensionStore = extensionStoreDir.length > 0
    ? new ExtensionStore(extensionStoreDir)
    : undefined
  const catalogueDeferred = new Set<string>()

  /**
   * The installation the operator MEANS for an identity.
   *
   * `listInstalled().find(id)` returns the OLDEST record. After an update that made
   * dispatch, the registrar and the prepare surface load a SUPERSEDED version while
   * `describe()` reported the newest — stale code served, and no report disagreed.
   * The service's own selection (EXT-30 pointer, else the last appended record) is
   * the single answer for every host lookup.
   * @param extensionId - the extension identity.
   * @returns the selected installed record, or undefined when nothing is installed.
   */
  const selectedInstalled = (extensionId: string): InstalledRecord | undefined => {
    if (extensionStore === undefined) return undefined
    const pointers = extensionStore.readProfilePointers('default')
    return selectInstalled(
      extensionStore.listInstalled().value,
      pointers.corrupt ? {} : pointers.value.activeVersions,
      extensionId,
    )
  }
  const extensionOwnsToolName = (toolName: string): boolean => {
    if (extensionStore === undefined) return false
    try {
      // Only an ACTIVE extension owns a name at runtime: a disabled (or
      // failed) installation must not keep the catalogue from serving it.
      const active = new Set(
        extensionStore.readProfileState('default').value
          .filter(entry => entry.desiredActivation === 'active' && entry.observedActivation === 'active')
          .map(entry => entry.extensionId),
      )
      for (const record of extensionStore.listInstalled().value) {
        if (!active.has(record.extensionId)) continue
        const discovery = discoverExtension(record.installPath)
        if (discovery.manifest.tools.some(tool => tool.name === toolName)) return true
        // TASK-121: an implementation-only extension owns the STANDARD tool
        // name of each implementation's contract (text.embed -> text_embed),
        // exactly as the registrar registers it.
        const implementationNames = (discovery.manifest.implementations ?? [])
          .map(implementation => STANDARD_CONTRACTS.find(contract => contract.contract === implementation.contractId)?.toolName)
          .filter((name): name is string => name !== undefined)
        if (implementationNames.includes(toolName)) return true
      }
    } catch (error) {
      // A broken package cannot own a tool name; the catalogue keeps it.
      return false
    }
    return false
  }

  /**
   * The extensions the contribution registrar currently admits.
   *
   * Seeded from the durable desired-active state when the store mounts, and kept
   * in step by the extension-management service: the registrar refuses a
   * contribution whose extension is absent, so a runtime `enable` must admit the
   * id BEFORE the lifecycle publishes, and `disable` must revoke it.
   */
  const activatedExtensions = new Set<string>()

  /**
   * The agent-authored tool names registered in THIS host instance.
   *
   * Three consumers share it: the host grant (an authored tool may be bound by a
   * workflow program), `tool_mode_list` (the tool is part of the caller's permitted
   * surface), and the delete/teardown path (the name is released with its registration).
   */
  const authoredToolNames = new Set<string>()

  /**
   * Why the startup asset walk could not rebuild an extension's prepared handles, by
   * extension id. The restore pass writes it and clears it on success; the service
   * surfaces it in the row, so a missing or resized cache file is distinguishable from
   * a model that was never prepared.
   */
  const assetRestoreFailures = new Map<string, string>()

  /**
   * The host half of Settings → Model as Tool's extension management.
   *
   * Constructed even when no extension store is configured, so `describe()` can
   * truthfully answer `store: null` instead of the surface being absent. The
   * lifecycle thunk resolves once the extension-store block below mounts it; the
   * disabled getter reads the live (volatile) config list, so a Settings save is
   * observed without reconstructing the service.
   *
   * `provideModelToolsService` attaches the gateway's visible `typertRemote`
   * binding and provides the object as the `modelTools` Cordis service, which is
   * what the generated Host artifact dispatches through. It throws at apply time
   * if a wire method is missing, so a half-wired surface cannot start.
   */
  /** Set once the receipt ring below is declared; service audits arrive only after apply. */
  let recordLifecycleEvent: (event: LifecycleAuditEvent) => void = () => { /* replaced below */ }

  /**
   * SEC-09: ONE approval state machine per host process.
   *
   * The STORE is always constructed; the GATE is applied only when
   * `config.requireActivationApproval` is on. Mounting it unconditionally
   * would turn the Settings Enable action — and every existing management caller —
   * into a pending refusal, because no approval UI/management path ships in this
   * slice. With the flag off the composition keeps the documented PRE-APPROVED direct
   * path; with it on, `enable` records a pending request and refuses and only a
   * committed approval activates. The store is deliberately in-memory — durability is
   * separate work, and a half-persisted approval that silently vanishes would be worse
   * than the prompt in-process one.
   */
  const approvalStore = new ApprovalStore()
  const activationApprovalRequired = config.requireActivationApproval === true

  const extensionsService = createExtensionsService({
    storeDir: extensionStoreDir,
    sourceDir: config.extensionSourceDir ?? '',
    allowSourceDirectories: config.extensions?.allowSourceDirectories === true,
    onAudit: recordLifecycleEvent,
    /**
     * Registry installs (task-104). `auto` prefers the registry and uses the
     * developer-mode directory only as a TRANSPORT-failure fallback when the
     * source-directory gate is on; package-level registry refusals are named and
     * never retried locally.
     */
    installSource: config.extensionInstallSource ?? 'auto',
    registryUrl: config.extensionRegistry ?? 'https://registry.npmjs.org/',
    registryTarballMaxBytes: config.extensionTarballMaxBytes ?? 256 * 1024 * 1024,
    registryTarballTimeoutMs: config.extensionTarballTimeoutMs ?? 10 * 60_000,
    registryMetadataTimeoutMs: config.extensionMetadataTimeoutMs ?? 30_000,
    registryDependencyDepth: config.extensionDependencyDepth ?? 12,
    registryDependencyPackages: config.extensionDependencyPackages ?? 256,
    /**
     * The operator gate for already-materialized dependencies. OFF by default:
     * a dependency whose package.json declares install-time scripts still
     * refuses (EXT-10). When ON, the resolver may supply content from a
     * completed host install (e.g. onnxruntime-node after the operator's npm
     * ran its postinstall), and the SDK records provenance rather than
     * pretending it ran the scripts.
     */
    allowPreinstalledDependencies: config.allowPreinstalledDependencies === true,
    preinstalledDependenciesRoot: config.preinstalledDependenciesRoot ?? '',
    trustedPrebuiltDependencies: config.trustedPrebuiltDependencies ?? DEFAULT_TRUSTED_PREBUILT_DEPENDENCIES,
    profile: 'default',
    disabledExtensions: () => config.disabledExtensions ?? [],
    lifecycle: () => extensionLifecycle,
    /**
     * SEC-09: the gate is mounted only for a deployment that has an operator approval
     * path (config.extensions.requireActivationApproval). The spread is how an OPTIONAL
     * seam is absent under exactOptionalPropertyTypes; `approvals: undefined` would be
     * an invalid assignment, not an absence.
     */
    ...activationApprovalRequired ? { approvals: () => approvalStore } : {},
    assetRestoreDiagnostic: extensionId => assetRestoreFailures.get(extensionId),
    /**
     * The prepared-assets surface is constructed inside the extension-store block
     * below; the thunk resolves at call time, after apply has finished. The source
     * is the SAME seam `extensions-prepare` uses, so the Settings page and the
     * management channel acquire through one implementation (and the test suite
     * injects a local source through `assetSourceFactory`, never the network).
     */
    prepareSurface: () => prepareAssetsSurface,
    preparationSource: () => config.assetSourceFactory?.() ?? createHttpSource(),
    /**
     * RES-02 for the client/Remote path: the operator's standing approval, read
     * live so a config edit applies without reconstructing the service. DEFAULT
     * FALSE — with it off the exact executable-preparation refusal is returned and
     * nothing is acquired. The management channel keeps its per-call flag.
     */
    allowExecutablePreparation: () => config.allowExecutablePreparation === true,
    /**
     * Keep the registrar's admission set in step with activation changes made
     * through the Settings surface. A failed activation revokes the admission,
     * unless the lifecycle still reports the extension active under another owner
     * (another host's surface is not this registrar's to revoke).
     */
    onActivationChange: (extensionId, active) => {
      if (active) {
        activatedExtensions.add(extensionId)
        // TASK-117: the extension now owns its tool names — withdraw the
        // catalogue registrations for those names BEFORE the lifecycle
        // publishes (the hook runs before activate), so the activation cannot
        // collide with a catalogue tool. The names are deferred, not lost.
        for (const item of resolved.filter(candidate => candidate.entry.contract !== null)) {
          if (!extensionOwnsToolName(item.entry.tool.name)) continue
          if (!installed.has(item.entry.id)) continue
          uninstall(item.entry.id)
          catalogueDeferred.add(item.entry.id)
          ctx.logger.info(
            `model-tools: ${item.entry.name}'s tool ${item.entry.tool.name} is taken over by ${extensionId}; `
            + 'the catalogue registration is withdrawn and deferred',
          )
        }
        return
      }
      if (extensionLifecycle?.stateOf(extensionId)?.observedActivation !== 'active') {
        activatedExtensions.delete(extensionId)
      }
      // TASK-117: the extension released its tool names — restore every
      // deferred catalogue registration the release freed.
      void restoreDeferredCatalogue()
    },
    /**
     * The harness-model provider status seam (task-93): the thunk evaluates the
     * SAME composition decided below (explicit provider > config.harnessModel >
     * AUTO discovery), so the preflight reason the extensions service reports
     * can never contradict what activation would actually do.
     */
    harnessProviderStatus: () => harnessStatusThunk(),
  })

  /**
   * TOOL INSIGHTS (task-13): the projection, the external ledger and the additive
   * Remote methods. The projection is registered through an OPTIONAL injection, so a
   * host without `sessionProjections` simply gets no usage unit and the page degrades.
   */
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    // SAFETY: the projection contract types its schemas as `ZodType`, but the registry's
    // only runtime use is `parse(value)`; this unit implements that boundary without a
    // second zod installation (see `tool-usage-projection.ts`). The assertion mirrors the
    // WIRED overload (`wire` required) so the registry cannot treat the compact view as
    // absent.
    const definition = {
      ...toolUsageProjectionDefinition,
      wire: toolUsageProjectionDefinition.wire,
    } as unknown as ProjectionDefinition<'toolModeUsage', ToolUsageState> & {
      wire: NonNullable<ProjectionDefinition<'toolModeUsage', ToolUsageState>['wire']>
    }
    projectionCtx.sessionProjections.register(definition)
  })

  const insightsStatePath = resolve(config.stateFile ?? defaultStateFile())
  const mcpUsageLedger = new McpUsageLedger(join(dirname(insightsStatePath), 'mcp-usage.jsonl'))
  /** The bound MCP endpoint, assigned when the transport starts (null until then). */
  let mcpBoundEndpoint: BoundEndpoint | undefined
  /** When the endpoint bound, for the status uptime (null until then). */
  let mcpStartedAt: number | null = null
  /** Tool names the export surface withheld, with the export policy's reasons. */
  const mcpWithheldTools = new Set<string>()
  const mcpWithheldReasons = new Map<string, string>()

  /**
   * The optional stored-session reader used for BACKFILL.
   *
   * The projection registry only materializes a Session already in the live
   * store. A historical log opened by the UI is read through persistence, not
   * appended to a live Session, so its projection state would otherwise never
   * exist. These structural types keep `sessionPersistence` OPTIONAL: a host
   * without it simply has no backfill and the page degrades.
   */
  interface StoredSessionSnapshot {
    readonly header: SessionHeader
    readonly revision: unknown
  }
  interface StoredSessionHandle {
    readonly inheritedEventCount: SessionLogOffset
    read(): Promise<{ events: readonly SessionEvent[] }>
    close(): Promise<void>
  }
  interface StoredSessionPersistence {
    list(): Promise<readonly StoredSessionSnapshot[]>
    open(id: string, access: 'read'): Promise<StoredSessionHandle>
  }

  /** One cached projection state per stored session, invalidated by its revision. */
  const storedUsageCache = new Map<string, { revision: unknown; state: ToolUsageState; workspace: string | null }>()
  /** Kept outside the request path: warming may be slow, but it must never block a page read. */
  let storedWarmStarted = false
  /** A page read may spend at most this long warming stored history. */
  const STORED_BACKFILL_BUDGET_MS = 2_000
  /** Read the newest sessions first; older history is filled on later reads. */
  const STORED_BACKFILL_LIMIT = 100
  /** A single slow stored read must not consume the whole budget. */
  const STORED_READ_TIMEOUT_MS = 300
  /** Listing stored sessions is metadata, but must not block the page either. */
  const STORED_LIST_TIMEOUT_MS = 750

  /**
   * Fold stored logs through the SAME projection definition once per revision.
   * Recent sessions first, bounded by a total time budget: on a large profile the
   * first page read must return promptly, and later reads reuse this cache.
   * A failed/timeout read is skipped, never turned into a fabricated zero.
   */
  const readStoredUsage = async (
    projections: SessionProjectionRegistry,
    persistence: StoredSessionPersistence,
  ): Promise<SessionUsageInput[]> => {
    let snapshots: readonly StoredSessionSnapshot[] | null
    try {
      snapshots = await Promise.race([
        persistence.list(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), STORED_LIST_TIMEOUT_MS)),
      ])
    } catch {
      return []
    }
    if (snapshots === null) return []
    const inputs: SessionUsageInput[] = []
    const ordered = [...snapshots]
      .sort((left, right) => (right.header.createdAt ?? 0) - (left.header.createdAt ?? 0))
      .slice(0, STORED_BACKFILL_LIMIT)
    const deadline = Date.now() + STORED_BACKFILL_BUDGET_MS
    for (const snapshot of ordered) {
      const sessionId = String(snapshot.header.id)
      const cached = storedUsageCache.get(sessionId)
      if (cached !== undefined && cached.revision === snapshot.revision) {
        inputs.push({ sessionId, workspace: cached.workspace ?? snapshot.header.cwd ?? null, state: cached.state })
        continue
      }
      if (Date.now() >= deadline) break
      let handle: StoredSessionHandle
      try {
        handle = await persistence.open(sessionId, 'read')
      } catch {
        continue
      }
      try {
        const read = await Promise.race([
          handle.read(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), STORED_READ_TIMEOUT_MS)),
        ])
        if (read === null || read.events.length === 0) continue
        // SAFETY: `baseSeq` is the branded log offset 0 — the stored read starts at seq 0.
        const restored = projections.restore({}, read.events, 0 as SessionLogOffset, snapshot.header, handle.inheritedEventCount)
        const row = restored.checkpoint[TOOL_USAGE_KEY]
        if (row === undefined) continue
        // SAFETY: the registry writes this row from `toolUsageProjectionDefinition.stateSchema`.
        const state = row.val as ToolUsageState
        storedUsageCache.set(sessionId, { revision: snapshot.revision, state, workspace: snapshot.header.cwd ?? null })
        inputs.push({ sessionId, workspace: snapshot.header.cwd ?? null, state })
      } catch {
        // A corrupt/stale stored log is skipped; it never fabricates a row.
      } finally {
        await handle.close()
      }
    }
    return inputs
  }

  /**
   * Aggregate live projection states plus optional stored-log backfill over a
   * query window. The inventory read opts out: on a large profile the history
   * backfill can take many seconds, and the tool list must not wait for it.
   */
  let customToolsServiceRef: CustomToolsService | undefined
  const readUsageReport = async (
    query?: UsageReportQuery,
    options: { readonly backfill?: boolean } = {},
  ): Promise<UsageReport> => {
    const now = Date.now()
    const range: UsageRange = query?.range ?? '7d'
    const window = query?.from !== undefined && query?.to !== undefined
      ? { range, from: query.from, to: query.to, fromDay: toolUsageDayKey(query.from), toDay: toolUsageDayKey(query.to) }
      : rangeWindow(range, now)
    // SAFETY: Cordis resolves `get(name)` to the service a mounted plugin provided;
    // these names are the harness's own and the casts only restore the static type
    // the untyped registry lookup erased.
    const sessionsService = ctx.get('sessions') as SessionStore | undefined
    const projections = ctx.get('sessionProjections') as SessionProjectionRegistry | undefined
    const persistence = ctx.get('sessionPersistence') as unknown as StoredSessionPersistence | undefined
    const inputs: SessionUsageInput[] = []
    const seen = new Set<string>()
    if (sessionsService !== undefined && projections !== undefined) {
      for (const session of sessionsService.list()) {
        // `stateOf` folds a missing cell over the whole in-memory log. On a
        // profile with hundreds of stored sessions, that is the difference
        // between an instant page and a multi-second gateway stall. Only
        // sessions whose cell is already materialized are page-visible; the
        // rest arrive through the background stored-history warm.
        if (typeof projections.cachedSnapshot === 'function') {
          const cached = projections.cachedSnapshot(session, [TOOL_USAGE_KEY])
          if (cached === undefined) continue
        }
        const state = projections.stateOf(session, TOOL_USAGE_KEY)
        if (state === undefined) continue
        inputs.push({ sessionId: session.id, workspace: session.header.cwd ?? null, state })
        seen.add(session.id)
      }
    }
    if (options.backfill !== false && projections !== undefined && persistence !== undefined) {
      // NEVER await the history scan here. On the main profile the stored-session
      // list covers hundreds of large logs; the page read must stay responsive.
      // Warm the cache in the background and serve whatever is already folded.
      if (!storedWarmStarted) {
        storedWarmStarted = true
        void readStoredUsage(projections, persistence).catch(() => {})
      }
      for (const [sessionId, entry] of storedUsageCache) {
        if (seen.has(sessionId)) continue
        inputs.push({ sessionId, workspace: entry.workspace, state: entry.state })
        seen.add(sessionId)
      }
    }
    return buildUsageReport(inputs, window, {
      resolveOwner: (name: string) => {
        const custom = customToolsServiceRef?.describe().tools.find(tool => tool.name === name)
        return custom?.id ?? staticToolOwner(name).owner
      },
    })
  }

  /**
   * Tool names THIS PLUGIN registers itself and no extension declares.
   *
   * The live resolver attributes a tool to the extension whose manifest declares
   * it; the host's control/discovery tools and the contract tools the plugin binds
   * have no declaring extension, so they were reported as "unattributed" in Tool
   * Insights even though this package owns them.
   */
  const pluginOwnedToolNames = (): ReadonlySet<string> => new Set([
    'model_tools', 'model_tools_manage', 'tool_mode_list', 'tool_mode_describe', 'tool_mode_run',
    'decision_combine', 'decision_route', 'decision_evaluate',
    ...[...registeredContracts.values()].map(registered => registered.toolName),
  ])

  /** The registered tools with owner attribution (extension store is live). */
  const readToolSources = async (): Promise<readonly ToolSourceRow[]> => {
    const describe = await extensionsService.describeFast()
    const owned = pluginOwnedToolNames()
    return ctx.tools.schemas().map((tool) => {
      const resolved = resolveToolOwner(tool.name, describe.extensions)
      const owner = resolved.kind === 'unknown' && owned.has(tool.name)
        ? { owner: TOOL_MODE_OWNER, kind: 'tool-mode' as const, origin: 'tool-mode' as const }
        : resolved
      return { name: tool.name, description: tool.description, owner: owner.owner, kind: owner.kind, origin: owner.origin }
    })
  }

  const readMcpStatus = (): McpStatusView => buildMcpStatus({
    enabled: config.mcpV3?.enabled === true,
    configured: config.mcpV3 === undefined
      ? null
      : { host: config.mcpV3.host ?? '127.0.0.1', port: config.mcpV3.port ?? 3765, path: config.mcpV3.path ?? '/mcp' },
    endpoint: mcpBoundEndpoint === undefined ? null : { host: mcpBoundEndpoint.host, port: mcpBoundEndpoint.port, url: mcpBoundEndpoint.url },
    authMode: config.mcpV3?.enabled === true ? 'static-token' : 'none',
    tokenFile: config.mcpV3?.tokenFile !== undefined && config.mcpV3.tokenFile.length > 0 ? config.mcpV3.tokenFile : null,
    published: mcpHost.listTools().map(tool => tool.name),
    withheld: [...mcpWithheldTools],
    credentialClients: credentialStore === undefined ? [] : credentialStore.list().map(entry => entry.clientId),
    staticClientId: config.mcpV3?.enabled === true ? 'host' : null,
    startedAt: mcpStartedAt,
    ledger: mcpUsageLedger.summarize(),
  })

  /**
   * The provided service: the extension surface PLUS the additive Tool Insights
   * methods. They are optional on {@link ModelToolsRemote}, so an older client never
   * calls them and a host that wired only the extension half still binds.
   */
  const customToolsRoot = resolve(
    config.customToolsDir !== undefined && config.customToolsDir !== ''
      ? config.customToolsDir
      : join(dirname(resolve(config.stateFile ?? defaultStateFile())), 'custom-tools'),
  )
  const remoteService: ModelToolsRemote = {
    // The Remote-facing describe is a PAGE read: it must not digest multi-GB installed
    // trees (EXT-33 verification stays available through the full describe() and runs
    // when an extension activates). A skipped digest is reported as integrity 'unknown'
    // and does not block a row.
    describe: signal => extensionsService.describeFast(signal),
    install: (id, source, signal) => extensionsService.install(id, source, signal),
    enable: (id, signal) => extensionsService.enable(id, signal),
    disable: (id, signal) => extensionsService.disable(id, signal),
    prepare: (id, signal) => extensionsService.prepare(id, signal),
    setToolEnabled: (id, toolName, enabled, signal) => extensionsService.setToolEnabled(id, toolName, enabled, signal),
    uninstall: (id, deactivate, signal) => extensionsService.uninstall(id, deactivate, signal),
    toolSources: async () => ({ tools: await readToolSources() }),
    toolInventory: async () => {
      const describe = await extensionsService.describeFast()
      const report = await readUsageReport({ range: '30d' }, { backfill: false })
      return {
        tools: buildToolInventory({
          registry: ctx.tools.schemas(),
          extensions: describe.extensions,
          usage: report.tools,
          mcpExposed: mcpHost.listTools().map(tool => tool.name),
          pluginOwnedTools: [...pluginOwnedToolNames()],
          ...customToolsServiceRef === undefined
            ? {}
            : {
                customTools: customToolsServiceRef.describe().tools.map(tool => ({
                  name: tool.name,
                  id: tool.id,
                  title: tool.title,
                })),
              },
        }),
      }
    },
    mcpStatus: async () => readMcpStatus(),
    mcpCalls: async (query?: McpCallsQuery) => mcpUsageLedger.read(query),
    toolUsageReport: async (query?: UsageReportQuery) => readUsageReport(query),
    customToolsDescribe: async () => customToolsServiceRef?.describe()
      ?? { store: customToolsRoot, writable: false, tools: [] },
    customToolsGet: async id => customToolsServiceRef?.get(id) ?? null,
    customToolsDraft: async description => {
      if (customToolsServiceRef === undefined) {
        return { ok: false, error: { code: 'custom-tools-unavailable', message: 'custom tools are not enabled on this host' } }
      }
      return customToolsServiceRef.draft(description)
    },
    customToolsValidate: async draft => customToolsServiceRef?.validate(draft)
      ?? { ok: false, issues: [{ path: '', message: 'custom tools are not enabled on this host' }] },
    customToolsTest: async (draft, args) => customToolsServiceRef?.test(draft, args as Readonly<Record<string, unknown>>)
      ?? { ok: false, error: { code: 'custom-tools-unavailable', message: 'custom tools are not enabled on this host' } },
    customToolsSave: async draft => {
      if (customToolsServiceRef === undefined) throw new Error('custom tools are not enabled on this host')
      return customToolsServiceRef.save(draft)
    },
    customToolsSetEnabled: async (id, enabled) => {
      if (customToolsServiceRef === undefined) throw new Error('custom tools are not enabled on this host')
      return customToolsServiceRef.setEnabled(id, enabled)
    },
    customToolsDelete: async id => customToolsServiceRef?.delete(id) ?? false,
  }
  provideModelToolsService(ctx, remoteService)

  /**
   * ARCH-04: when DSH exposes its speech registry and the local Voz extension is
   * installed, publish ONE host-local provider backed by the SAME `stt_transcribe`
   * tool. Native, MCP and speech-UI callers therefore share one Voz deployment.
   */
  {
    const speechCandidate = (ctx as unknown as { get?: (name: string) => unknown }).get?.('speechToText')
    const isSpeechRegistry = speechCandidate !== undefined
      && speechCandidate !== null
      && typeof (speechCandidate as { register?: unknown }).register === 'function'
    if (isSpeechRegistry) {
      const vozInstalled = extensionStore?.listInstalled().value.some(record => (
        record.extensionId === '@try-works/extension-desert-ant-voz'
      )) ?? false
      if (vozInstalled) {
        const disposeSpeech = installVozSpeechProvider(
          speechCandidate as SpeechRegistryLike,
          ctx.tools as never,
          {
            stateDir: dirname(resolve(config.stateFile ?? defaultStateFile())),
            onSkipped: reason => ctx.logger?.info?.(`model-tools: ${reason}`),
          },
        )
        ctx.effect(() => disposeSpeech)
      }
    }
  }

  /**
   * P26-09/MCP-07 (task-65 + task-73): the host-side catalog subscription
   * pipeline. Every lifecycle transition publishes
   * `notifications/tools/list_changed` and runs it through the DELIVERY
   * consumer (deliverCatalogChange): the registry's per-caller filtering
   * decides who gets the event, and the sink carries it to each client's
   * stream. The memory sink is the transport seam — a streaming transport
   * injects its own writer; the consumer path, the ack-first ordering and the
   * revocation discipline are all exercised by the tests.
   */
  const subscriptionRegistry = new SubscriptionRegistry()
  const subscriptionSink = new MemoryDeliverySink()
  const notifyCatalogChange = (): void => {
    const generation = extensionLifecycle?.generation ?? host.activationGeneration
    deliverCatalogChange(subscriptionRegistry, generation, subscriptionSink)
  }
  const playbooks = loadPlaybooks(config.playbookFile)
  const installed = new Map<string, InstalledModel>()

  // An empty allowlist means "no explicit selection" rather than "select
  // nothing": the config schema materializes a declared array to `[]`.
  const wanted = config.models !== undefined && config.models.length > 0
    ? new Set(config.models)
    : undefined
  const excluded = new Set(config.exclude ?? [])
  const exposeUnavailable = config.exposeUnavailable ?? false
  const registerSkills = config.registerSkills ?? true
  const confidentialTools = new Set(config.confidentialTools ?? [])
  const { resolve: bindingPreflight, bindable: bindableName } = createBindingResolver({
    toolNames: () => ctx.tools.schemas().map(schema => schema.name),
    toolExists: name => ctx.tools.get(name) !== undefined,
    confidential: () => confidentialTools,
    externalGrant: () => externalGrantContext.current(),
    authoredVisibleAt: (name, scope) => authoredToolVisibleAt?.(name, scope) ?? true,
  })


  // Persistence: the config states the deployment default, the store records the
  // user's choices on top of it, so enable/disable outlives the session.
  const persist = config.persist ?? true
  const stateStore: StateStore = persist
    ? createFileStateStore(config.stateFile ?? defaultStateFile())
    : createMemoryStateStore()
  let persisted: PersistedState = stateStore.read()
  /**
   * EXT-35 (recommendation slice 2): invocation receipts persist NEXT TO the state
   * file, in their own document. They are deliberately separate from the
   * enable/disable state document: provenance and operator choices have different
   * lifetimes and different corruption consequences.
   */
  const receiptSurface = createReceiptSurface({
    persistent: persist,
    stateFile: config.stateFile ?? defaultStateFile(),
    onQuarantine: diagnostic => ctx.logger.warn(
      `model-tools: receipt store was malformed (${diagnostic.reason}); moved to ${diagnostic.quarantinePath}`,
    ),
    limit: MAX_RETAINED_RECEIPTS,
  })

  /**
   * BASE-09/10 LEGACY MIGRATION (one-time, per profile — task-26).
   *
   * A legacy model-id era state document is migrated on the FIRST startup that
   * sees it: disabled choices are preserved into the host's persisted state,
   * legacy enables are STAGED (never granted — no implicit consent to install,
   * activate or prepare third-party code), the original document is journaled,
   * and the SDK profile half runs through the SDK's own migration when an
   * extension store is mounted. A sidecar marker commits the transaction, so
   * every later startup is a byte-stable no-op. Corrupt or foreign-version
   * documents and markers fail the boot closed (src/legacy-migration.ts).
   */
  const legacy = persist
    ? await runLegacyStartupMigration({
        stateFile: config.stateFile ?? defaultStateFile(),
        store: stateStore,
        extensionStoreDir,
        log: line => ctx.logger.info(`model-tools: ${line}`),
      })
    : undefined
  // ALWAYS adopt the hook's fresh read: another process may have committed the
  // migration between OUR initial stateStore.read() above and the hook's lock,
  // and the pre-hook snapshot would silently re-apply the legacy enables.
  if (legacy !== undefined) persisted = legacy.hostState

  /**
   * The operator-owned credential store (SEC-01).
   *
   * Only a DEPLOYMENT THAT PERSISTS may generate credentials: with persistence off
   * there is nowhere owner-only to put a secret, and issuing one that a restart
   * would forget violates the fail-closed clause, so generation refuses.
   */
  const credentialStore = persist
    ? createFileCredentialStore(config.credentialsFile ?? defaultCredentialStoreFile())
    : undefined

  /**
   * The harness provider composition (HLM-01/02/03) + the AUTO step (task-93).
   *
   * RESOLUTION ORDER: an EXPLICIT `harnessProvider` (a test double, or a
   * deployment-built provider) always wins; then the opt-in `harnessModel`
   * builds the named route; then AUTO composes from the deployment's LLM
   * surface using the deployment's default/selected model when it is
   * discoverable unambiguously (the `agent-default-model` settings entry, or
   * `config.model.default` as `provider/model`). DEFAULT-SAFE: an absent LLM
   * surface or an unresolvable model constructs NOTHING, and the exact reason
   * is what the extensions service reports at preflight — the same composition
   * decides both, so the preflight and the activation can never contradict.
   */
  const harnessWarn = (message: string): void => {
    ctx.logger?.warn?.(`model-tools: ${message}`)
  }
  const harnessBuildEnv = () => ({
    // ctx.get (not property access): the plugin declares only `tools` in its
    // inject list, so reading an undeclared service as a property would throw;
    // get() answers undefined for anything the deployment did not mount.
    ...ctx.get('llm') === undefined ? {} : { llm: ctx.get('llm') as unknown },
    ...ctx.get('attachments') === undefined
      ? {}
      : {
          attachments: ctx.get('attachments') as
            { saveImage(input: { data: Uint8Array; mediaType: string }): Promise<unknown> },
        },
  })
  let harnessProvider: LlmProvider | undefined
  let harnessProviderStatus: HarnessProviderStatus
  /**
   * The harnessModel is EXPLICIT only when BOTH halves are non-empty strings.
   * The parsed Config MATERIALIZES the nested object even when the operator
   * set nothing ({} or {provider: undefined, model: undefined}), so a bare
   * presence check would run the explicit branch with an undefined/undefined
   * pair and print a nonsense reason — the live 0.3.0 regression. Absent,
   * empty or partial always falls through to AUTO.
   */
  const explicitHarnessModel = config.harnessModel !== undefined
    && typeof config.harnessModel.provider === 'string' && config.harnessModel.provider.length > 0
    && typeof config.harnessModel.model === 'string' && config.harnessModel.model.length > 0
    ? config.harnessModel
    : undefined
  /**
   * TASK-98: the composition resolves the RUNNABLE pair the way the runtime
   * does — the configured provider may be a settings namespace, not the
   * registered ROUTE — and 'not ready yet' (the adapters register later in
   * the composition order) is a RETRYABLE state, never locked in as 'none'.
   * The refresh re-runs the same resolution; the status thunk triggers it
   * when the last answer was not-ready-yet, so the next preflight read sees
   * the refreshed result (preflight and activation share this ONE resolver).
   */
  let harnessNotReadyYet = false
  let harnessRefreshInFlight = false
  let harnessRetrying = false
  let harnessPendingStatus: HarnessProviderStatus | undefined
  /**
   * TASK-101: the transient presentation. While the bounded retry is ACTIVE,
   * any failing AUTO verdict (not-ready-yet OR not-configured) is presented as
   * the not-ready-yet string — a startup blocker, never a false configuration
   * error — and the REAL verdict is parked; the cap publishes it.
   */
  const harnessNotReadyStatus = (): HarnessProviderStatus => ({
    available: false,
    reason:
      'the deployment\'s LLM surface has not registered its provider routes yet; retry once the deployment '
      + 'finishes starting (this is not a configuration error)',
    action: 'config',
  })
  const refreshHarness = async (): Promise<void> => {
    if (harnessRefreshInFlight) return
    harnessRefreshInFlight = true
    try {
      const llmSurface = ctx.get('llm') as HarnessLlmRuntimeSurface | undefined
      if (config.harnessProvider !== undefined) {
        harnessProvider = config.harnessProvider
        harnessProviderStatus = {
          available: true,
          provider: config.harnessProvider.id,
          model: 'explicit harnessProvider',
        }
        harnessNotReadyYet = false
        harnessPendingStatus = undefined
        return
      }
      const desired = explicitHarnessModel ?? (() => {
        const hostConfig = ctx.get('config') as { model?: { default?: unknown } } | undefined
        return discoverDefaultHarnessModel({
          settings: ctx.get('settings') as unknown,
          ...hostConfig === undefined ? {} : { config: hostConfig },
        })
      })()
      if (desired === undefined) {
        harnessProvider = undefined
        harnessProviderStatus = {
          available: false,
          reason:
            'no chat model is configured for this deployment, so declarative extensions cannot be served; '
            + 'set config.harnessModel = {provider, model} to a runnable model',
          action: 'config',
        }
        harnessNotReadyYet = false
        harnessPendingStatus = undefined
        return
      }
      const labeled = explicitHarnessModel === undefined ? 'the deployment\'s default model' : 'config.harnessModel'
      if (llmSurface === undefined) {
        harnessProvider = undefined
        harnessProviderStatus = {
          available: false,
          reason:
            `${labeled} ${desired.provider}/${desired.model} cannot be served: the DSH LLM surface is not mounted `
            + 'in this deployment; set config.harnessModel = {provider, model} to a runnable model',
          action: 'config',
        }
        harnessNotReadyYet = false
        harnessPendingStatus = undefined
        return
      }
      const resolution = await resolveRunnableHarnessModel(llmSurface, desired, harnessWarn)
      if (!resolution.ok) {
        /**
         * TASK-99: never downgrade a satisfied status on a later probe. A
         * retry whose registry momentarily reports empty after a success keeps
         * the composed provider and the satisfied status — the composed pair
         * was built from a REAL resolution and stays the truth for the process.
         */
        if (harnessProvider !== undefined || harnessProviderStatus?.available === true) {
          return
        }
        const realStatus: HarnessProviderStatus = {
          available: false,
          reason:
            resolution.kind === 'not-ready-yet'
              ? resolution.reason
              : `${labeled} ${desired.provider}/${desired.model} cannot be served: ${resolution.reason}`,
          action: 'config',
        }
        harnessProvider = undefined
        if (explicitHarnessModel !== undefined) {
          // Explicit config is final: the real verdict, immediately, no retry.
          harnessNotReadyYet = false
          harnessProviderStatus = realStatus
          harnessPendingStatus = undefined
        } else if (harnessRetrying) {
          // TASK-101: the retry is active — present the transient startup
          // blocker and park the real verdict for the cap.
          harnessNotReadyYet = true
          harnessPendingStatus = realStatus
          harnessProviderStatus = harnessNotReadyStatus()
        } else {
          // The initial AUTO resolution: start the retry cycle with the
          // transient presentation.
          harnessNotReadyYet = true
          harnessPendingStatus = realStatus
          harnessProviderStatus = harnessNotReadyStatus()
        }
        return
      }
      const built = await buildHarnessLlmProvider(harnessBuildEnv(), { provider: resolution.route, model: resolution.model }, harnessWarn)
      harnessProvider = built
      harnessNotReadyYet = false
      harnessPendingStatus = undefined
      harnessProviderStatus = built === undefined
        ? {
            available: false,
            reason:
              `${labeled} ${desired.provider}/${desired.model} resolves to the ${resolution.route} route, but the `
              + 'provider could not be built; set config.harnessModel = {provider, model} to a runnable model',
            action: 'config',
          }
        : {
            available: true,
            provider: resolution.route,
            model: resolution.model,
          }
    } finally {
      harnessRefreshInFlight = false
    }
  }
  await refreshHarness()
  /**
   * The status thunk (consumed by the extensions service): a snapshot of the
   * SAME resolution the declarative lane uses. A not-ready-yet answer kicks a
   * refresh (fire-and-forget), so the NEXT preflight read observes the
   * refreshed state — the one-read lag is the honest cost of the synchronous
   * seam over an asynchronous registry.
   */
  const harnessStatusThunk = (): HarnessProviderStatus => {
    if (harnessNotReadyYet && !harnessRefreshInFlight) void refreshHarness()
    return harnessProviderStatus
  }

  /**
   * Custom tools (Create tool tab). The store is profile-scoped and separate
   * from the extension store. Registration is synchronous; a bad record is
   * reported by `sync()` rather than preventing the rest of the plugin from
   * starting.
   */
  const credentialSeam = ctx.get('credentials') as unknown as {
    resolve(ref: string): Promise<{ readonly value: string } | undefined>
  } | undefined
  const customToolDispatch: CustomToolDispatchDeps = {
    http: {
      ...credentialSeam === undefined
        ? {}
        : { resolveCredential: async (name: string) => (await credentialSeam.resolve(name))?.value },
    },
    prompt: harnessProvider === undefined
      ? {}
      : {
          runPrompt: async input => {
            const provider = harnessProvider
            if (provider === undefined) throw new Error('no model provider is composed for prompt tools')
            const completion = await provider.complete({
              prompt: input.prompt,
              maxOutputTokens: input.maxOutputTokens ?? 512,
              signal: input.signal,
            })
            if (completion.kind === 'text') return completion.text
            if (completion.kind === 'truncated') return completion.text
            throw new Error(completion.kind === 'refused' ? completion.reason : `the model returned ${completion.kind}`)
          },
        },
    composite: {
      callTool: async (name, args, signal) => {
        const result = await ctx.tools.execute({
          signal,
          callId: ToolCallId(`custom_${name}_${Date.now().toString(36)}`),
          name,
          arguments: args,
        })
        if (result.isError) throw new Error(result.error?.message ?? `${name} failed`)
        return result.value
      },
    },
  }
  const customToolsService = config.customToolsEnabled === false
    ? undefined
    : (() => {
        const store = new CustomToolStore({ rootDir: customToolsRoot })
        const registrar = new CustomToolRegistrar({
          store,
          tools: ctx.tools,
          execute: customToolExecutor(customToolDispatch),
        })
        return new CustomToolsService({
          store,
          registrar,
          dispatch: customToolDispatch,
          ...harnessProvider === undefined
            ? {}
            : {
                draftModel: async (prompt, signal) => {
                  const provider = harnessProvider
                  if (provider === undefined) throw new Error('no host model is composed for drafting')
                  const completion = await provider.complete({ prompt, maxOutputTokens: 2_048, signal })
                  if (completion.kind === 'text' || completion.kind === 'truncated') return completion.text
                  throw new Error(completion.kind === 'refused' ? completion.reason : `the model returned ${completion.kind}`)
                },
              },
        })
      })()
  if (customToolsService !== undefined) {
    customToolsServiceRef = customToolsService
    const result = customToolsService.sync()
    for (const error of result.errors) ctx.logger.warn(`model-tools custom tool ${error.id}: ${error.reason}`)
    ctx.effect(() => () => customToolsService.registrar.disposeAll())
  }

  /**
   * TASK-99/101: the bounded background retry. After a failing AUTO verdict,
   * re-run the SAME resolution on an interval so the FIRST Settings read lands
   * on the refreshed status instead of a blocked row the operator has to
   * close/reopen to clear. TASK-101's safe rule: an AUTO candidate is
   * RETRYABLE UNTIL THE CAP — the retry stops only on success, the cap, or
   * dispose (and never starts for explicit config). While it runs, ANY failing
   * verdict is presented as the transient not-ready-yet string; at the cap the
   * REAL parked verdict (unknown provider / unserved model) is published and
   * polling ends. A satisfied status is never downgraded.
   */
  const HARNESS_RETRY_INTERVAL_MS = config.harnessRetryIntervalMs ?? 250
  const HARNESS_RETRY_CAP_MS = config.harnessRetryCapMs ?? 30_000
  const HARNESS_RETRY_MAX_POLLS = Math.max(1, Math.floor(HARNESS_RETRY_CAP_MS / HARNESS_RETRY_INTERVAL_MS))
  // TASK-127: the scheduler seam. The default IS the global scheduler — a
  // deployment behaves exactly as before; only a test injects a fake so the
  // retry advances by explicit ticks rather than wall-clock.
  const retryScheduler = config.harnessRetryScheduler ?? {
    setInterval: (handler: () => void, ms: number) => setInterval(handler, ms),
    clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
  }
  let harnessRetryTimer: ReturnType<typeof retryScheduler.setInterval> | undefined
  let harnessRetryPolls = 0
  const stopHarnessRetry = (): void => {
    if (harnessRetryTimer !== undefined) {
      retryScheduler.clearInterval(harnessRetryTimer)
      harnessRetryTimer = undefined
    }
    harnessRetrying = false
  }
  const startHarnessRetry = (): void => {
    // Explicit config is final: no background probe may override it.
    if (config.harnessProvider !== undefined || explicitHarnessModel !== undefined) return
    if (harnessRetryTimer !== undefined) return
    harnessRetrying = true
    harnessRetryPolls = 0
    harnessRetryTimer = retryScheduler.setInterval(() => {
      harnessRetryPolls += 1
      void refreshHarness().then(() => {
        if (harnessProvider !== undefined) {
          // Success: the answer is final.
          stopHarnessRetry()
        } else if (harnessRetryPolls >= HARNESS_RETRY_MAX_POLLS) {
          // TASK-101: the cap publishes the REAL parked verdict and ends polling.
          stopHarnessRetry()
          harnessNotReadyYet = false
          if (harnessPendingStatus !== undefined) {
            harnessProviderStatus = harnessPendingStatus
            harnessPendingStatus = undefined
          }
        }
        // Otherwise keep retrying: an unresolved AUTO candidate is retryable
        // until the cap, never terminal on an incomplete registry/directory.
      })
    }, HARNESS_RETRY_INTERVAL_MS)
    ;(harnessRetryTimer as { unref?: () => void } | undefined)?.unref?.()
  }
  if (harnessNotReadyYet) startHarnessRetry()
  // The plugin fiber's teardown stops the retry: no leaked timers.
  ctx.effect(() => () => stopHarnessRetry())

  /**
   * The managed-worker half (EXT-20), DEFAULT OFF.
   *
   * `managedWorkers` opts the deployment in; absent, the registry exists but never
   * receives a binding, so no child process is ever spawned. The per-extension
   * activation generation is captured at RESTORE (the host's only activation surface)
   * and the registry disposes the old process the moment a newer generation is bound.
   */
  const managedWorkers = config.managedWorkers ?? false
  const workerEnvPassthrough = config.workerEnvPassthrough ?? []
  const workerRegistry = createManagedWorkerRegistry(
    config.managedWorkerInvokeTimeoutMs === undefined
      ? {}
      : { invokeTimeoutMs: config.managedWorkerInvokeTimeoutMs },
  )
  const activationGenerations = new Map<string, number>()

  const cliCommand = config.cli?.command ?? DEFAULT_CLI_COMMAND
  const cliEnabled = config.cli?.enabled ?? true
  // Established once: probing PATH per model would repeat identical work and
  // make the reported reasons depend on when they were read.
  const cliAvailable = cliEnabled && commandExists(cliCommand)
  const remoteEndpoint = config.remote?.endpoint
  const transportOptions = {
    cliCommand,
    ...remoteEndpoint !== undefined ? { endpoint: remoteEndpoint } : {},
    ...config.remote?.token !== undefined ? { token: config.remote.token } : {},
  }

  /**
   * THE STORE'S INSTALLED EXTENSION IDS (task-49).
   *
   * A store-installed extension lives under the profile's extension directory and is never
   * resolvable from this plugin's module context, so capability probing must consult the
   * store. Without this the host reported "not installed" about packages it had installed,
   * and every provider model stayed `runnable: false` while its tool was callable.
   *
   * An absent store means no ids — the same answer as before, never an error.
   */
  const storeInstalledExtensions = new Set(
    (extensionStore?.listInstalled().value ?? []).map(record => record.extensionId),
  )
  const providerInstalled = (extensionId: string): boolean => storeInstalledExtensions.has(extensionId)

  const resolved: ResolvedModel[] = entries.map(entry => ({
    entry,
    verdict: resolveCapability(entry, {
      cliAvailable,
      remoteEndpoint,
      providerInstalled,
      ...config.allowNpm !== undefined ? { allowNpm: config.allowNpm } : {},
    }),
  }))
  const byId = new Map(resolved.map(item => [item.entry.id, item]))

  /**
   * Choose the implementation that serves each standard contract (BASE-02).
   *
   * A contract is registered once. Selection is host configuration: an explicit
   * `providers` override wins only if that model can actually run here, and
   * otherwise the first eligible implementation in catalog order is used. The
   * alternatives are kept so discovery can report them without a caller having to
   * choose a model.
   */
  // The host owns provenance and authority: `extension`/`version` name THIS
  // package, and the grant is built from operator configuration, so an
  // implementation can forge neither (BASE-05, DECL-03).
  /** The most recent invocation receipts (EXT-35), bounded by the surface. */
  const invocationReceipts = receiptSurface.receipts
  /** Host-known contract/implementation identity for a tool name (OBS-01). */
  const receiptIdentityByTool = new Map<string, {
    readonly contract: string
    readonly contractVersion: string
    readonly implementationId: string
    readonly extension: string
    readonly extensionVersion: string
  }>()
  /** Lifecycle outcomes, recorded SEPARATELY from invocation provenance (EXT-35). */
  const lifecycleRecords: LifecycleRecord[] = []
  /** Active extension tool calls, so deactivation can cancel and bound them (EXT-27). */
  const activeExtensionCalls = new Map<string, Set<{
    readonly abort: () => void
    readonly done: Promise<void>
    readonly settled: () => boolean
  }>>()

  /** Track one extension call; the returned finish MUST run in a finally block. */
  function trackExtensionCall(extensionId: string, parent: AbortSignal | undefined): {
    readonly signal: AbortSignal
    readonly finish: () => void
  } {
    const controller = new AbortController()
    let settled = false
    let resolve: () => void = () => {}
    const done = new Promise<void>(settle => { resolve = settle })
    const entry = {
      abort: () => controller.abort(),
      done,
      settled: () => settled,
    }
    const existing = activeExtensionCalls.get(extensionId) ?? new Set()
    existing.add(entry)
    activeExtensionCalls.set(extensionId, existing)
    const signal = parent === undefined ? controller.signal : AbortSignal.any([parent, controller.signal])
    return {
      signal,
      finish: () => {
        if (settled) return
        settled = true
        resolve()
        existing.delete(entry)
        if (existing.size === 0) activeExtensionCalls.delete(extensionId)
      },
    }
  }

  /** Abort owned calls and wait up to the documented grace period (EXT-27). */
  async function withdrawExtensionCalls(extensionId: string): Promise<boolean> {
    const calls = activeExtensionCalls.get(extensionId)
    if (calls === undefined || calls.size === 0) return true
    for (const call of calls) call.abort()
    let timer: NodeJS.Timeout | undefined
    const completed = await Promise.race([
      Promise.all([...calls].map(call => call.done)).then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5_000) }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    return completed && [...calls].every(call => call.settled())
  }

  /**
   * RES-01: measured admission at the INVOCATION boundary. The value is measured
   * before work begins and over-budget input is refused with the ACTUAL limits.
   */
  function admitSerialized(label: 'input' | 'result', value: unknown, limit: number): void {
    const measured = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
    const decision = admit({ sourceBytes: measured }, { sourceBytes: limit })
    if (decision.admitted) return
    const detail = decision.exceeded.map(entry => `${entry.measured} > ${entry.limit}`).join(', ')
    throw new Error(`${label} exceeds the declared budget: ${detail} bytes (${label === 'input' ? 'maxInputBytes' : 'maxResultBytes'})`)
  }
  /** Apply the host's lifecycle-audit policy to one SDK/service event. */
  recordLifecycleEvent = (event: LifecycleAuditEvent): void => {
    try {
      lifecycleRecords.push(buildLifecycleRecord({
        operation: event.operation,
        extensionId: event.extensionId,
        version: event.version,
        contentDigest: null,
        profile: 'default',
        outcome: event.outcome === 'succeeded' ? 'succeeded' : 'failed',
        reason: event.reason ?? null,
        approvedBy: { kind: 'operator', identity: 'local-interactive' },
      }))
      if (lifecycleRecords.length > MAX_RETAINED_RECEIPTS) lifecycleRecords.shift()
    } catch (error) {
      ctx.logger.warn(`model-tools: lifecycle audit record failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  /**
   * External (MCP) call accounting, bounded like the receipts (OBS-02).
   *
   * Kept SEPARATE from the native receipts: the shapes differ (a native receipt
   * is provenance — contract/implementation/extension identities — while an
   * external accounting is timings, class and sizes), and merging them would
   * force one record to pretend it is the other.
   */
  const externalAccountings: InvocationAccounting[] = []
  const grant = createGrant({
    grantId: config.grantId ?? 'local-interactive',
    // Every registered tool is granted to the interactive operator. EXTERNAL
    // clients do NOT share this grant: since round 66, each authenticated MCP
    // client's call carries its OWN derived grant (SEC-04) — resolved by the
    // transport, enforced at the surface boundary below with authorizeTool — so
    // an external call never dispatches as the operator. model_tools is part of
    // THIS grant only, which is why it is reachable interactively but never
    // appears on the external surface.
    allowedTools: [...STANDARD_CONTRACTS.map(contract => contract.toolName), 'model_tools'],
    allowedHarnessProfiles: Object.keys(config.harnessProfiles ?? {}),
    approvedRoots: resolveApprovedRoots(config.approvedRoots ?? []),
    hostedCode: false,
    recordingPolicy: config.recordReceipts === false ? 'none' : 'receipts',
    ...config.limits === undefined ? {} : { limits: config.limits },
  })
  const host: HostIdentity = {
    extension: '@try-works/dsh-tool-mode',
    extensionVersion: HOST_VERSION,
    activationGeneration: 1,
    nextReceiptId: () => receiptSurface.nextReceiptId(),
    grant,
    callerKind: 'interactive',
    // EXT-35: bounded in-memory retention. A receipt is provenance, not a log of
    // content, so retaining the last N costs little and makes the record
    // recoverable after the call rather than only during it.
    recordReceipt: receipt => {
      // Persist FIRST, then update the read cache. A failed write throws out of the
      // call path rather than presenting a receipt that would vanish on restart.
      receiptSurface.record(receipt)
    },
    receiptSession: exec => {
      const sessionId = sessionIdOfAgent((exec as { agent?: unknown }).agent)
      const scope = scopeForAuthoringCaller?.(exec as { agent?: unknown })
      return {
        ...sessionId === undefined ? {} : { sessionId, rootSessionId: scope?.rootSessionId ?? sessionId },
        ...(exec as { parent?: unknown }).parent === undefined ? {} : { nested: true },
      }
    },
  }

  /** Record one auxiliary harness-model call as a native-shaped receipt (OBS-01). */
  function recordAuxiliaryReceipt(record: BrokerRecord, extensionId: string, extensionVersion: string): void {
    host.recordReceipt?.(buildInvocationReceipt({
      receiptId: host.nextReceiptId(),
      contract: record.contractId,
      contractVersion: '1.0.0',
      implementationId: record.recipeId,
      extension: extensionId,
      extensionVersion,
      modelIdentity: record.providerId,
      recipeVersion: record.recipeVersion,
      activationGeneration: extensionLifecycle?.generation ?? host.activationGeneration,
      executionLocation: record.destination === 'remote' ? 'remote' : 'host',
      kind: 'auxiliary',
      usage: 'unknown',
      cost: 'unknown',
      warnings: [`provider generation ${record.providerGeneration}`, `prompt bytes ${record.prompt.length}`],
    }))
  }

  /**
   * Extension providers, reached only through the public extension API (BASE-09).
   *
   * The host holds no adapter for any model: a catalog entry names the package
   * that implements it, and this bridge loads it. One bridge per activation, so an
   * extension serving several models is imported once.
   */
  const bridge = new ProviderBridge({
    grant,
    activationGeneration: host.activationGeneration,
    // A STORE INSTALL is reached through the path the operator installed, never by
    // package name: the store is off the plugin's module graph, so by-name resolution
    // fails and the deployment records `failed` on every boot.
    installedPath: extensionId => selectedInstalled(extensionId)?.installPath,
    // EXT-20: the opt-in routes the bridge's catalog invocation AND inspection
    // through the managed-worker registry; without it the in-process path is
    // exactly as before (default OFF).
    ...managedWorkers ? { managed: workerRegistry } : {},
    log: (message, fields) => ctx.logger?.debug?.(`[model-as-tool] ${message}`, fields),
  })

  const contractById = new Map<string, ToolContract>(
    STANDARD_CONTRACTS.map(contract => [contract.contract, contract]),
  )
  const bindings = new Map<string, ContractBinding>()
  for (const contract of STANDARD_CONTRACTS) {
    const eligible = resolved.filter(
      item => item.entry.contract === contract.contract && item.verdict.runnable,
    )
    if (eligible.length === 0) continue
    const override = config.providers?.[contract.contract]
    const chosen = eligible.find(item => item.entry.id === override) ?? eligible[0]
    if (chosen === undefined) continue
    const adapter = createAdapter(chosen.entry, { route: chosen.verdict.route, ...transportOptions }, undefined, bridge)
    if (adapter === undefined) continue
    bindings.set(contract.contract, {
      contract,
      implementation: chosen.entry,
      adapter,
      route: chosen.verdict.route,
      alternatives: eligible.filter(item => item.entry.id !== chosen.entry.id).map(item => item.entry.id),
    })
  }


  /** Contracts already registered, so a second implementation joins rather than duplicates. */
  const registeredContracts = new Map<string, { toolName: string; dispose: () => void }>()

  /**
   * TOOLS PUBLISHED BY EXTENSIONS, for the MCP surface.
   *
   * Extension-owned tools are deliberately DEFERRED from the catalogue contract map above
   * (the extension registers them itself), so a surface built only from that map advertised
   * `tool_mode_run` while withholding every installed model tool. MCP clients listed an empty
   * catalogue and programs could not bind `lang_detect`. Each registration boundary records
   * the tool's DECLARED schemas here — never a host guess — and the surface publishes them.
   */
  const extensionMcpTools = new Map<string, {
    readonly description: string
    readonly inputSchema?: Readonly<Record<string, unknown>>
    readonly outputSchema?: Readonly<Record<string, unknown>>
  }>()
  /** DECL-08: sha256 of the installed recipe, keyed by caller-facing tool name. */
  const declarativeRecipeDigests = new Map<string, string>()
  /**
   * The contract identity of every tool this plugin publishes (task-52).
   *
   * A discovery artifact must be able to PIN the contract it was built on; without this a
   * consumer needs one `tool_mode_describe` call per tool to learn it. Populated at the same
   * boundary that publishes and withdraws the tool, so discovery never reads a stale entry.
   */
  const toolContracts = new Map<string, { readonly contract: string; readonly contractVersion: string | null }>()
  /** Tool names published by TOOL-MODE extensions: part of the DECL-07 owned surface. */
  const ownedExtensionToolNames = new Set<string>()
  const exposeExtensionToolToMcp = (
    name: string,
    tool: {
      readonly description: string
      readonly inputSchema?: Readonly<Record<string, unknown>>
      readonly outputSchema?: Readonly<Record<string, unknown>>
    },
  ): void => { extensionMcpTools.set(name, tool) }
  const withdrawExtensionToolFromMcp = (name: string): void => { extensionMcpTools.delete(name) }

  /**
   * The MCP surface over the tools this activation actually published (MCP-08/09).
   *
   * It reads `registeredContracts`, so a tool appears over MCP only if it was
   * REGISTERED here — the publication surface already decided that, and re-deriving
   * it would let MCP advertise something the host had withheld.
   */
  /**
   * P26-14: the catalog cache policy is operator configuration, validated ONCE here at
   * apply. `tools/list` and `server/discover` are authorization-filtered, so the scope
   * must stay private; a non-private scope or a bad TTL throws a NAMED error instead of
   * reaching the wire as a misleading cache header.
   */
  const catalogCachePolicy = normalizeCachePolicy({
    ttlMs: config.mcpV3?.catalogTtlMs ?? 0,
    cacheScope: config.mcpV3?.catalogCacheScope ?? 'private',
  })
  const catalogFacts = (): Record<string, unknown> => ({
    profile: 'default',
    generation: extensionLifecycle?.generation ?? host.activationGeneration,
    models: resolved.map(item => ({
      id: item.entry.id,
      available: item.verdict.runnable,
      installed: installed.has(item.entry.id),
    })),
  })

  const mcpHost = createMcpHost({
    serverInfo: { name: '@try-works/dsh-tool-mode', version: HOST_VERSION },
    confidentialTools: [...confidentialTools],
    catalogFacts,
    cachePolicy: catalogCachePolicy,
    surface: {
      get published() {
        const out: PublishedTool[] = []
        for (const [contractId, registered] of registeredContracts) {
          const contract = contractById.get(contractId)
          if (contract === undefined) continue
          out.push({ toolName: registered.toolName, contract })
        }
        /**
         * EXTENSION-PUBLISHED TOOLS. The deferral above is why this loop exists: an active
         * extension owns its name and registers it outside `registeredContracts`, so MCP
         * must read the registration boundary too or the catalogue is empty on the wire.
         * A tool without a declared output schema is WITHHELD with its reason rather than
         * advertised with a partial shape (MCP-09).
         */
        for (const [toolName, tool] of extensionMcpTools) {
          if (out.some(published => published.toolName === toolName)) continue
          const contract = {
            description: tool.description,
            inputSchema: tool.inputSchema ?? { type: 'object', additionalProperties: true },
            outputSchema: tool.outputSchema ?? {},
          } as never
          out.push(tool.outputSchema === undefined
            ? {
                toolName,
                contract,
                description: tool.description,
                notExportableReason: 'the extension declares no output schema, so MCP cannot advertise a result shape',
              }
            : { toolName, contract, description: tool.description })
        }
        // DECL-07: read-only discovery is available to native AND external callers.
        // These are host-owned contracts, not model-package contributions.
        out.push({ toolName: 'tool_mode_list', contract: TOOL_MODE_LIST_CONTRACT as never })
        out.push({ toolName: 'tool_mode_describe', contract: TOOL_MODE_DESCRIBE_CONTRACT as never })
        // Custom tools: registered agent tools are MCP-visible only after the
        // per-tool opt-in. A tool without an opt-in is still listed as WITHHELD
        // so the status surface can explain why it is absent.
        if (customToolsServiceRef !== undefined) {
          const records = customToolsServiceRef.registrar.list()
            .map(registration => customToolsServiceRef?.store.read(registration.id))
            .filter((record): record is NonNullable<typeof record> => record !== undefined)
          out.push(...customToolPublishedTools(records))
        }
        // CODE-02: `tool_mode_run` is exported over MCP exactly when the exposure
        // gate permits it — the conjunction of operator consent and confinement
        // evidence. While the gate is closed the export is simply absent, which is
        // the disabled-until-granted state CODE-10 names. The contract is ONE
        // shared definition (TOOL_MODE_RUN_CONTRACT), validated by a conformance
        // test before it ever appears on a live tools/list.
        // The pure combiner and the optional Jev batch are host-owned contracts.
        out.push({ toolName: 'decision_combine', contract: DECISION_COMBINE_CONTRACT as never })
        out.push({ toolName: 'decision_route', contract: DECISION_ROUTE_CONTRACT as never })
        out.push({ toolName: 'decision_evaluate', contract: DECISION_EVALUATE_CONTRACT as never })
        if (config.jev?.enabled === true) {
          out.push({ toolName: 'decision_choose_jev', contract: JEV_CHOOSE_CONTRACT as never })
          out.push({ toolName: 'decision_judgments_jev', contract: JEV_JUDGMENTS_CONTRACT as never })
        }
        if (programRunner.externalExposurePermitted()) {
          out.push({ toolName: 'tool_mode_run', contract: TOOL_MODE_RUN_CONTRACT as never })
        }
        const confidentialityFiltered = out.map(tool => confidentialTools.has(tool.toolName)
          ? { ...tool, notExportableReason: 'the operator confidentiality policy blocks this tool' }
          : tool)
        return applyMcpExportPolicy(confidentialityFiltered, config.mcpV3?.exportTools)
      },
      /**
       * Slice 3: names the publication decision WITHHELD, with the same reasons
       * `published` carries. Confidential tools are excluded here because the
       * confidentiality check (MCP-11) refuses them before any lookup, and a reason
       * map must not become a second way to learn about them.
       */
      get withheld() {
        const reasons = new Map<string, string>()
        for (const tool of this.published) {
          if (tool.notExportableReason !== undefined && !confidentialTools.has(tool.toolName)) {
            reasons.set(tool.toolName, tool.notExportableReason)
          }
        }
        return reasons
      },
      async execute({ name, arguments: args, signal, callId, caller }) {
        if (confidentialTools.has(name)) {
          // MCP-11: block before authorization or execution; a content redaction after
          // the fact would still leave the canonical value reachable.
          return {
            isError: true,
            message: `"${name}" is blocked by the operator confidentiality policy (MCP-11)`,
          }
        }
        /**
         * SEC-04: AN EXTERNAL CLIENT RUNS UNDER ITS OWN GRANT, never the host's.
         *
         * The transport resolved the authenticated caller and its derived grant; the
         * host ENFORCES it here with the SEC-03 authority — a tool the operator is
         * granted but the client is not stays refused for that client. A call with no
         * caller (the native/interactive path) keeps the host's own authority, which
         * is unchanged.
         */
        if (caller !== undefined) {
          try {
            authorizeTool({
              grantId: caller.grantId,
              allowedTools: caller.allowedTools,
              approvedRoots: [],
              remoteDestinations: caller.remoteDestinations,
              allowedHarnessProfiles: caller.allowedHarnessProfiles,
              modelCapabilities: caller.modelCapabilities,
              hostedCode: false,
              recordingPolicy: caller.recordingPolicy,
              limits: caller.limits,
            }, name)
          } catch (error) {
            // The refusal is a TOOL error, not a protocol error: the exchange
            // succeeded and the grant refused the work (P26-04, SEC-03).
            return { isError: true, message: error instanceof Error ? error.message : String(error) }
          }
        }
        // MCP-08: routed through the DSH tool runtime with a SERVER-ISSUED call
        // identity and the CALLER's signal, never by resolving a definition and
        // calling it directly — that path would bypass the grant, the receipt and
        // the result policy the runtime applies.
        //
        // SEC-04 COMPOSITION: an external call runs INSIDE the caller's grant
        // context, so any COMPOSED work — a tool_mode_run program dispatching
        // sub-calls — authorizes against the CLIENT's grant, not the host's
        // (H1). The native path carries no context and is unchanged.
        const result = caller === undefined
          ? await ctx.tools.execute({
              signal,
              callId: ToolCallId(callId),
              name,
              arguments: args,
            })
          : await externalGrantContext.run(caller.allowedTools, () => ctx.tools.execute({
              signal,
              callId: ToolCallId(callId),
              name,
              arguments: args,
            }), caller.allowedHarnessProfiles, caller.remoteDestinations)
        return result.isError
          ? { isError: true, message: result.error.message }
          : { isError: false, value: result.value }
      },
    },
    onWithheld: tool => {
      mcpWithheldTools.add(tool.toolName)
      mcpWithheldReasons.set(tool.toolName, tool.notExportableReason ?? 'the export policy supplied no reason')
      ctx.logger.info(
        `model-tools: ${tool.toolName} is not exported over MCP: ${tool.notExportableReason ?? 'no reason given'}`,
      )
    },
    // OBS-02: the external half of the traffic gets its receipt WIRED rather than
    // dropped. The hook receives timings, class and SIZES — never the payload —
    // so this records the external call without duplicating a large result. The
    // ring is bounded exactly like the native one (EXT-35). TASK-13: the same hook
    // appends the bounded external ledger row (tool name included, payload absent).
    onAccounted: (accounting, toolName) => {
      externalAccountings.push(accounting)
      if (externalAccountings.length > MAX_RETAINED_RECEIPTS) externalAccountings.shift()
      mcpUsageLedger.record(recordFromAccounting(toolName, accounting))
      // OBS-01: the external lane now yields a NATIVE-SHAPED provenance receipt,
      // not only an accounting row. Identity comes from the host's registration
      // map; no caller-supplied value participates.
      const identity = receiptIdentityByTool.get(toolName) ?? {
        contract: toolName,
        contractVersion: 'unknown',
        implementationId: toolName,
        extension: host.extension,
        extensionVersion: host.extensionVersion,
      }
      const outcome = accounting.failureClass === 'none'
        ? 'ok'
        : accounting.failureClass === 'cancelled'
          ? 'cancelled'
          : accounting.failureClass === 'timeout'
            ? 'timed-out'
            : accounting.failureClass === 'refused' || accounting.failureClass === 'policy-denied'
              ? 'policy-denied'
              : 'failed'
      // The native dispatch already recorded a receipt with this id when the call
      // ran. Mark THAT receipt as the external lane rather than appending a second
      // row with the same correlation id.
      const existing = invocationReceipts.find(receipt => receipt.receiptId === accounting.receiptId)
      if (existing !== undefined) {
        Object.assign(existing, {
          kind: 'external',
          outcome,
          warnings: [
            ...existing.warnings,
            `external client ${accounting.clientId ?? 'unknown'}`,
            `grant ${accounting.grantId ?? 'unknown'}`,
          ],
        })
        return
      }
      host.recordReceipt?.(buildInvocationReceipt({
        receiptId: accounting.receiptId,
        ...identity,
        modelIdentity: 'none',
        activationGeneration: host.activationGeneration,
        executionLocation: 'host',
        kind: 'external',
        outcome,
        warnings: [
          `external client ${accounting.clientId ?? 'unknown'}`,
          `grant ${accounting.grantId ?? 'unknown'}`,
        ],
      }))
    },
  })

  /**
   * THE HOST'S OWN MCP SURFACE, EXPOSED so an operator can serve it (OBS-02).
   *
   * Before this service existed the host's mcpHost was reachable only through
   * the model_tools inspection actions — which meant its `callTool` path (and
   * therefore the wired external accounting) had NO production caller. The
   * service is what `startHttpServer` composes over; a deployment that serves
   * MCP reads it here instead of rebuilding a surface that would not carry the
   * host's receipts.
   *
   * Guarded (round 65): `provide` THROWS if the name is already provided in the
   * scope (a double mount), and a context without `provide` must degrade with a
   * diagnostic rather than silently or loudly failing the mount.
   */
  await startMcpSurface({
    ctx,
    mcpV3: config.mcpV3 as never,
    credentialStore,
    mcpHost,
    onStarted: endpoint => {
      mcpBoundEndpoint = endpoint
      mcpStartedAt = Date.now()
    },
  })

  /**
   * The publication decision for one catalog entry (EXT-24, EXT-32).
   *
   * ONE function decides what may be published, used by the installer and by the
   * discovery surface. Two call sites computing this separately is how a tool ends
   * up registered while discovery reports it withheld, or the reverse.
   */
  /**
   * The selected implementation's current preparation state.
   *
   * Capability resolution only proves that a route can be reached. For extension
   * providers that is not enough to publish a working tool: the extension's
   * read-only inspection owns the distinction between missing prerequisites,
   * prepared-cold and ready. Non-extension transports have no preparation
   * lifecycle yet, so their existing capability verdict remains the readiness
   * source.
   */
  const readinessOf = async (item: ResolvedModel): Promise<ImplementationCandidate['readiness']> => {
    if (item.verdict.route !== 'extension') return 'ready'
    try {
      const inspection = await bridge.inspect(item.entry, new AbortController().signal)
      return inspection?.readiness ?? 'failed'
    } catch (error) {
      ctx.logger.warn(
        `model-tools: ${item.entry.name} provider inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return 'failed'
    }
  }

  const implementationFor = async (item: ResolvedModel): Promise<ImplementationCandidate> => ({
    extensionId: item.entry.provider?.extension
      ?? item.entry.npmPackage
      ?? 'unknown',
    modelId: item.entry.id,
    readiness: await readinessOf(item),
    runnable: item.verdict.runnable,
  })

  const surfaceFor = async (entry: ModelCatalogEntry): Promise<CatalogGeneration | undefined> => {
    const binding = entry.contract === null ? undefined : bindings.get(entry.contract)
    if (binding === undefined) return undefined
    const selected = resolved.find(item => item.entry.id === binding.implementation.id)
    if (selected === undefined) return undefined
    return buildSurface({
      generation: host.activationGeneration,
      tools: [{
        name: binding.contract.toolName,
        contractId: binding.contract.contract,
        selectedModelId: binding.implementation.id,
        implementations: [
          await implementationFor(selected),
          ...await Promise.all(binding.alternatives.map(async alternativeId => {
            const alternative = resolved.find(item => item.entry.id === alternativeId)
            return alternative === undefined
              ? {
                  extensionId: 'unknown',
                  modelId: alternativeId,
                  readiness: 'failed' as const,
                  runnable: false,
                }
              : implementationFor(alternative)
          })),
        ],
      }],
      skills: [],
    })
  }

  /**
   * Register one model's tool and skill.
   *
   * A model bound to a standard contract contributes to that CONTRACT's single
   * tool; a model with no contract keeps its own per-model tool. Idempotent in
   * both cases, so the control tool can call it without first checking.
   * @param item - the resolved model to install.
   * @returns whether the model is installed after the call.
   */
  const install = async (item: ResolvedModel): Promise<boolean> => {
    const { entry, verdict } = item
    if (installed.has(entry.id)) return true
    if (!verdict.runnable && !exposeUnavailable) return false

    let toolName = entry.tool.name
    let dispose: () => void

    if (entry.contract !== null && contractById.has(entry.contract)) {
      const binding = bindings.get(entry.contract)
      if (binding === undefined) {
        /**
         * A provider-bound model whose contract has no host binding is still served
         * by its extension, which owns the tool name. Record it and report success;
         * only a model with no owner is the "not the selected provider" case.
         */
        if (entry.provider !== undefined && extensionOwnsToolName(entry.tool.name)) {
          catalogueDeferred.add(entry.id)
          installed.set(entry.id, { entry, toolName: entry.tool.name, dispose: () => {} })
          notifyCatalogChange()
          return true
        }
        // The model implements a contract but lost provider selection, or cannot
        // run. Report rather than register a second tool for the same contract.
        ctx.logger.info(
          `model-tools: ${entry.name} implements ${entry.contract} but is not the selected provider; `
          + 'no separate tool is registered (BASE-02)',
        )
        return false
      }

      /**
       * EXT-24: decide what may be published BEFORE registering anything.
       *
       * The surface is built whole and consulted first, so a tool is registered
       * only when the surface actually published it. Registering first and
       * reconciling afterwards is the state EXT-24 forbids: a caller would observe
       * an available tool whose binding was not yet in place.
       *
       * One helper serves the installer and the discovery surface, because two call
       * sites computing this separately is how a tool gets registered while
       * discovery reports it withheld, or the reverse.
       */
      const surface = await surfaceFor(entry)
      const decision = surface?.tools[0]
      if (decision === undefined) {
        const reason = surface?.withheld[0]
        ctx.logger.info(
          `model-tools: ${entry.name} is active but its tool is withheld (${reason?.code ?? 'unknown'}): `
          + `${reason?.message ?? 'no reason reported'}`,
        )
        return false
      }

      const existing = registeredContracts.get(entry.contract)
      if (existing !== undefined) {
        // Already served by another implementation: this model joins that tool.
        toolName = existing.toolName
        dispose = () => {}
      } else if (extensionOwnsToolName(entry.tool.name) || extensionOwnsToolName(contractById.get(entry.contract)?.toolName ?? '')) {
        /**
         * TASK-117: an installed extension OWNS this tool name — its
         * activation registers it, so the catalogue registration is SKIPPED
         * rather than racing it (the live EXTENSION_FAULT). The deferral is
         * recorded; the extension's deactivation restores the catalogue tool.
         */
        catalogueDeferred.add(entry.id)
        ctx.logger.info(
          `model-tools: ${entry.name}'s tool ${entry.tool.name} is owned by an installed extension; `
          + 'the catalogue registration is deferred until the extension releases the name',
        )
        // The extension serves the tool already: enabling the catalogue entry is a
        // success that records the model, never "cannot be installed here".
        toolName = entry.tool.name
        dispose = () => {}
      } else {
        const registered = registerContractTool(
          ctx as unknown as { tools: { register(definition: unknown): () => void } },
          binding,
          host,
          { deferHeavySchemas: config.deferHeavySchemas === true },
        )
        registeredContracts.set(entry.contract, registered)
        toolName = registered.toolName
        dispose = registered.dispose
        receiptIdentityByTool.set(toolName, {
          contract: entry.contract,
          contractVersion: contractById.get(entry.contract)?.version ?? 'unknown',
          implementationId: entry.id,
          extension: host.extension,
          extensionVersion: host.extensionVersion,
        })
      }
    } else if (entry.provider !== undefined) {
      /**
       * PROVIDER-BOUND: the extension owns the tool name. When it is active the
       * catalogue joins that tool instead of registering a second one; when it is
       * not active there is no tool to join, so the entry is skipped rather than
       * replaced by a provider-bridge tool the MCP surface cannot export.
       */
      if (!extensionOwnsToolName(entry.tool.name)) {
        ctx.logger.info(
          `model-tools: ${entry.name}'s provider extension is not active; skipping ${entry.tool.name}`,
        )
        return false
      }
      catalogueDeferred.add(entry.id)
      toolName = entry.tool.name
      dispose = () => {}
    } else {
      const adapter = createAdapter(entry, { route: verdict.route, ...transportOptions }, undefined, bridge)
      if (adapter === undefined) {
        // Runnable but no adapter yet: report rather than register a dead tool.
        ctx.logger.info(
          `model-tools: ${entry.name} can run here (${verdict.route}) but no adapter ships yet; skipping ${entry.tool.name}`,
        )
        return false
      }
      const operations = modelOperations(entry)
      const registrations = operations.map(operation => registerModelTool(
        ctx as unknown as { tools: { register(definition: unknown): () => void } },
        entry,
        adapter,
        { deferHeavySchemas: config.deferHeavySchemas === true },
        operation,
      ))
      toolName = registrations[0]?.toolName ?? entry.tool.name
      dispose = () => { for (const registration of registrations) registration.dispose() }
    }

    const record: InstalledModel = { entry, toolName, dispose }

    if (registerSkills) {
      const skills = ctx.get('skills')
      if (skills !== undefined) {
        const body = renderSkillBody(entry, playbooks.get(entry.id))
        record.disposeSkill = skills.register({
          name: entry.skill.name,
          description: entry.skill.description,
          ...entry.skill.whenToUse !== undefined ? { whenToUse: entry.skill.whenToUse } : {},
          content: body,
          source: 'bundled',
        })
      }
    }

    // BASE-03: the deprecated alias is opt-in, so the default catalog shows one
    // transcription tool. It keeps its own name and adapter, never the new
    // contract's schema, so an old caller's arguments are not reinterpreted.
    if (config.legacyAliases === true && entry.contract !== null && entry.tool.name !== toolName) {
      const aliasAdapter = createAdapter(entry, { route: verdict.route, ...transportOptions }, undefined, bridge)
      if (aliasAdapter !== undefined) {
        const alias = registerModelTool(
          ctx as unknown as { tools: { register(definition: unknown): () => void } },
          entry,
          aliasAdapter,
          { deferHeavySchemas: config.deferHeavySchemas === true },
        )
        record.disposeAlias = alias.dispose
        ctx.logger.info(`model-tools: registered deprecated alias ${alias.toolName} (BASE-03)`)
      }
    }

    installed.set(entry.id, record)
    ctx.logger.info(
      `model-tools: registered ${toolName} for ${entry.name} (${verdict.route})`,
    )
    notifyCatalogChange()
    return true
  }

  /**
   * Unregister one model's tool and skill.
   * @param modelId - the catalog id to remove.
   * @returns whether the model was installed.
   */
  const uninstall = (modelId: string): boolean => {
    const record = installed.get(modelId)
    if (record === undefined) return false
    record.disposeSkill?.()
    record.disposeAlias?.()
    record.dispose()
    // A contract-served model's registration is owned by the contract; dropping
    // the last model that used it must also release the contract's tool, or a
    // removed implementation would keep answering calls.
    if (record.entry.contract !== null) {
      const stillInstalled = [...installed.values()].some(
        other => other.entry.id !== modelId && other.entry.contract === record.entry.contract,
      )
      if (!stillInstalled) registeredContracts.delete(record.entry.contract)
    }
    installed.delete(modelId)
    ctx.logger.info(`model-tools: unregistered ${record.toolName}`)
    notifyCatalogChange()
    return true
  }

  /**
   * Record one user choice durably.
   *
   * A failed write is reported rather than swallowed: the caller asked for a
   * change that is supposed to survive a restart, and quietly keeping it
   * in-memory would make the next session silently disagree.
   * @param modelId - the model the user acted on.
   * @param enabled - true to turn on, false to turn off.
   * @returns whether the choice was written to the durable store.
   */
  const remember = (modelId: string, enabled: boolean): boolean => {
    persisted = withChoice(persisted, modelId, enabled)
    if (!persist) return false
    stateStore.write(persisted)
    return true
  }

  /** The configuration's own selection, before the user's choices are layered on. */
  const configuredIds = resolved
    .filter(item => (wanted === undefined || wanted.has(item.entry.id)) && !excluded.has(item.entry.id))
    .map(item => item.entry.id)

  /**
   * TASK-117: the deferred catalogue registrations, restored when the owning
   * extension releases a tool name (deactivation). Runs after `install` and
   * `resolved` exist; the onActivationChange hook fires it asynchronously.
   */
  const restoreDeferredCatalogue = async (): Promise<void> => {
    for (const modelId of [...catalogueDeferred]) {
      const item = resolved.find(candidate => candidate.entry.id === modelId)
      if (item === undefined) {
        catalogueDeferred.delete(modelId)
        continue
      }
      if (extensionOwnsToolName(item.entry.tool.name)) continue
      catalogueDeferred.delete(modelId)
      // A deferred model was recorded as served by the extension; drop that record
      // first or install() short-circuits on it and never registers the catalogue tool.
      if (installed.has(modelId)) uninstall(modelId)
      ctx.logger.info(`model-tools: ${item.entry.name}'s tool ${item.entry.tool.name} is released; restoring the catalogue registration`)
      try {
        await install(item)
      } catch (error) {
        // A failed restore is reported, never swallowed silently: the operator
        // must see why the catalogue tool did not come back.
        ctx.logger.warn(
          `model-tools: could not restore the catalogue registration for ${item.entry.name}: `
          + `${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  for (const item of resolved) {
    const { install: selection, disabled } = resolveSelection(configuredIds, persisted)
    if (!selection.has(item.entry.id)) {
      if (disabled.has(item.entry.id) && item.verdict.runnable) {
        ctx.logger.info(`model-tools: ${item.entry.name} stays uninstalled (disabled by the user)`)
      }
      continue
    }
    // A model the user enabled that cannot run here is reported, not installed:
    // the persisted choice is kept so it takes effect once a route appears.
    await install(item)
  }

  /**
   * The host's EXT-30 update surface, constructed when the extension store is
   * configured (the management-channel actions below drive it). Declared here,
   * outside the control-tool registration, so the execute closure and the
   * extension-store block share it.
   */
  let updateSurface: UpdateHostSurface | undefined

  /**
   * The host's prepared-assets surface (RES-02/03/05, the last slice): lock
   * reading, the preparation plan, acquisition and the PreparedAssetMapV1 the
   * provider routes consume. Same outer-scope reason as updateSurface.
   */
  let prepareAssetsSurface: PrepareAssetsSurface | undefined

  if (config.registerControlTool ?? true) {
    const controlDefinition = createModelToolsControl({
      ctx,
      config,
      persisted: () => persisted,
      setPersisted: next => { persisted = next },
      stateStore,
      persist,
      resolved,
      installed,
      byId,
      configuredIds,
      invocationReceipts,
      surfaceFor,
      install,
      uninstall,
      remember,
      mcpHost,
      mcpWithheldReasons,
      credentialStore,
      externalAccountings,
      lifecycleRecords,
      authoringReceipts: () => authoringReceipts?.() ?? [],
      recordLifecycleEvent: event => recordLifecycleEvent(event),
      notifyCatalogChange,
      updateSurface: () => updateSurface,
      prepareAssetsSurface: () => prepareAssetsSurface,
    })

    /**
     * BASE-07 / SEC-09: discovery is read-only by default. Mutations live on a
     * SEPARATE tool that only exists when the operator sets `managementGrant`.
     * The read-only clone advertises only its own action set and rejects a mutation
     * even if a caller constructs it by hand.
     */
    const readOnlyActions = [
      'list', 'installed', 'describe', 'receipts', 'mcp', 'diagnostics',
      'credentials', 'extensions-pending', 'extensions-prepare-plan',
    ] as const
    const mutationActions = new Set([
      'enable', 'disable', 'reset', 'warm',
      'extensions-approve', 'extensions-deny', 'extensions-commit', 'extensions-rollback',
      'extensions-prepare', 'extensions-purge-assets', 'extensions-license-basis',
    ])
    const readOnlyParameters = structuredClone(controlDefinition.parameters) as {
      properties?: Record<string, { enum?: readonly string[] }>
    }
    const actionProperty = readOnlyParameters.properties?.['action']
    if (actionProperty !== undefined) actionProperty.enum = readOnlyActions
    const credentials = readOnlyParameters.properties?.['sub']
    if (credentials !== undefined) credentials.enum = ['list']
    ctx.tools.register({
      ...controlDefinition,
      description:
        'Read-only inspection of the on-device models available to this agent: list what each one does and '
        + 'whether it can run on this machine, describe a model, and read diagnostics, receipts and MCP status. '
        + 'Model installation, enable/disable, credential revocation and extension management are on the separate '
        + 'management tool and require an explicit operator grant.',
      parameters: readOnlyParameters,
      async execute(args, exec) {
        const record = args as Record<string, unknown>
        const action = String(record['action'] ?? '')
        const sub = String(record['sub'] ?? '')
        if (mutationActions.has(action) || (action === 'credentials' && sub !== 'list')) {
          throw new Error(
            `model_tools is read-only; action "${action}" requires the separate model_tools_manage tool `
            + 'and an explicit managementGrant',
          )
        }
        return controlDefinition.execute(record, exec)
      },
    })
    if (config.managementGrant === true) {
      ctx.tools.register({
        ...controlDefinition,
        name: 'model_tools_manage',
        description:
          'Operator-granted management of Tool Mode: install/remove model tools, remember enable/disable choices, '
          + 'revoke external MCP credentials, and approve/commit/rollback prepared extension updates. Discovery is '
          + 'on model_tools and needs no grant.',
      })
    }

    /**
     * DECL-07 discovery is a feature module: list and describe share one binding
     * resolver, one catalog view and one readiness derivation.
     */
    registerDiscoveryControlTools({
      ctx,
      view: () => ({ resolved, installed }),
      catalogRevision: () => String(extensionLifecycle?.generation ?? host.activationGeneration),
      bindableName,
      scopeFor: exec => scopeForAuthoringCaller?.(exec),
      sessionIdOfAgent,
      externalGrant: () => externalGrantContext.current(),
      recordDiscovery: (contract, exec) => {
        const receiptId = host.nextReceiptId()
        const sessionId = sessionIdOfAgent(exec.agent)
        const scope = scopeForAuthoringCaller?.(exec)
        host.recordReceipt?.(buildInvocationReceipt({
          receiptId,
          contract,
          contractVersion: contract === 'tool_mode_list'
            ? TOOL_MODE_LIST_CONTRACT.version
            : TOOL_MODE_DESCRIBE_CONTRACT.version,
          implementationId: 'hosted-discovery',
          extension: host.extension,
          extensionVersion: host.extensionVersion,
          activationGeneration: extensionLifecycle?.generation ?? host.activationGeneration,
          executionLocation: 'host',
          modelIdentity: 'none',
          kind: 'discovery',
          runId: receiptId,
          parentReceiptId: null,
          outcome: 'ok',
          ...sessionId === undefined ? {} : { sessionId },
          ...scope?.rootSessionId === undefined ? {} : { rootSessionId: scope.rootSessionId },
        }))
      },
      authoringSnapshot: exec => authoringSnapshot?.(exec),
      sessionLedger: () => sessionLedger,
      toolContracts: () => toolContracts,
      declarativeRecipeDigests,
      workflowToolNames,
      authoredToolNames,
      ownedExtensionToolNames,
      coldFor: extensionId => {
        if (extensionId === undefined) return false
        const state = extensionLifecycle?.stateOf(extensionId)
        return state !== undefined && Object.values(state.readiness).includes('prepared-cold')
      },
    })
  }

  /**
   * ONE Tool Mode system-prompt section (P5), ordered AFTER the tool sections.
   *
   * DEFENSIVE BY DESIGN: `ctx.get` answers undefined on a host that composes no
   * systemPrompt service, and such a host must keep working — this section explains the
   * tool surface, it is never a prerequisite for it. A hard inject would make the plugin
   * unloadable there.
   *
   * The order is DERIVED from the central map, not guessed: past MCP_SERVERS and before
   * TOOLS_SDK is "after the tool sections" by construction, so a map change moves this
   * section with it instead of silently reordering it.
   */
  const promptService = ctx.get('systemPrompt') as
    | {
      readonly section: (section: {
        readonly name: string
        readonly order: number
        readonly text: string | ((context: unknown) => string)
      }) => () => void
      readonly getSectionOrder: (name: string) => number
    }
    | undefined
  if (promptService !== undefined) {
    const order = promptService.getSectionOrder('MCP_SERVERS') + 100
    ctx.effect(
      () => promptService.section({ name: 'tool-mode:readiness', order, text: TOOL_MODE_PROMPT_SECTION }),
      'tool-mode prompt section',
    )
  }

  // The registry disposes each registration with the plugin fiber, but doing it
  // explicitly keeps model resources (a loaded ONNX session, a cached weight
  // file) bounded by the plugin's own lifetime rather than the process's.
  ctx.effect(() => () => {
    for (const record of installed.values()) {
      record.disposeSkill?.()
      record.disposeAlias?.()
      record.dispose()
    }
    installed.clear()
    void bridge.dispose('shutdown')
  }, 'model-tools teardown')

  /**
   * THE AUTHORIZED PROGRAM PIPELINE, wired so its controls have a CALLER (CODE-02/03/08).
   *
   * Adversarial review found `ptc-authority.ts` and `ptc-runtime.ts` with zero callers
   * outside tests: every control in them was correct, thoroughly covered, and never ran.
   * `tool_mode_run` did not exist, so the mount guard never executed and the exposure gate
   * guarded nothing — there was no caller to refuse. A control with no callers is a symbol.
   *
   * The runner reaches tools through `buildToolBindings`, the SAME pipeline an external
   * surface would use, so authorization cannot differ between the two doors.
   *
   * SEC-04 COMPOSITION: the grant is read PER RUN from {@link externalGrantContext}. An
   * external client's call runs inside that context (set by the surface's execute), so a
   * program the client composes authorizes its sub-calls against the CLIENT's grant —
   * a client granted only `tool_mode_run` cannot reach host-granted tools through a
   * program. The native/interactive path carries no context and keeps the host's grant.
   */
  const externalGrantContext = createExternalGrantContext()
  /**
   * The DSH execution context the CURRENT program belongs to. A nested call made
   * by Code Mode must carry the same root session as the program's own caller;
   * otherwise scoping sees no session and silently degrades to global (U24).
   */
  const programAgentContext = new AsyncLocalStorage<{
    readonly agent?: unknown
    /**
     * The HOST execution token of the call that started this program. Nested
     * dispatch needs it as `parent`; without it, DSH's PTC mode treats every
     * bound call as a model-direct call and refuses it (U27).
     */
    readonly token?: unknown
  }>()
  const programContextOf = (exec: unknown): { agent?: unknown; token?: unknown } => {
    const source = exec as { readonly agent?: unknown; readonly token?: unknown } | undefined
    return {
      ...source?.agent === undefined ? {} : { agent: source.agent },
      ...source?.token === undefined ? {} : { token: source.token },
    }
  }
  const programRunner = createProgramRunner({
    context: ctx as never,
    /**
     * Resolved lazily and may be ABSENT: a deployment without the Node PTC backend still
     * runs every other tool, and failing the plugin load because an optional capability is
     * missing would remove working functionality. `prepare()` reports the absence.
     */
    backend: async () => {
      try {
        // The backend is an optional deployment fact, imported only when a run needs it
        // (EXT-19: no heavyweight load at plugin startup). The dynamic import keeps it
        // out of the module graph for hosts that never run programs.
        const module = await import('@deepseek-ai/dsh-ptc-runtime-node') as {
          default?: unknown
          NodePtcRuntime?: unknown
        }
        return module.NodePtcRuntime ?? module.default
      } catch (error) {
        ctx.logger.warn(
          `model-tools: the Node PTC backend is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        )
        return undefined
      }
    },
    /**
     * THE GRANT A PROGRAM'S SUB-CALLS AUTHORIZE AGAINST, read per run:
     * the external caller's own grant when the run happens inside an external call,
     * the host's own grant otherwise. Never a caller's claim about what it may use.
     */
    // The host's OWN registered surface: the static grant plus every tool in the live
    // registry, so a host program can bind catalog/model tools as well as authored ones.
    // An EXTERNAL caller keeps its transport-derived grant (SEC-04) and never inherits
    // this.
    grant: () => externalGrantContext.current()
      ?? [...grant.allowedTools, ...ctx.tools.schemas().map(schema => schema.name), ...authoredToolNames],
    // Read at RUN time, not once: extension restore registers tools after this closure
    // is created, and a program must see the live registry, not a stale snapshot.
    visible: () => ctx.tools.schemas().map(schema => schema.name),
    confidential: () => [...confidentialTools],
    resolve: name => async (args: Record<string, unknown>) => {      // A binding dispatches through the SAME registry pipeline a native call uses
      // (ARCH-01), so a program cannot reach a tool the registry would refuse.
      const caller = programAgentContext.getStore()
      const callerAgent = caller?.agent
      const callerToken = caller?.token
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: `ptc_${name}_${Date.now().toString(36)}` as never,
        name,
        arguments: args,
        // SAFETY: the outer tool execution already validated this context; this
        // only forwards the SAME agent and host token to the nested call.
        ...callerAgent === undefined ? {} : { agent: callerAgent as never },
        ...callerToken === undefined ? {} : { parent: callerToken as never },
      })
      if (result.isError) throw new Error(result.error?.message ?? `${name} failed`)
      return result.value
    },
    runtime: () => ctx.get(PTC_SERVICE) as unknown as {
      resolve(request: Record<string, unknown>): unknown
      run(spec: unknown): Promise<{ value?: unknown; logs?: readonly string[]; error?: { kind?: string; message?: string } }>
    } | undefined,
    // CODE-11: one root budget, charged by every nested call and never reset by
    // calling another tool. The tool-call ceiling defaults; the harness-model ceiling
    // applies only when the deployment configured it.
    budgets: {
      maxToolCalls: config.compositionV3?.maxToolCalls ?? 64,
      ...config.compositionV3?.maxHarnessModelCalls === undefined
        ? {}
        : { maxHarnessModelCalls: config.compositionV3.maxHarnessModelCalls },
      isHarnessTool: name => declarativeRecipeDigests.has(name),
    },
    // CODE-10: the operator's separate consent for hosted code execution, read
    // at check time so a config change mid-session takes effect.
    operatorGranted: () => config.hostedCode === true,
  })

  /**
   * CODE-02: `tool_mode_run` is ALWAYS registered so its CODE-10 refusal is reachable
   * on a default host; the EXPOSURE gate (`externalRefusal`) is what decides whether it
   * may serve a caller. It is NOT part of `registerControlTool` — tying it there made a
   * host that hides model_tools unregister the tool while MCP still advertised it, so
   * every external call failed "unknown tool".
   */
  /**
   * Record a FAILED composition receipt (task-57).
   *
   * A composition that THREW before returning used to leave no trace at all: the success
   * receipt was recorded after `serveProgram` resolved, so the caller got an error and the
   * receipts surface got nothing — the one case an operator most wants to audit. The record
   * is self-contained: `runId` is the receipt itself (`parentReceiptId: null`, a direct
   * composition), `at` is the builder's ISO timestamp, and the warning is a FIXED bounded
   * sentence — never the error text — so no caller content or program source can leak.
   * @param receiptId - the identity reserved for this run.
   * @param revision - the live catalog revision.
   * @param contract - the composition's contract id (`tool_mode_run` or the authored tool name).
   */
  const recordFailedComposition = (receiptId: string, revision: string, contract: string): void => {
    host.recordReceipt?.(buildInvocationReceipt({
      receiptId,
      contract,
      contractVersion: HOST_VERSION,
      implementationId: 'hosted-composition',
      extension: host.extension,
      extensionVersion: host.extensionVersion,
      activationGeneration: Number(revision),
      executionLocation: 'host',
      modelIdentity: 'none',
      runId: receiptId,
      parentReceiptId: null,
      outcome: 'failed',
      warnings: ['the composition failed before returning a result'],
    }))
  }
  registerRuntimeTools({
    ctx,
    host,
    programRunner,
    bindingPreflight,
    scopeFor: exec => scopeForAuthoringCaller?.(exec),
    catalogRevision: () => String(extensionLifecycle?.generation ?? host.activationGeneration),
    hostedCode: config.hostedCode === true,
    sandboxTempScope,
    programAgentContext,
    programContextOf,
    recordFailedComposition,
    scheduleSandboxTempPrune,
    runCaptureStore: () => runCaptureStore,
  })

  /* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this block is the JSON/registry boundary for agent-authored artifacts: it validates untrusted stored JSON and then casts DSH registry values at the plugin seam (the same boundary tool_mode_run uses). */
  /**
   * AGENT-AUTHORED WORKFLOWS AND TOOLS.
   *
   * The research report's missing capability: an agent could RUN a Code Mode program but
   * could not NAME, SAVE, VERSION or RE-USE one, and could not define a new tool at all.
   * Two surfaces close that gap, gated by allowAgentAuthoring (default true):
   *
   * - tool_mode_workflows stores versioned programs that can be run again by name;
   * - tool_mode_tools stores persistent agent_* tools, registers each one immediately,
   *   and executes its stored program through the SAME confined runner tool_mode_run uses.
   *
   * SECURITY: the store is data, never authority. An authored program runs only through
   * runAuthoredProgram (the host's ProgramRunner), so the grant, the visibility policy,
   * the budgets, the sub-call trace and the CODE-09 exposure gate are unchanged. Storing an
   * artifact is allowed while the gate is closed; RUNNING or EXECUTING it is refused with
   * the actionable gate message.
   */
  sessionLedger = createSessionLedger({
    file: join(dirname(defaultAgentAuthoringFile(config.stateFile)), 'session-ledger.json'),
  })
  if (sessionLedger.issue !== undefined) {
    ctx.logger.warn('model-tools: session ledger: ' + sessionLedger.issue)
  }
  const NON_OFFERABLE_TOOLS = new Set([
    'tool_mode_list', 'tool_mode_describe', 'tool_mode_workflows', 'tool_mode_tools', 'model_tools',
  ])
  repetitionTracker = config.adoption?.saveOffer === true
    ? createRepetitionTracker({ threshold: config.adoption.maxRepeats ?? 3 })
    : undefined
  ctx.on('tools/post-execute' as never, (async (
    exec: { agent?: unknown; name: string; arguments?: unknown },
    _result: unknown,
    next: () => Promise<unknown>,
  ) => {
    const sessionId = sessionIdOfAgent(exec.agent)
    if (sessionId !== undefined && sessionId.length > 0) {
      sessionLedger?.called(sessionId, exec.name)
    }
    const result = await next()
    if (repetitionTracker !== undefined
      && sessionId !== undefined
      && sessionId.length > 0
      && !NON_OFFERABLE_TOOLS.has(exec.name)) {
      const value = (result as { value?: unknown } | undefined)?.value
      const runId = typeof value === 'object' && value !== null && typeof (value as { runId?: unknown }).runId === 'string'
        ? (value as { runId: string }).runId
        : undefined
      repetitionTracker.record({
        sessionId,
        toolName: exec.name,
        args: exec.arguments,
        ...runId === undefined ? {} : { runId },
      })
    }
    return result
  }) as never)

  if (config.captureRunPrograms === true) {
    const captureFile = (config.runCaptureFile ?? '').length > 0
      ? config.runCaptureFile as string
      : join(dirname(defaultAgentAuthoringFile(config.stateFile)), 'run-captures.json')
    runCaptureStore = createRunCaptureStore({ file: captureFile })
    if (runCaptureStore.issue !== undefined) {
      ctx.logger.warn('model-tools: run capture: ' + runCaptureStore.issue)
    }
  }
  if (config.allowAgentAuthoring !== false) {
    /**
     * Scoping runtime facts. The config object always exists after Schemastery parsing,
     * but a hand-built test config can omit it; the fallback is exactly the disabled shape.
     */
    const scopeSettings = config.artifactScopes ?? {
      enabled: true,
      defaultScope: 'session' as const,
      workspaceRoot: 'auto',
      globalPromotion: 'human' as const,
      promoteMinUses: 2,
      expireSessionArtifacts: true,
    }
    const scopingEnabled = scopeSettings.enabled === true
    // Global promotion is an OPERATOR decision, never a model-supplied boolean.
    // The operator exports this in the host environment after a human approval;
    // a tool call cannot set it. Absent means no global promotion.
    const globalApprovalGranted = process.env['DSH_ARTIFACT_GLOBAL_APPROVAL'] === '1'
    const authoringFile = (config.agentAuthoringFile ?? '').length > 0
      ? config.agentAuthoringFile as string
      : defaultAgentAuthoringFile(config.stateFile)
    const authoringStore = createAgentAuthoringStore({
      file: authoringFile,
      scopeEnabled: scopingEnabled,
    })
    if (authoringStore.issue !== undefined) {
      ctx.logger.warn('model-tools: agent authoring: ' + authoringStore.issue)
    }
    const artifactUsage = createArtifactUsageStore(join(dirname(authoringFile), 'artifact-usage.json'))
    const authoringLedger = createAuthoringLedger({
      file: join(dirname(authoringFile), 'authoring-receipts.json'),
    })
    if (authoringLedger.issue !== undefined) {
      ctx.logger.warn('model-tools: authoring ledger: ' + authoringLedger.issue)
    }
    // ctx.get() is the OPTIONAL service lookup: reading ctx.sessions directly
    // would require a Cordis injection declaration and break every mount that does
    // not load SessionStore (the authoring unit tests among them).
    const sessionsService = ctx.get('sessions' as never) as unknown as {
      get(id: string): { header?: { parentSession?: string; cwd?: string } } | undefined
    } | undefined
    const parentOfSession = (id: string): string | undefined => {
      const session = sessionsService?.get(id)
      const parent = session?.header?.parentSession
      return parent === undefined ? undefined : String(parent)
    }
    const cwdOfSession = (id: string): string => {
      const cwd = sessionsService?.get(id)?.header?.cwd
      return cwd !== undefined && cwd.length > 0 ? cwd : process.cwd()
    }
    /**
     * Resolve the caller's artifact scope. A session id is the LEAF id; the context
     * helper walks to the root so subagents share their parent's session artifacts.
     */
    const scopeFor = (exec: { agent?: unknown } | undefined, requested?: string): BuiltScopeContext => {
      const sessionId = sessionIdOfAgent(exec?.agent)
      if (!scopingEnabled && requested !== undefined && requested !== 'global') {
        throw new Error('E_SCOPE_DISABLED: artifactScopes.enabled is false, so only global scope is available '
          + '(requested "' + requested + '"; allowed: global)')
      }
      // A host caller with no session identity cannot hold session artifacts.
      // An IMPLICIT session default is downgraded to global but marked, so the
      // caller can see it did not get a private artifact. An EXPLICIT session
      // request refuses instead of silently writing somewhere else.
      const implicitSessionWithoutId = requested === undefined
        && (scopeSettings.defaultScope ?? 'session') === 'session'
        && sessionId === undefined
      if (requested === 'session' && sessionId === undefined) {
        throw new Error('E_SESSION_REQUIRED: session scope needs a session id; '
          + 'call from a session or choose workspace/global')
      }
      const effectiveScope = requested ?? (implicitSessionWithoutId ? 'global' : undefined)
      try {
        const built = buildScopeContext({
          config: { enabled: scopingEnabled, defaultScope: scopeSettings.defaultScope ?? 'session' },
          ...sessionId === undefined ? {} : { sessionId },
          ...effectiveScope === undefined ? {} : { requestedScope: effectiveScope },
          parentOf: parentOfSession,
          cwd: sessionId === undefined ? process.cwd() : cwdOfSession(sessionId),
          ...scopeSettings.workspaceRoot === 'auto' ? {} : { workspaceRoot: scopeSettings.workspaceRoot },
        })
        const requestedScope = (requested ?? scopeSettings.defaultScope ?? 'session') as BuiltScopeContext['scope']
        return {
          ...built,
          requestedScope,
          ...implicitSessionWithoutId ? { scopeReason: 'no-session-id' as const } : {},
        }
      } catch (error) {
        if (error instanceof ArtifactScopeError) throw new Error(error.code + ': ' + error.message)
        throw error
      }
    }
    /** The workspace-only context used to register durable rows at boot. */
    const workspaceScope = buildScopeContext({
      config: { enabled: true, defaultScope: 'workspace' },
      parentOf: () => undefined,
      cwd: process.cwd(),
      ...scopeSettings.workspaceRoot === 'auto' ? {} : { workspaceRoot: scopeSettings.workspaceRoot },
    })
    scopeForAuthoringCaller = scopeFor
    authoredToolVisibleAt = (name, scope) =>
      !authoredToolNames.has(name) || authoringStore.getTool(name, scope.context) !== undefined
    authoringReceipts = () => authoringLedger.list()
    /** Quality is published only once the evidence can support it. */
    const qualityOf = (evidence: { readonly uses: number; readonly sessions: number; readonly failures: number }) =>
      evidence.uses >= 5
        ? { uses: evidence.uses, sessions: evidence.sessions, failures: evidence.failures }
        : { insufficientEvidence: true as const }
    /** Turn a repetition shape into a runnable next command. */
    const suggestionFor = (candidate: {
      readonly id: string
      readonly toolName: string
      readonly calls: number
      readonly inputSchema: Record<string, unknown>
      readonly parameterPaths: readonly string[]
      readonly runId?: string
    }) => {
      const suffix = candidate.toolName.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
      const name = 'repeat_' + (suffix.length > 0 ? suffix : 'tool')
      const runId = candidate.runId
      return {
        id: candidate.id,
        toolName: candidate.toolName,
        calls: candidate.calls,
        artifactKind: 'workflow',
        name,
        callableName: workflowToolName(name),
        why: candidate.calls + ' calls with the same argument shape',
        parameterPaths: candidate.parameterPaths,
        inputSchema: candidate.inputSchema,
        ...runId === undefined ? {} : { runId },
        command: runId === undefined
          ? {
              tool: 'tool_mode_workflows',
              arguments: {
                action: 'save', name,
                program: 'return await ' + candidate.toolName + '(input)',
                tools: [candidate.toolName],
                inputSchema: candidate.inputSchema,
              },
            }
          : { tool: 'tool_mode_tools', arguments: { action: 'from-run', runId } },
      }
    }
    authoringSnapshot = (exec) => {
      const scope = scopeFor(exec)
      const root = scope.rootSessionId
      const pending = root === undefined
        ? []
        : [
            ...authoringStore.sessionWorkflows(root).map(workflow => {
              const evidence = artifactUsage.evidence(workflow.name, workflow.digest)
              return { artifactKind: 'workflow', name: workflow.name, scope: 'session', ...evidence, eligibleFor: ['workspace'] }
            }),
            ...authoringStore.sessionTools(root).map(tool => {
              const evidence = artifactUsage.evidence(tool.name, tool.digest)
              return { artifactKind: 'tool', name: tool.name, scope: 'session', ...evidence, eligibleFor: ['workspace'] }
            }),
          ]
      return {
        tools: authoringStore.listTools(scope.context).map(tool => {
          const evidence = artifactUsage.evidence(tool.name, tool.digest)
          return { ...tool, ...evidence, quality: qualityOf(evidence) }
        }),
        workflows: authoringStore.listWorkflows(scope.context).map(workflow => {
          const evidence = artifactUsage.evidence(workflow.name, workflow.digest)
          return { ...workflow, ...evidence, quality: qualityOf(evidence) }
        }),
        recent: authoringLedger.list().slice(-20),
        ...repetitionTracker === undefined ? {} : {
          suggestions: (scope.rootSessionId ?? sessionIdOfAgent(exec.agent)) === undefined
            ? []
            : repetitionTracker.suggestions((scope.rootSessionId ?? sessionIdOfAgent(exec.agent)) as string).map(suggestionFor),
        },
        repeatedShapes: findRepeatedShapes(invocationReceipts),
        scope: {
          enabled: scopingEnabled,
          defaultScope: scopeSettings.defaultScope ?? 'session',
          workspaceRoot: scopeSettings.workspaceRoot ?? 'auto',
          ...scope.scopeReason === undefined ? {} : { reason: scope.scopeReason },
        },
        pending,
          runCapture: captureDisclosure({
          captureRunPrograms: config.captureRunPrograms !== false,
          ...config.runCaptureFile === undefined ? {} : { runCaptureFile: config.runCaptureFile },
        }),
      }
    }
    if (config.adoption?.digest === true && promptService !== undefined) {
      const order = promptService.getSectionOrder('MCP_SERVERS') + 101
      ctx.effect(() => promptService.section({
        name: 'tool-mode:library',
        order,
        text: () => {
          const rows = [
            ...authoringStore.listWorkflows(workspaceScope.context).map(workflow => {
              const evidence = artifactUsage.evidence(workflow.name, workflow.digest)
              return {
                name: workflow.name,
                callableName: workflow.callableName,
                description: workflow.description,
                ...evidence,
              }
            }),
            ...authoringStore.listTools(workspaceScope.context).map(tool => {
              const evidence = artifactUsage.evidence(tool.name, tool.digest)
              return {
                name: tool.name,
                callableName: tool.callableName,
                description: tool.description,
                ...evidence,
              }
            }),
          ]
          return buildLibraryDigest(rows)
        },
      }), 'tool-mode library digest')
    }
    // Root-session end: receive the expired rows BEFORE deleting so the evidence
    // can be attached to the expire receipt. A crash cannot emit this event; the
    // docs state that unreceipted session rows are lost on a crash, by design.
    ctx.on('session/disposed' as never, ((session: { header?: { id?: unknown; parentSession?: unknown } }) => {
      if (!scopingEnabled || scopeSettings.expireSessionArtifacts === false) return
      const id = session.header?.id
      if (id === undefined || session.header?.parentSession !== undefined) return
      const root = String(id)
      const expired = authoringStore.expireSession(root)
      for (const workflow of expired.workflows) {
        const evidence = artifactUsage.evidence(workflow.name, workflow.digest)
        authoringLedger.record({
          operation: 'expire', artifactKind: 'workflow', name: workflow.name, version: workflow.version,
          scope: 'session', uses: evidence.uses, sessions: evidence.sessions,
        })
      }
      for (const tool of expired.tools) {
        const evidence = artifactUsage.evidence(tool.name, tool.digest)
        authoringLedger.record({
          operation: 'expire', artifactKind: 'tool', name: tool.name, version: tool.version,
          scope: 'session', uses: evidence.uses, sessions: evidence.sessions,
        })
      }
    }) as never)
    /** The LIVE catalog revision, the same fact tool_mode_run reports (CODE-05). */
    const authoringRevision = (): string => String(extensionLifecycle?.generation ?? host.activationGeneration)
    /**
     * Record one nested receipt per traced sub-call, then the composition receipt (OBS-01).
     * A composed authored run is provenance twice over: the calls it made, and the run.
     */
    const recordAuthoredRun = (
      receiptId: string,
      revision: string,
      contract: string,
      report: RunReport,
      artifact?: { name: string; digest: string; scope: ArtifactScope; sessionId?: string },
    ): void => {
      for (const call of report.meta.calls) {
        host.recordReceipt?.(buildInvocationReceipt({
          receiptId: host.nextReceiptId(),
          contract: 'nested:' + call.name,
          contractVersion: '1.0.0',
          implementationId: call.name,
          extension: host.extension,
          extensionVersion: host.extensionVersion,
          activationGeneration: Number(revision),
          executionLocation: 'host',
          modelIdentity: 'none',
          kind: 'nested',
          parentReceiptId: receiptId,
          runId: receiptId,
          ...call.callId === undefined ? {} : { callId: call.callId },
          outcome: call.ok ? 'ok' : 'failed',
        }))
      }
      if (artifact !== undefined) {
        artifactUsage.record({
          receiptId,
          name: artifact.name,
          digest: artifact.digest,
          ...artifact.sessionId === undefined ? {} : { sessionId: artifact.sessionId },
          outcome: 'ok',
        })
      }
      host.recordReceipt?.(buildInvocationReceipt({
        receiptId,
        contract,
        contractVersion: HOST_VERSION,
        implementationId: 'hosted-composition',
        extension: host.extension,
        extensionVersion: host.extensionVersion,
        activationGeneration: Number(revision),
        executionLocation: 'host',
        modelIdentity: 'none',
        // The composition is its own run, and runAuthoredProgram resolved: the work ran.
        runId: receiptId,
        parentReceiptId: null,
        dataFlow: report.meta.dataFlow,
        dataFlowCoverage: report.meta.dataFlowCoverage,
        outcome: 'ok',
        ...artifact === undefined ? {} : {
          ...artifact.sessionId === undefined ? {} : { sessionId: artifact.sessionId, rootSessionId: artifact.sessionId },
          artifactScope: artifact.scope,
          artifactName: artifact.name,
          artifactDigest: artifact.digest,
        },
      }))
    }

    /**
     * Register one saved workflow as a callable tool.
     *
     * This is what makes a workflow composable: a later program can list
     * `workflow_<name>` in its binding subset and call it like any other tool.
     * The AsyncLocalStorage stack refuses direct or indirect recursion instead of
     * letting a cycle run until the runner's budget stops it.
     */
    const registerWorkflow = (workflow: AgentWorkflow): boolean => {
      const toolName = workflowToolName(workflow.name)
      // A name is registered ONCE even when several scopes hold it: the published
      // tool resolves the caller's scope at call time. Re-registering would churn
      // the registry and break a program that already holds the binding.
      if (workflowDisposers.has(toolName)) return true
      if (ctx.tools.schemas().some(schema => schema.name === toolName)) {
        ctx.logger.warn('model-tools: workflow ' + workflow.name + ' was not registered: a tool with that name already exists')
        return false
      }
      let parameters: ParameterSchemaSpec
      try {
        compileSchema(workflow.inputSchema)
        parameters = toDshParameters(agentToolContract({
          name: toolName,
          description: workflow.description,
          inputSchema: workflow.inputSchema,
        })) as unknown as ParameterSchemaSpec
      } catch (error) {
        ctx.logger.warn('model-tools: workflow ' + workflow.name + ' has an unprojectable schema: '
          + (error instanceof Error ? error.message : String(error)))
        return false
      }
      try {
        const dispose = ctx.tools.register(defineTool({
          name: toolName,
          description: workflow.description,
          parameters,
          output: {
            schema: { type: 'json' } as unknown as ValueSchemaSpec,
            render: (_args: Record<string, unknown>, value: unknown) => [
              { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
            ],
          },
          async execute(args, exec) {
            const scope = scopeFor(exec)
            const resolved = authoringStore.getWorkflow(workflow.name, scope.context) ?? workflow
            const active = workflowCallStack.getStore() ?? new Set<string>()
            if (active.has(resolved.name)) {
              throw new Error('workflow recursion refused: ' + resolved.name + ' is already on this call stack')
            }
            return workflowCallStack.run(new Set([...active, resolved.name]), async () => {
              // The published schema is the registration baseline; the resolved
              // row may be a different version at another scope, so validate
              // against the program that will actually run.
              assertAgainstSchema(toolName, compileSchema(resolved.inputSchema), args)
              const receiptId = host.nextReceiptId()
              const revision = authoringRevision()
              const started = Date.now()
              let report: RunReport
              try {
                report = await sandboxTempScope.run(() => programAgentContext.run(
                  programContextOf(exec),
                  () => runAuthoredProgram({
                    program: resolved.program,
                    tools: resolved.tools,
                    input: args as JsonValue,
                    runner: programRunner,
                    receiptId,
                    catalogRevision: revision,
                  }),
                ))
                scheduleSandboxTempPrune()
              } catch (error) {
                authoringLedger.record({
                  operation: 'run', artifactKind: 'workflow', name: resolved.name, version: resolved.version,
                  outcome: 'failed', durationMs: Date.now() - started,
                })
                recordFailedComposition(receiptId, revision, 'workflow.' + resolved.name)
                throw error
              }
              authoringLedger.record({
                operation: 'run', artifactKind: 'workflow', name: resolved.name, version: resolved.version,
                durationMs: Date.now() - started,
              })
              recordAuthoredRun(receiptId, revision, 'workflow.' + resolved.name, report, {
                name: resolved.name,
                digest: resolved.digest,
                scope: resolved.scope,
                ...scope.rootSessionId === undefined ? {} : { sessionId: scope.rootSessionId },
              })
              return (report.result ?? null) as never
            })
          },
        }))
        workflowDisposers.set(toolName, dispose)
        workflowToolNames.add(toolName)
        return true
      } catch (error) {
        ctx.logger.warn('model-tools: workflow ' + workflow.name + ' was not registered: '
          + (error instanceof Error ? error.message : String(error)))
        return false
      }
    }
    {
      const bootNames = new Set<string>()
      for (const workflow of authoringStore.workflowEntries()) {
        if (bootNames.has(workflow.name)) continue
        bootNames.add(workflow.name)
        registerWorkflow(workflow)
      }
      if (scopingEnabled) {
        for (const workflow of authoringStore.workflowEntries(workspaceScope.context)) {
          if (bootNames.has(workflow.name)) continue
          bootNames.add(workflow.name)
          registerWorkflow(workflow)
        }
      }
    }
    ctx.effect(() => () => {
      for (const dispose of workflowDisposers.values()) dispose()
      workflowDisposers.clear()
      workflowToolNames.clear()
    }, 'workflow tools teardown')

    /** The registered authored tools, so delete and teardown unregister exactly one each. */
    const authoredDisposers = new Map<string, () => void>()
    /**
     * Register one stored authored tool.
     *
     * NEVER throws: boot registration must skip a name that is now taken (or a definition
     * the registry cannot project) with a logged reason rather than crash the plugin. The
     * same helper serves define, so the two registration paths cannot drift.
     */
    const registerAuthored = (definition: AgentToolDefinition): boolean => {
      if (authoredToolNames.has(definition.name)) return true
      if (ctx.tools.schemas().some(schema => schema.name === definition.name)) {
        ctx.logger.warn(
          'model-tools: authored tool ' + definition.name + ' was not registered: a tool with that name already exists',
        )
        return false
      }
      let parameters: ParameterSchemaSpec
      try {
        // A malformed baseline schema still fails at registration. The resolved row is
        // compiled again at call time because another scope may shadow the baseline.
        compileSchema(definition.inputSchema)
        parameters = toDshParameters(agentToolContract(definition)) as unknown as ParameterSchemaSpec
      } catch (error) {
        ctx.logger.warn(
          'model-tools: authored tool ' + definition.name + ' was not registered: '
          + (error instanceof Error ? error.message : String(error)),
        )
        return false
      }
      try {
        const dispose = ctx.tools.register(defineTool({
          name: definition.name,
          description: definition.description,
          parameters,
          output: {
            // The authored contract accepts any JSON root: a program returns its value
            // (object, string, number, array), never a serialized document, so a
            // composed step receives it directly instead of parsing it back out of text.
            schema: { type: 'json' } as unknown as ValueSchemaSpec,
            render: (_args: Record<string, unknown>, value: unknown) => [
              { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
            ],
          },
          async execute(args, exec) {
            const scope = scopeFor(exec)
            const resolved = authoringStore.getTool(definition.name, scope.context)
            if (resolved === undefined) {
              throw new Error('authored tool "' + definition.name + '" is not available in this scope')
            }
            // The DSH parameters are deliberately LOOSER than the authored schema (the
            // projection drops keywords it cannot advertise); enforce the resolved full one
            // so a dropped constraint is never silently unenforced (BASE-04).
            assertAgainstSchema(resolved.name, compileSchema(resolved.inputSchema), args)
            const started = Date.now()
            const receiptId = host.nextReceiptId()
            const revision = authoringRevision()
            let report: RunReport
            try {
              report = await sandboxTempScope.run(() => programAgentContext.run(
                programContextOf(exec),
                () => runAuthoredProgram({
                  program: resolved.program,
                  tools: resolved.tools,
                  input: args as JsonValue,
                  runner: programRunner,
                  receiptId,
                  catalogRevision: revision,
                }),
              ))
              scheduleSandboxTempPrune()
            } catch (error) {
              authoringLedger.record({
                operation: 'run', artifactKind: 'tool', name: resolved.name, version: resolved.version,
                outcome: 'failed', durationMs: Date.now() - started,
              })
              recordFailedComposition(receiptId, revision, resolved.name)
              throw error
            }
            authoringLedger.record({
              operation: 'run', artifactKind: 'tool', name: resolved.name, version: resolved.version,
              durationMs: Date.now() - started,
            })
            recordAuthoredRun(receiptId, revision, resolved.name, report, {
              name: resolved.name,
              digest: resolved.digest,
              scope: resolved.scope,
              ...scope.rootSessionId === undefined ? {} : { sessionId: scope.rootSessionId },
            })
            // The stored program's value, STRUCTURED: a composed step can read its
            // fields without parsing a JSON document first.
            return (report.result ?? null) as never
          },
        }))
        authoredToolNames.add(definition.name)
        // task-57: an authored tool publishes through the SAME discovery map, so a consumer
        // can pin `agent.<name>`@1.0.0 exactly as it pins a contract-backed tool. Both the
        // define path and the boot re-registration go through this helper, so they cannot
        // report different contracts for the same tool.
        toolContracts.set(definition.name, { contract: `agent.${definition.name}`, contractVersion: '1.0.0' })
        authoredDisposers.set(definition.name, dispose)
        return true
      } catch (error) {
        ctx.logger.warn(
          'model-tools: authored tool ' + definition.name + ' was not registered: '
          + (error instanceof Error ? error.message : String(error)),
        )
        return false
      }
    }
    /** Unregister one authored tool; false when no registration exists. */
    const unregisterAuthored = (name: string): boolean => {
      const dispose = authoredDisposers.get(name)
      if (dispose === undefined) return false
      dispose()
      authoredDisposers.delete(name)
      authoredToolNames.delete(name)
      toolContracts.delete(name)
      return true
    }
    // BOOT: every stored authored tool is registered again, after the built-in tools, so a
    // restart is a continuation rather than a loss. Each entry is validated on load.
    {
      const bootNames = new Set<string>()
      for (const definition of authoringStore.toolEntries()) {
        if (bootNames.has(definition.name)) continue
        bootNames.add(definition.name)
        registerAuthored(definition)
      }
      if (scopingEnabled) {
        for (const definition of authoringStore.toolEntries(workspaceScope.context)) {
          if (bootNames.has(definition.name)) continue
          bootNames.add(definition.name)
          registerAuthored(definition)
        }
      }
    }
    ctx.effect(() => () => {
      for (const dispose of authoredDisposers.values()) dispose()
      authoredDisposers.clear()
      authoredToolNames.clear()
    }, 'agent-authored tools teardown')

    registerAuthoringTools({
      ctx,
      store: authoringStore,
      ledger: authoringLedger,
      scopeFor,
      sessionIdOfAgent,
      sessionLedger: () => sessionLedger,
      registerWorkflow,
      registerAuthored,
      unregisterAuthored,
      workflowDisposers,
      workflowToolNames,
      authoredToolNames,
      authoringRevision,
      evidenceFor: (name, digest) => artifactUsage.evidence(name, digest),
      recordArtifactFailure: input => artifactUsage.record({ ...input, outcome: 'failed' }),
      scopeSettings,
      globalApprovalGranted,
      sandboxTempScope,
      scheduleSandboxTempPrune,
      programAgentContext,
      programContextOf,
      programRunner,
      recordAuthoredRun,
      host,
      runCaptureStore,
    })
  }

  /* oxlint-enable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */
  /*
   * "Jev makes judgments, code makes decisions" (TypeSafe, 2026-11-03): this
   * pure tool composes caller-supplied atomic judgments and code facts through
   * explicit first-match rules and returns the full evaluated trace. It calls no
   * model; an agent uses it after asking one judgment per model question.
   */
  /**
   * THE HOST-AUTHORED ENVELOPE for a pure host tool (task-54).
   *
   * `decision_*` are model-facing: an agent reads their result directly, so it needs the same
   * provenance a contract-backed tool carries. The fields are the ones `buildMeta` stamps,
   * with `implementationId: 'host'` because the host IS the implementation here — no model,
   * no extension. This is a HOST tool's provenance, never provider output (EXT-17).
   * @param contract - the contract id this tool implements.
   * @param contractVersion - the contract's semantic version.
   * @returns the envelope.
   */
  const hostCreatedMeta = (contract: string, contractVersion: string): ToolMeta => ({
    contract,
    contractVersion,
    implementationId: 'host',
    extension: host.extension,
    extensionVersion: host.extensionVersion,
    activationGeneration: host.activationGeneration,
    executionLocation: 'host',
    receiptId: host.nextReceiptId(),
    modelIdentity: 'host',
    warnings: [],
  })

  ctx.tools.register(defineTool({
    name: 'decision_combine',
    description:
      'Combine code-computed facts and model judgment probabilities through explicit first-match policy rules. '
      + 'Returns the exit plus every rule and condition examined. It calls no model: use atomic judgment tools '
      + 'first, then let code make the decision and keep the trace.',
    parameters: {
      facts: { type: 'json', required: true, description: 'Code-computed facts (booleans/numbers/strings).' },
      judgments: { type: 'json', required: true, description: 'Atomic model probabilities keyed by judgment name, each in [0,1].' },
      rules: { type: 'json', required: true, description: 'First-match rules: {id, when:[{source,key,op,value?}], exit}.' },
      fallback: { type: 'string', description: 'Exit when no rule matches; required by the implementation.' },
    } as unknown as ParameterSchemaSpec,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exit: { type: 'string' },
          fallback: { type: 'boolean' },
          trace: { type: 'array' },
          meta: { type: 'json', required: true },
        },
      } as unknown as ValueSchemaSpec,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const input = args as { facts?: unknown; judgments?: unknown; rules?: unknown; fallback?: unknown }
      const result = combineDecision(input.facts, input.judgments, input.rules, typeof input.fallback === 'string' ? input.fallback : '')
      return { ...result, meta: hostCreatedMeta('decision.combine', DECISION_COMBINE_CONTRACT.version) } as never
    },
  }))

  /*
   * Hightouch's identity-resolution study (2026-11-04) found that a calibrated
   * cheap judge should escalate only its uncertain band, and that a fixed 50%
   * cutoff is arbitrary. These two pure tools make that policy explicit:
   * route a probability (optionally with a secondary judge), and evaluate a
   * labeled set with accuracy/FPR/FNR/Brier/ECE plus a hybrid arm.
   */
  ctx.tools.register(defineTool({
    name: 'decision_route',
    description:
      'Route a primary judgment probability into accept-true, reject-false, or escalate to a stronger judge. '
      + 'Defaults 0.9/0.1 are illustrative, not calibrated for our models; pass reviewed thresholds.',
    parameters: {
      probability: { type: 'number', required: true, description: 'Primary judge P(condition is true), in [0,1].' },
      acceptAt: { type: 'number', description: 'At or above this, accept true (default 0.9).' },
      rejectAt: { type: 'number', description: 'At or below this, accept false (default 0.1).' },
    } as unknown as ParameterSchemaSpec,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          route: { type: 'string', enum: ['accept', 'reject', 'escalate'] },
          decision: { type: 'json' },
          band: { type: 'string', enum: ['high', 'middle', 'low'] },
          reason: { type: 'string' },
          meta: { type: 'json', required: true },
        },
      } as unknown as ValueSchemaSpec,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const input = args as { probability?: unknown; acceptAt?: unknown; rejectAt?: unknown }
      const result = routeConfidence(
        input.probability as number,
        typeof input.acceptAt === 'number' ? input.acceptAt : undefined,
        typeof input.rejectAt === 'number' ? input.rejectAt : undefined,
      )
      return { ...result, meta: hostCreatedMeta('decision.route', DECISION_ROUTE_CONTRACT.version) } as never
    },
  }))

  ctx.tools.register(defineTool({
    name: 'decision_evaluate',
    description:
      'Evaluate labeled decisions: accuracy, confusion rates, Brier score, calibration bins, the best observed threshold, '
      + 'and an optional escalation arm using rejectAt/acceptAt and the secondary probability.',
    parameters: {
      cases: { type: 'json', required: true, description: 'Array of {expected:boolean, probability, escalatedProbability?, costUsd?, latencyMs?}.' },
      threshold: { type: 'number', description: 'Primary cutoff in [0,1]; default 0.5.' },
      escalation: { type: 'json', description: 'Optional {rejectAt, acceptAt} hybrid band.' },
    } as unknown as ParameterSchemaSpec,
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: { meta: { type: 'json', required: true } },
      } as unknown as ValueSchemaSpec,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const input = args as { cases?: unknown; threshold?: unknown; escalation?: unknown }
      const escalation = typeof input.escalation === 'object' && input.escalation !== null
        ? input.escalation as { rejectAt: number; acceptAt: number }
        : undefined
      const result = evaluateDecisions(input.cases, typeof input.threshold === 'number' ? input.threshold : 0.5, escalation)
      return { ...result, meta: hostCreatedMeta('decision.evaluate', DECISION_EVALUATE_CONTRACT.version) } as never
    },
  }))

  /*
   * TOOL-02 / DEC-07: the optional remote Jev choice tool. This is a typed
   * question service, not a chat completion: the request is Jev's native
   * choice shape and the response is converted by the versioned adapter. The
   * tool exists only when the operator enabled it, so no default inventory or
   * external surface changes.
   */
  if (config.jev?.enabled === true) {
    ctx.tools.register(defineTool({
      name: 'decision_choose_jev',
      description:
        'Choose one of 2–16 options through the remote Jev (TypeSafe System One) typed-question API on '
        + 'the standard decision.choose contract. The confidence is the provider\'s UNCALIBRATED value.',
      parameters: {
        decision: { type: 'string', required: true, description: 'The decision to make.' },
        options: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description: 'The mutually exclusive options; the answer is an index into this list.',
        },
      } as unknown as ParameterSchemaSpec,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            chosen: { type: 'integer' },
            confidence: { type: 'string', enum: ['confident', 'likely', 'tentative'] },
            reason: { type: 'string' },
          },
        } as unknown as ValueSchemaSpec,
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const input = args as { decision?: unknown; options?: unknown }
        if (typeof input.decision !== 'string' || input.decision.trim().length === 0) {
          throw new Error('JEV_INVALID_INPUT: `decision` must be a non-empty string')
        }
        if (
          !Array.isArray(input.options)
          || input.options.length < 2
          || input.options.length > 16
          || input.options.some(option => typeof option !== 'string' || option.trim().length === 0)
        ) {
          throw new Error('JEV_INVALID_INPUT: `options` must be 2–16 non-empty strings')
        }
        const options = input.options as string[]
        const configured = config.jev
        let apiKey = configured?.apiKey?.trim()
        if ((apiKey === undefined || apiKey.length === 0) && credentialSeam !== undefined) {
          apiKey = (await credentialSeam.resolve(configured?.credentialRef ?? 'jev/api-key'))?.value?.trim()
        }
        if (apiKey === undefined || apiKey.length === 0) {
          apiKey = process.env[configured?.apiKeyEnv ?? 'TYPESAFE_API_KEY']?.trim()
        }
        if (apiKey === undefined || apiKey.length === 0) {
          throw new Error(
            'JEV_API_KEY_NOT_CONFIGURED: add a Jev API key through `jev.apiKey`, the DSH credentials '
            + `service (${configured?.credentialRef ?? 'jev/api-key'}), or the ${configured?.apiKeyEnv ?? 'TYPESAFE_API_KEY'} environment variable`,
          )
        }
        try {
          const result = await chooseWithJev(input.decision, options, {
            apiKey,
            ...configured?.baseURL === undefined ? {} : { baseURL: configured.baseURL },
            ...configured?.model === undefined ? {} : { model: configured.model },
          })
          return result as never
        } catch (error) {
          if (error instanceof JevError) throw new Error(`${error.code.toUpperCase()}: ${error.message}`)
          throw error
        }
      },
    }))

    /*
     * The multi-question form: independent atomic judgments in ONE native
     * request, so code can combine them without one request per judgment.
     */
    ctx.tools.register(defineTool({
      name: 'decision_judgments_jev',
      description:
        'Ask 1–16 independent atomic questions through the remote Jev API in one native request. '
        + 'Boolean questions return a probability in [0,1]; choice questions return the chosen criterion, its '
        + 'probability map and confidence. The judgments are independent; combine them in code with decision_combine.',
      parameters: {
        state: { type: 'json', required: true, description: 'The same state for every question (text or JSON).' },
        questions: {
          type: 'json',
          required: true,
          description: 'Array of {id, type:"boolean", proposition} or {id, type:"choice", instructions, criteria:{id:description}}.',
        },
      } as unknown as ParameterSchemaSpec,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            model: { type: 'string' },
            judgments: { type: 'json' },
          },
        } as unknown as ValueSchemaSpec,
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const input = args as { state?: unknown; questions?: unknown }
        if (!Array.isArray(input.questions)) throw new Error('JEV_INVALID_INPUT: `questions` must be an array')
        const configured = config.jev
        let apiKey = configured?.apiKey?.trim()
        if ((apiKey === undefined || apiKey.length === 0) && credentialSeam !== undefined) {
          apiKey = (await credentialSeam.resolve(configured?.credentialRef ?? 'jev/api-key'))?.value?.trim()
        }
        if (apiKey === undefined || apiKey.length === 0) {
          apiKey = process.env[configured?.apiKeyEnv ?? 'TYPESAFE_API_KEY']?.trim()
        }
        if (apiKey === undefined || apiKey.length === 0) {
          throw new Error(
            'JEV_API_KEY_NOT_CONFIGURED: add a Jev API key through `jev.apiKey`, the DSH credentials '
            + `service (${configured?.credentialRef ?? 'jev/api-key'}), or the ${configured?.apiKeyEnv ?? 'TYPESAFE_API_KEY'} environment variable`,
          )
        }
        try {
          const result = await judgeWithJev(input.state, input.questions as never, {
            apiKey,
            ...configured?.baseURL === undefined ? {} : { baseURL: configured.baseURL },
            ...configured?.model === undefined ? {} : { model: configured.model },
          })
          return result as never
        } catch (error) {
          if (error instanceof JevError) throw new Error(`${error.code.toUpperCase()}: ${error.message}`)
          throw error
        }
      },
    }))
  }

  /**
   * Mount the EXTENSION LIFECYCLE, which is what lets an extension's tools reach the
   * registry at all.
   *
   * This was MISSING: the SDK could install, activate and publish contributions and was
   * fully tested doing so, but the host never mounted the lifecycle — so an extension
   * could report `observedActivation: 'active'` with its tool listed and a caller still
   * could not invoke it. The registrar is the other half of that bridge.
   *
   * Opt-in through `extensionStore`, so a deployment with no extensions behaves exactly
   * as before. RUN-05 governs what happens here: startup RESTORES extensions the operator
   * already approved and reads their declarations. It performs NO model preparation and
   * NO package resolution, so nothing downloads because a plugin loaded.
   */
  if (extensionStoreDir.length > 0) {
    // TASK-117: the store is the HOISTED instance (constructed at the apply
    // top so the catalogue-install loop can probe extension tool ownership).
    const store = extensionStore as ExtensionStore

    /**
     * How dispatch reaches an ACTIVATED extension.
     *
     * The module is imported and the instance created ONCE per IDENTITY AND VERSION and
     * cached, because `create()` is documented as lightweight and repeating it per call
     * would re-run an extension's activation on every invocation. The version is part of
     * the key because an upgrade selects new bytes: a cache keyed by identity alone kept
     * serving the SUPERSEDED module after the operator activated a newer version, so the
     * new tools registered but every call reached the old implementation. PROVIDERS are
     * created per call inside `createDispatch`, so a deactivated extension is never served
     * from a stale provider handle.
     */
    const extensionInstances = new Map<string, Promise<{
      createProvider(request: { modelId: string; configuration: Readonly<Record<string, unknown>> }): Promise<unknown>
      dispose?(reason: string): Promise<void>
    }>>()
    /** Per-instance storage. See the note on storage below. */
    const memoryStorage = new Map<string, JsonValue>()

    /**
     * The host-issued context an extension receives.
     *
     * It carries NO DSH context, no registry access, no global credentials and no
     * unfiltered environment (ARCH-06) — an extension gets identity, private storage, a
     * bounded logger and a teardown signal, and nothing else.
     */
    function contextForExtension(extensionId: string): ExtensionContextV1 {
      const installed = selectedInstalled(extensionId)
      // EXT-35: bounded, host-policy-controlled extension logging.
      let logRecords = 0
      return {
        extensionId,
        extensionVersion: installed?.version ?? '0.0.0',
        activationGeneration: 1,
        /**
         * Storage is an IN-MEMORY map for the life of this instance, and that is stated
         * rather than implied: a full private on-disk store is separate work, and a stub
         * that LOOKS persistent while losing everything on restart would be worse than one
         * that visibly does not persist.
         */
        storage: {
          // The declared private directory, so an extension that writes files has a place
          // the HOST chose rather than one the extension invented for itself.
          directory: join(store.rootDir, 'extension-private', extensionId),
          async read(key: string) { return memoryStorage.get(`${extensionId}:${key}`) },
          async write(key: string, value: JsonValue) {
            memoryStorage.set(`${extensionId}:${key}`, value)
          },
        },
        logger: {
          log: (level, message) => {
            if (logRecords >= DEFAULT_LOG_POLICY.maxRecords) return
            if (!admitsLogRecord(DEFAULT_LOG_POLICY, { level })) return
            logRecords += 1
            if (level === 'error') ctx.logger.error(`[${extensionId}] ${message}`)
            else if (level === 'warn') ctx.logger.warn(`[${extensionId}] ${message}`)
            else ctx.logger.info(`[${extensionId}] ${message}`)
          },
        },
        signal: new AbortController().signal,
        configuration: {},
      }
    }
    function environmentFor(extensionId: string): DispatchEnvironment {
      /**
       * The installed package ROOT for an extension, from the store.
       *
       * Deliberately NOT named installPathFor: the SDK exports a function of that name
       * which returns the path SEGMENT a package occupies, not a resolved store lookup. Two
       * different meanings under one name is how a caller ends up with the wrong one.
       */
      const installedRootFor = (id: string): string => {
        const installed = selectedInstalled(id)
        if (installed === undefined) {
          throw new Error(`${id} is not installed, so its recipes cannot be resolved`)
        }
        return installed.installPath
      }
      const discoveryFor = () => {
        const installed = selectedInstalled(extensionId)
        if (installed === undefined) {
          throw new Error(`${extensionId} is not installed, so its tools cannot be dispatched`)
        }
        return discoverExtension(installed.installPath)
      }
      return {
        getManifest: () => discoveryFor().manifest as unknown as DispatchManifest,
        /**
         * The host-verified prepared-asset map for THIS extension, built by the
         * extensions-prepare flow; undefined (the empty map) until then.
         */
        assetsFor: () => prepareAssetsSurface?.assetMapFor(extensionId),
        async providerFor(modelId) {
          const discovery = discoveryFor()
          /**
           * A DECLARATIVE PACKAGE HAS NO MODULE, so it never reaches the import path.
           *
           * This branch did not exist, and its absence is why `PTCAuthority`-style
           * disconnection went unnoticed here for so long: a declarative manifest was
           * schema-valid, its recipe convention was implemented, and its broker had 132
           * passing tests — and NOTHING joined them, because this function assumed every
           * package could be imported. Resolving an entry for a no-code package fails with
           * "the package declares no importable ./tool-mode export", which is true and
           * useless: the package was never supposed to declare one.
           *
           * Recipes are resolved through the published convention instead, and a package
           * whose recipes do not resolve is refused BY NAME rather than by import failure.
           */
          const kind = (discovery.manifest as unknown as { execution?: { kind?: string } })
            .execution?.kind
          if (kind === 'declarative') {
            const resolved = resolveDeclarativeImplementations(
              installedRootFor(extensionId),
              (discovery.manifest as unknown as {
                implementations: readonly { id: string; contractId: string; recipeVersion: string }[]
              }).implementations ?? [],
            )
            if (!resolved.ok) {
              throw new Error(
                `${extensionId} is declarative but its recipe could not be resolved: `
                + `${resolved.id} — ${resolved.detail}`,
              )
            }
            /**
             * The recipes RESOLVE, and execution is refused honestly rather than faked.
             *
             * THIS MESSAGE WAS CORRECTED, and the correction matters. It used to say "the link
             * from the host to @try-works/tool-mode-recipes is not wired" — which was true when
             * written and is NO LONGER: `scripts/link-dsh.mjs` listed only four of eight
             * workspace packages, so the broker could not be imported by anything, and
             * completing that map made the bare specifier resolve. Leaving the old text would
             * have pointed the next reader at a link that now exists.
             *
             * What is genuinely missing is narrower, and it is a COMPOSITION rather than a
             * connection: a declarative package's behaviour is executed by a harness broker
             * fed by an `LlmProvider`, and this deployment supplies none. The recipes are real,
             * the broker is importable, and nothing can call a model.
             */
            /**
             * SERVED WHEN THE DEPLOYMENT SUPPLIES A PROVIDER, refused when it does not.
             *
             * The joining lives in `prepareDeclarative` so the host holds no model-specific code:
             * this branch hands over the deployment's provider and a journal sink, and receives
             * callable tools or an honest refusal. The journal is required by the BROKER itself,
             * which will not construct one that reports nothing (HLM-09).
             */
            const served = prepareDeclarative({
              ...harnessProvider === undefined ? {} : { provider: harnessProvider },
              ...config.harnessProfiles === undefined ? {} : { profiles: config.harnessProfiles },
              journal: record => recordAuxiliaryReceipt(record, extensionId, 'unknown'),
            }, resolved.resolved)

            if (!served.ok) {
              throw new Error(
                `${extensionId} is declarative and its ${resolved.resolved.length} recipe(s) resolved, `
                + `but they cannot be served: ${served.detail}`,
              )
            }
            /**
             * THE DISPATCH PROVIDER SHAPE, and the previous version of this branch did not have it.
             *
             * It returned `{ async createProvider() { return { async invoke() {} } } }` — an
             * INSTANCE, where `createDispatch` requires a `DispatchProvider`. Adversarial review
             * reproduced the consequence exactly: `dispatch.ok = true` and then
             * `TypeError: provider.load is not a function`. The module branch below has the right
             * shape and this one did not, so the two differed in a way no test could see because
             * `harnessProvider` appeared in no test at all.
             *
             * The contract is:
             *   load({ assets, signal })                        -> Promise<void>
             *   invoke({ implementationId, input, context })    -> Promise<Record<string, unknown>>
             *
             * AND `implementationId` IS USED. The previous version called `served.served[0]`
             * unconditionally, so the SECOND recipe of a two-recipe package could never be served
             * — it would silently answer with the first one's output. A package declaring two
             * implementations is the normal case, not an edge case.
             */
            return {
              async load() {
                // Recipes are already parsed, validated and authorized by `prepareDeclarative`.
                // There is no module to import and no asset to fetch, so loading is complete.
              },
              async invoke(request: {
                readonly implementationId: string
                readonly input: Readonly<Record<string, unknown>>
              }): Promise<Record<string, unknown>> {
                const recipe = served.served.find(entry => entry.implementationId === request.implementationId)
                // An unknown id is REFUSED rather than defaulted to the first recipe, which is the
                // silent-wrong-answer failure the previous version would have produced.
                if (recipe === undefined) {
                  throw new Error(
                    `${extensionId} declares no implementation ${JSON.stringify(request.implementationId)}`
                    + `; it serves: ${served.served.map(entry => entry.implementationId).join(', ')}`,
                  )
                }
                const text = await recipe.invoke(request.input)
                // The dispatch contract returns a RECORD, not a bare value.
                return { text } as Record<string, unknown>
              },
            } as never
          }

          /**
           * EXT-20, THE MANAGED HALF: when the deployment opted in, the extension's
           * module entry runs OUT OF PROCESS — one scrubbed-environment worker per
           * extension per activation generation, disposed when the generation advances.
           *
           * The GRANT and the schemas stay host-side: this branch only runs after the
           * caller passed authorization and the input passed the declared schema, and
           * the returned value is validated by the same output-schema path as the
           * in-process result. The worker receives exactly `{implementationId, input}`.
           */
          if (managedWorkers) {
            const entry = resolveExtensionEntry(discovery)
            const generation = activationGenerations.get(extensionId)
              ?? extensionLifecycle?.generation
              ?? host.activationGeneration
            return await workerRegistry.providerFor({
              extensionId,
              entryPath: entry,
              generation,
              envPassthrough: workerEnvPassthrough,
            })
          }

          const installedForInstance = selectedInstalled(extensionId)
          const instanceKey = `${extensionId}@${installedForInstance?.version ?? '0.0.0'}`
          let pending = extensionInstances.get(instanceKey)
          if (pending === undefined) {
            pending = (async () => {
              const module = await loadExtensionModule(resolveExtensionEntry(discovery))
              return module.create(contextForExtension(extensionId)) as never
            })()
            extensionInstances.set(instanceKey, pending)
          }
          const instance = await pending
          return instance.createProvider({ modelId, configuration: {} }) as never
        },
        // The manifest is resolved per call: a deactivated+reactivated extension's
        // discovery must be fresh, not a startup snapshot.
        // TASK-123: the invocation context carries the FULL host-granted surface
        // the SDK contract documents (InvocationContextV1): the invocation id,
        // the signal, the resource limits, and the path authority broker — the
        // SAME authority the catalogue/contract path builds, so an extension
        // that reads a caller-supplied file path asks the host exactly like the
        // catalogue adapter does. The broker is always present; a composition
        // without a grant fails with a NAMED error, never undefined.
        contextFor: (implementationId, signal) => {
          if (host.grant === undefined) {
            throw new Error('path access denied: the host has no configured grant, so the path authority broker is unavailable')
          }
          const authority = createInvocationAuthority(host.grant, host.callerKind)
          return {
            implementationId,
            signal,
            invocationId: `inv_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
            limits: authority.limits,
            resolvePath: (candidate: string): string => authority.resolvePath(candidate),
          }
        },
      }
    }

    /**
     * Stamp the reserved root `meta` envelope on an extension tool result (EXT-17, DECL-03).
     *
     * An extension's shipped output schema may REQUIRE `meta` — the Needle planning and
     * extraction contracts do, because the schema declares the field the HOST authors and
     * the provider must not (EXT-17 reserves it, `assertNoReservedMeta` rejects a provider
     * attempt). Without this stamp the host's own output validation would refuse every
     * successful call for such a tool. The stamp is only applied when the declared schema
     * requires it, so a tool whose schema has no envelope keeps returning exactly what its
     * provider produced.
     *
     * The receipt is recorded with the same envelope (EXT-35 symmetry with the
     * `tool_mode_run` path): a caller that wants provenance for a planning call can ask the
     * receipts action, and a receipt never appears only in the result object.
     * @param ownerExtension - the extension the tool belongs to.
     * @param toolName - the caller-facing name.
     * @param value - the provider's result.
     * @param warnings - non-fatal notes already free of caller content.
     * @returns the result with the host-authored `meta`.
     */
    const stampResultMeta = (
      ownerExtension: string,
      toolName: string,
      value: Record<string, unknown>,
      warnings: readonly string[] = [],
    ): Record<string, unknown> => {
      const resolved = resolveImplementation(environmentFor(ownerExtension).getManifest(), toolName)
      if (!resolved.ok) throw new Error(describeDispatchFailure(resolved.failure))
      const installed = selectedInstalled(ownerExtension)
      const receiptId = host.nextReceiptId()
      const activationGeneration = extensionLifecycle?.generation ?? host.activationGeneration
      const meta = {
        contract: resolved.tool.contractId,
        contractVersion: resolved.tool.contractVersion,
        implementationId: resolved.implementation.id,
        extension: ownerExtension,
        extensionVersion: installed?.version ?? '0.0.0',
        activationGeneration,
        executionLocation: 'device' as const,
        receiptId,
        warnings: [...warnings],
      }
      host.recordReceipt?.(buildInvocationReceipt({
        receiptId,
        contract: resolved.tool.contractId,
        contractVersion: resolved.tool.contractVersion,
        implementationId: resolved.implementation.id,
        extension: ownerExtension,
        extensionVersion: meta.extensionVersion,
        extensionContentDigest: installed?.contentDigest ?? null,
        dependencyLockDigest: installed?.dependencyLockDigest ?? null,
        modelIdentity: resolved.implementation.modelId,
        activationGeneration,
        executionLocation: meta.executionLocation,
        warnings,
        // meta is stamped only when the dispatch returned a value to the caller.
        outcome: 'ok',
      }))
      return { ...value, meta }
    }

    /**
     * Read the schemas an extension's manifest declares for one contributed tool.
     *
     * Bounded and confined: the manifest validator already proved the referenced files
     * exist inside the package, and the byte cap keeps a hostile package from making
     * registration read an unbounded file. A DECLARED schema the host cannot read or
     * compile REFUSES the tool (P26-13): publishing it unenforced would advertise
     * constraints that are enforced nowhere. The throw reaches the lifecycle, whose
     * narrow rollback withdraws only this extension's handles and quarantines it with
     * the reason named, so other extensions are untouched.
     * @param tool - the contributed tool whose schemas are wanted.
     * @returns the declared input/output schemas and description.
     */
    const readDeclaredToolSchemas = (tool: RegistrableTool): {
      inputSchema?: Readonly<Record<string, unknown>>
      outputSchema?: Readonly<Record<string, unknown>>
      description?: string
    } => {
      const record = selectedInstalled(tool.ownerExtension)
      if (record === undefined) return {}
      let discovery: ReturnType<typeof discoverExtension>
      try {
        discovery = discoverExtension(record.installPath)
      } catch (error) {
        /**
         * TASK-128: a discovery failure must NOT masquerade as "no schemas
         * declared". The old `return {}` here turned an unreadable package
         * (a moved store, a stale lock path) into the NDL-02 refusal "must
         * declare the planning input shape" — blaming the schema for a
         * package the host could not even read. The real reason is surfaced
         * instead: the narrow rollback quarantines with THIS message.
         */
        throw new Error(
          `${tool.name}'s package cannot be read at ${record.installPath}: `
          + `${error instanceof Error ? error.message : String(error)}. `
          + 'Reinstall or repair the package; the tool is not published.',
        )
      }
      const declared = discovery.manifest.tools.find(candidate => candidate.name === tool.name)
      if (declared === undefined) return {}
      const readSchema = (relative: string): Readonly<Record<string, unknown>> => {
        // A MANIFEST-DECLARED schema the host cannot read or compile is a broken
        // package, and the tool is REFUSED rather than published with the declared
        // constraints enforced nowhere (P26-13: reject unsupported constraints, do
        // not silently strip them). The throw reaches the lifecycle, whose narrow
        // rollback withdraws this extension's published handles and quarantines it
        // with the reason named.
        try {
          const path = join(record.installPath, relative)
          const size = statSync(path).size
          if (size > MAX_SCHEMA_BYTES) {
            throw new Error(`the declared schema is ${size} bytes, over the ${MAX_SCHEMA_BYTES} cap`)
          }
          const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('the declared schema is not a JSON object')
          }
          return parsed as Readonly<Record<string, unknown>>
        } catch (error) {
          throw new Error(
            `${tool.name} declares ${relative} which cannot be enforced: `
            + `${error instanceof Error ? error.message : String(error)}. `
            + 'Fix or replace the package; the tool is not published.',
          )
        }
      }
      const inputSchema = readSchema(declared.inputSchema)
      const outputSchema = readSchema(declared.outputSchema)
      return {
        ...inputSchema === undefined ? {} : { inputSchema },
        ...outputSchema === undefined ? {} : { outputSchema },
        description: declared.description,
      }
    }
    /**
     * The host's own name → owning-extension map for CONTRIBUTED tools.
     *
     * The registry's `schemas()` projection exposes names only, so the planning re-check
     * (NDL-03) cannot ask `lifecycle.admits(extensionId, toolName)` without knowing WHICH
     * extension owns a proposed tool. This map is that knowledge, maintained at the same
     * boundary that publishes and withdraws the tool — a tool present here but not
     * admitted is deactivated or quarantined, which is exactly the state a fresh policy
     * check must refuse.
     */
    const extensionToolOwners = new Map<string, string>()
    // Seed the LIVE admission set the management service also maintains; the
    // registrar holds the same Set, not a snapshot, so a runtime enable publishes.
    for (const entry of store.readProfileState('default').value) {
      if (entry.desiredActivation === 'active') activatedExtensions.add(entry.extensionId)
    }
    /**
     * P1b: the declared skill guidance that applies to one contributed tool.
     *
     * A manifest skill names the tools it needs; the matching skill's description is
     * the when-to-use line for that tool's composed description. Absent guidance is
     * not an error: the manifest tool description then stands alone.
     */
    const extensionSkillGuidance = (
      extensionId: string,
      toolName: string,
    ): { readonly name: string; readonly description: string } | undefined => {
      let manifest
      try {
        const record = selectedInstalled(extensionId)
        if (record === undefined) return undefined
        manifest = discoverExtension(record.installPath).manifest
      } catch {
        return undefined
      }
      const skills = manifest.skills
      if (!Array.isArray(skills)) return undefined
      const skill = skills.find(candidate => {
        const required = candidate.requiresTools
        // An absent or empty requirement list is setup guidance: no restriction.
        if (required === undefined || required.length === 0) return true
        /**
         * requiresTools holds MANIFEST TOOL IDS, not caller-facing names. The SDK
         * lifecycle resolves each id through manifest.tools before gating; resolve
         * them the same way here, and fall back to the raw id when it is unknown.
         */
        return required.some((id: string) => {
          const declared = manifest.tools.find(tool => tool.id === id)
          return (declared?.name ?? id) === toolName
        })
      })
      return skill === undefined ? undefined : { name: skill.name, description: skill.description }
    }

    const registrar = createContributionRegistrar({
      activated: activatedExtensions,
      registry: {
        registerTool: tool => {
          /**
           * The tool is registered through the SAME DSH registry a native tool uses, so an
           * extension contribution is subject to the same pipeline rather than a parallel
           * one (ARCH-05).
           *
           * Its `execute` walks the REAL chain: the TMX runtime API has no
           * tool-invocation surface, so a tool is a name whose contract binds to an
           * implementation, and the implementation is a model provider. The provider is
           * created on first CALL, keeping activation lightweight (EXT-19).
           */
          // The manifest the contribution came from declares the tool's REAL schemas;
          // reading them here closes the exact-schema gap an empty `parameters: {}`
          // and open output would leave. Files are bounded and the manifest already
          // validated they exist inside the package.
          const declared = readDeclaredToolSchemas(tool)
          /**
           * P1b: the model-facing description is COMPOSED once here, and the SAME
           * string goes to the DSH registry and the MCP publication, so the two
           * surfaces cannot disagree about what the tool is or when to use it.
           */
          const toolDescription = extensionToolDescription({
            toolName: tool.name,
            description: declared.description,
            fallback: `Provided by ${tool.ownerExtension}.`,
            skill: extensionSkillGuidance(tool.ownerExtension, tool.name),
          })

          /**
           * THE PLANNING CONTRACT IS RECOGNIZED BY NAME PLUS SHAPE (NDL-02).
           *
           * `tools_plan` is the spec's normative caller-facing name for the read-only
           * proposal tool, so any contribution using the name is served through the
           * planning pipeline — the frozen host snapshot supplies the tool list, never
           * the caller's input. A contribution that takes the name WITHOUT the planning
           * input shape (a declared `tools` array) is refused outright: serving it as an
           * ordinary tool would put a non-planner behind the planner's name, and serving
           * it through the planning pipeline would fail in ways nobody could see.
           */
          const isPlanning = tool.name === PLANNING_TOOL_NAME
          if (isPlanning && !hasPlanningInputShape(declared.inputSchema)) {
            throw new Error(
              'tools_plan is the reserved planning contract (NDL-02): a contribution using the name '
              + 'must declare the planning input shape, an array-valued "tools" property in its '
              + 'input schema. Refused rather than published, so the name cannot be taken by a '
              + 'package that is not a planner.',
            )
          }

          // Compile the schemas ONCE, at registration. A declared schema
          // that cannot be compiled REFUSES the tool (P26-13): publishing it with
          // the projection but no full-schema enforcement would advertise
          // constraints that are enforced nowhere, and silently stripping them is
          // exactly what P26-13 forbids. The throw reaches the lifecycle, which
          // rolls back narrowly and quarantines the extension with the reason.
          // The planning tool's INPUT is the host's own schema: the caller names
          // tools as strings and the host supplies the snapshot entries, so the
          // extension's declared input shape is its provider contract, not the
          // caller-facing advertisement.
          const inputValidator = isPlanning
            ? compileSchema(PLANNING_TOOL_INPUT_SCHEMA as unknown as Readonly<Record<string, unknown>>)
            : declared.inputSchema === undefined
              ? undefined
              : compileSchema(declared.inputSchema)
          const outputValidator = declared.outputSchema === undefined
            ? undefined
            : compileSchema(declared.outputSchema)
          const inputProjection = isPlanning
            ? projectSchemaToDsh(PLANNING_TOOL_INPUT_SCHEMA as unknown as Readonly<Record<string, unknown>>).parameters
            : declared.inputSchema === undefined
              ? {}
              : projectSchemaToDsh(declared.inputSchema).parameters
          // Closedness comes from the DECLARED schema, not a hardcoded `false`: an
          // extension that declares an open output schema must not have legitimate
          // extra fields rejected by the registry as undeclared.
          const declaredClosed = declared.outputSchema?.additionalProperties === false
          const outputProjection = declared.outputSchema === undefined
            ? { type: 'object', additionalProperties: true }
            : {
                type: 'object',
                properties: projectSchemaToDsh(declared.outputSchema).parameters,
                additionalProperties: declaredClosed,
              }
          // The envelope is stamped only when the DECLARED schema requires it (EXT-17):
          // the needle contracts declare `meta` as host-authored, and output validation
          // must not be run against a result that is still missing it.
          const requiredMeta = Array.isArray(declared.outputSchema?.required)
            && (declared.outputSchema?.required as readonly unknown[]).includes('meta')

          /**
           * THE PLANNING PIPELINE STATE, closed over per registration (NDL-02/03).
           *
           * The snapshot is captured LAZILY on the first planning call rather than at
           * publication: restoration is asynchronous across extensions, so a
           * publication-time capture would freeze whatever subset had published so far
           * and make the plannable set depend on restore order. By the first call the
           * registry is settled, and the snapshot is then FROZEN for the tool's life — a
           * later registration does not enter it (that is the "frozen at capture"
           * property the tests pin). Freshness is handled by the per-call re-checks, not
           * by re-capturing.
           */
          let planningSnapshot: ToolSchemaSnapshot | undefined
          const planningLiveLeaf = (): ReadonlySet<string> => filterPlanningLiveTools(
            ctx.tools.schemas().map(schema => schema.name),
            PLANNING_EXCLUDED_TOOLS,
            externalGrantContext.current(),
          )
          const capturePlanningSnapshot = (): ToolSchemaSnapshot => {
            planningSnapshot ??= captureToolSchemaSnapshot(
              ctx.tools.schemas() as unknown as readonly RegistryToolSchema[],
              {
                generation: extensionLifecycle?.generation ?? host.activationGeneration,
                excluded: PLANNING_EXCLUDED_TOOLS,
              },
            )
            return planningSnapshot
          }
          /**
           * The fresh NDL-03 authorization check, consulted at PROPOSAL time.
           *
           * Registry membership alone is not admission: a quarantined extension's tool can
           * still be registered (its withdrawal is what failed), and a proposal for it
           * must land in `rejected` rather than pass as valid. Tools the HOST registered
           * itself (model catalog tools) have no owner here and are authorized by their
           * registry presence; contributed tools are additionally admitted through the
           * lifecycle, the same signal the dispatch path itself enforces per call.
           */
          const planningAuthorized = (name: string): true | string => {
            if (!planningLiveLeaf().has(name)) {
              return 'it was withdrawn or deactivated after the snapshot was captured'
            }
            const owner = extensionToolOwners.get(name)
            const lifecycle = extensionLifecycle
            if (owner === undefined || lifecycle === undefined) return true
            return lifecycle.admits(owner, name)
              ? true
              : 'its extension no longer admits it (deactivated or quarantined)'
          }

          const deferLoading = shouldDeferHeavySchema({
            toolName: tool.name,
            schemaBytes: toolSchemaBytes({ name: tool.name, description: toolDescription, parameters: inputProjection }),
            enabled: config.deferHeavySchemas === true,
          })
          const deferMarker = deferLoading ? { deferLoading: true as const } : {}
          const dispose = ctx.tools.register(defineTool({
            name: tool.name,
            description: toolDescription,
            parameters: inputProjection as unknown as ParameterSchemaSpec,
            ...deferMarker,
            output: {
              schema: outputProjection as unknown as ValueSchemaSpec,
              render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
            },
            async execute(args, exec) {
              /**
               * ADMISSION IS ENFORCED AT THE CALL PATH (EXT-04, EXT-24). A registered
               * definition is not enough: a tool whose extension was deactivated, whose
               * handle failed to withdraw, or whose toggle disabled it must refuse here,
               * not dispatch. The lifecycle's admission is the same signal publication
               * used, so a caller can never run a tool the host has stopped admitting.
               */
              const lifecycle = extensionLifecycle
              if (lifecycle !== undefined && !lifecycle.admits(tool.ownerExtension, tool.name)) {
                throw new Error(
                  `${tool.name} is not admitted: its extension is inactive, disabled, or no longer publishes it`,
                )
              }

              if (isPlanning) {
                return servePlanningCall(
                  (args ?? {}) as Record<string, unknown>,
                  exec?.signal ?? new AbortController().signal,
                ) as unknown as never
              }

              /**
               * FULL-SCHEMA enforcement against the DECLARED manifest schemas. The
               * projected advertisement the registry validates is deliberately LOOSER
               * (union members become `json`, unsupported keywords are dropped), so
               * without this the dropped keywords — maxLength, minimum, pattern — are
               * enforced nowhere for extension tools.
               */
              if (inputValidator !== undefined) {
                assertAgainstSchema(`${tool.name} input`, inputValidator, args ?? {})
              }
              admitSerialized('input', args ?? {}, grant.limits.maxInputBytes)
              const dispatch = await createDispatch(environmentFor(tool.ownerExtension), tool.name)
              if (!dispatch.ok) {
                // A declared-but-unserved contract is an ERROR naming which situation the
                // caller is in, never an empty success.
                throw new Error(describeDispatchFailure(dispatch.failure))
              }
              const tracked = trackExtensionCall(tool.ownerExtension, exec?.signal)
              let value
              try {
                value = await dispatch.execute(
                  (args ?? {}) as Record<string, unknown>,
                  tracked.signal,
                )
              } finally {
                tracked.finish()
              }
              if (requiredMeta) {
                value = stampResultMeta(tool.ownerExtension, tool.name, value)
              }
              // The RESULT is checked against the declared output schema before it
              // reaches a caller: the projected advertisement is looser, so this is the
              // check that enforces the keywords the projection dropped.
              if (outputValidator !== undefined) {
                assertAgainstSchema(`${tool.name} output`, outputValidator, value)
              }
              admitSerialized('result', value, grant.limits.maxResultBytes)
              return value as unknown as never
            },
          }))

          /**
           * Serve one `tools_plan` call through the frozen-snapshot pipeline (NDL-02/03).
           *
           * Kept INSIDE registration so it closes over the tool's validators, dispatch
           * environment and the snapshot state — and outside the registry definition so
           * the shared admission check above still runs first.
           * @param callArgs - the caller's arguments, already shape-checked by the registry.
           * @param signal - cancellation.
           * @returns the validated, meta-stamped plan.
           */
          async function servePlanningCall(
            callArgs: Record<string, unknown>,
            signal: AbortSignal,
          ): Promise<Record<string, unknown>> {
            // The host's own schema is the call contract; the extension's shipped input
            // schema is its provider contract, so the declared input validator is
            // deliberately not consulted here.
            if (inputValidator !== undefined) {
              assertAgainstSchema(`${tool.name} input`, inputValidator, callArgs)
            }
            const snapshot = capturePlanningSnapshot()
            const requested = Array.isArray(callArgs.tools)
              ? callArgs.tools.filter((name): name is string => typeof name === 'string')
              : []
            /**
             * THE REQUESTED-NAME GATE. The caller's names are intersected with the LIVE
             * registry and the FROZEN snapshot; anything unattainable refuses the WHOLE
             * call rather than shrinking the offer set silently.
             */
            const decision = offerToolsFromSnapshot(snapshot, requested, planningLiveLeaf())
            if (!decision.ok) throw new Error(describePlanningRejections(decision.rejections))

            const dispatch = await createDispatch(environmentFor(tool.ownerExtension), tool.name)
            if (!dispatch.ok) throw new Error(describeDispatchFailure(dispatch.failure))

            /**
             * The provider receives SNAPSHOT entries, never the caller's declared list and
             * never anything executable — names, descriptions and JSON Schema parameters,
             * which is exactly NDL-02's "narrow public broker".
             */
            const providerInput: Record<string, unknown> = {
              request: callArgs.request,
              tools: decision.offered.map(entry => ({
                name: entry.name,
                description: entry.description,
                parameters: entry.parameters,
              })),
            }
            if (typeof callArgs.system === 'string') providerInput.system = callArgs.system
            if (typeof callArgs.max_new_tokens === 'number') providerInput.max_new_tokens = callArgs.max_new_tokens
            const raw = await dispatch.execute(providerInput, signal)

            /**
             * HOST-SIDE RE-VALIDATION plus the NDL-03 fresh policy check: every proposal
             * is re-checked against the frozen snapshot, the per-call OFFERED set, and the
             * live authorization state (registry membership AND lifecycle admission for
             * contributed tools) — a proposal that is snapshotted, schema-valid but no
             * longer offered or no longer admitted is moved to `rejected` with the reason,
             * never returned as a valid plan step.
             */
            const { payload, warnings } = recheckProposals(
              snapshot,
              raw,
              new Set(decision.offered.map(entry => entry.name)),
              planningAuthorized,
            )
            const withCatalog = {
              ...payload,
              noMatch: (Array.isArray(payload.proposals) ? payload.proposals.length : 0) === 0,
              toolCatalogRevision: String(snapshot.generation),
            }
            const stamped = stampResultMeta(tool.ownerExtension, tool.name, withCatalog, warnings)
            if (outputValidator !== undefined) {
              assertAgainstSchema(`${tool.name} output`, outputValidator, stamped)
            }
            return stamped
          }
          // The owner map is maintained at the same boundary that publishes and withdraws
          // the tool, so the planning admission check never consults a stale owner.
          extensionToolOwners.set(tool.name, tool.ownerExtension)
          ownedExtensionToolNames.add(tool.name)
          // The lifecycle contribution carries the contract id; it carries no version, so
          // the version stays null rather than being invented.
          if (tool.contractId !== undefined) {
            toolContracts.set(tool.name, { contract: tool.contractId, contractVersion: null })
          }
          exposeExtensionToolToMcp(tool.name, {
            description: toolDescription,
            /**
             * `tools_plan` is served through the HOST's planning contract, whose `tools`
             * are tool NAMES (strings) that the host snapshots into the planner's offered
             * entries. The manifest's own schema describes the ENGINE's object-shaped
             * tool descriptors, so advertising it over MCP made every schema-valid call
             * fail `"tools[0]" must be a string` while string callers failed the
             * advertised-object validation — a contradiction no client could satisfy.
             * Advertise the shape the registry actually accepts.
             */
            ...isPlanning
              ? { inputSchema: PLANNING_TOOL_INPUT_SCHEMA as unknown as Readonly<Record<string, unknown>> }
              : declared.inputSchema === undefined ? {} : { inputSchema: declared.inputSchema },
            ...declared.outputSchema === undefined ? {} : { outputSchema: declared.outputSchema },
          })
          return () => {
            extensionToolOwners.delete(tool.name)
          ownedExtensionToolNames.delete(tool.name)
            toolContracts.delete(tool.name)
            withdrawExtensionToolFromMcp(tool.name)
            dispose()
          }
        },

        /**
         * REGISTER ONE DECLARATIVE IMPLEMENTATION'S CALLER-FACING TOOL (RCP-01, HLM-01).
         *
         * A declarative package's manifest declares implementations only — no `tools`
         * array — so the tool names and schemas can only come from the RESOLVED RECIPES,
         * and a recipe can only be SERVED when the deployment composes a harness
         * provider. The contribution arrives per implementation; this resolves the whole
         * package, prepares the broker, and registers the one tool this implementation
         * names, returning its disposer so the registrar withdraws it on deactivation
         * exactly like a module tool.
         *
         * The refusal without a provider is the SAME message the per-call declarative
         * branch raises, moved to publication: activating a declarative package on a
         * deployment with no harness composition fails loudly (the narrow rollback
         * quarantines it) instead of silently registering nothing.
         */
        /**
         * TASK-121: the STANDARD contract tool for an implementation-only
         * MODULE extension. The contract id maps to the standard tool name
         * (text.embed -> text_embed — never invented per extension), and the
         * tool's schemas come from the contract definition itself. The
         * extension owns the name while active (task-117's probe reads the
         * implementations' standard names too); the deactivation withdraws it.
         */
        registerContractImplementation: (contribution): (() => void) | undefined => {
          const record = selectedInstalled(contribution.extensionId)
          if (record === undefined) return undefined
          const discovery = discoverExtension(record.installPath)
          // DECLARATIVE packages are served by the recipe path below, never by
          // this standard-contract path (their contracts may share standard
          // names, e.g. text.title, but their execution is the recipe broker).
          if (discovery.manifest.execution?.kind === 'declarative') return undefined
          const contract = STANDARD_CONTRACTS.find(candidate => candidate.contract === contribution.contractId)
          if (contract === undefined) return undefined
          const toolName = contract.toolName
          // No duplicate: the extension's own manifest tool (when it declares
          // one) already serves the contract under the standard name.
          if (extensionToolOwners.get(toolName) === contribution.extensionId) return () => {}
          const environment = environmentFor(contribution.extensionId)
          const manifestImplementation = environment.getManifest().implementations.find(
            candidate => candidate.contractId === contribution.contractId,
          )
          const registered = registerContractImplementationTool(
            ctx as unknown as { tools: { register(definition: unknown): () => void } },
            contract,
            host,
            async (args, signal) => {
              const dispatch = await createDispatchForContract(environment, contribution.contractId)
              if (!dispatch.ok) throw new Error(describeDispatchFailure(dispatch.failure))
              return dispatch.execute(args, signal)
            },
            {
              id: contribution.implementationId,
              extensionId: contribution.extensionId,
              modelId: manifestImplementation?.modelId ?? contribution.implementationId,
            },
            { deferHeavySchemas: config.deferHeavySchemas === true },
          )
          extensionToolOwners.set(toolName, contribution.extensionId)
          ownedExtensionToolNames.add(toolName)
          toolContracts.set(toolName, { contract: contract.contract, contractVersion: contract.version })
          exposeExtensionToolToMcp(toolName, {
            description: contractToolDescription(contract),
            inputSchema: contract.inputSchema,
            outputSchema: contract.outputSchema,
          })
          return () => {
            extensionToolOwners.delete(toolName)
          ownedExtensionToolNames.delete(toolName)
            toolContracts.delete(toolName)
            withdrawExtensionToolFromMcp(toolName)
            registered.dispose()
          }
        },
        /**
         * P2 of the agent tool-selection plan: a manifest skill becomes a runtime skill.
         *
         * The lifecycle already publishes `kind: 'skill'` contributions (gated by the
         * manifest's `requiresTools` against the tools actually visible), but the wire only
         * carries the NAME. So the host re-reads the installed package's manifest here,
         * finds the declared skill, and loads its body from the declared package-relative
         * path. Every failure is REPORTED and skipped rather than thrown: a skill the host
         * cannot load must never fail the activation that publishes the extension's tools.
         */
        registerSkill: (skill): (() => void) => {
          if (!registerSkills) return () => {}
          const record = selectedInstalled(skill.ownerExtension)
          if (record === undefined) {
            ctx.logger.warn(
              `model-tools: ${skill.ownerExtension}'s skill ${skill.name} was dropped: the extension is not installed`,
            )
            return () => {}
          }
          let discovery: ReturnType<typeof discoverExtension>
          try {
            discovery = discoverExtension(record.installPath)
          } catch (error) {
            ctx.logger.warn(
              `model-tools: ${skill.ownerExtension}'s skill ${skill.name} was dropped: `
              + `the package cannot be read: ${error instanceof Error ? error.message : String(error)}`,
            )
            return () => {}
          }
          const declared = discovery.manifest.skills.find(candidate => candidate.name === skill.name)
          if (declared === undefined) {
            ctx.logger.warn(`model-tools: ${skill.ownerExtension} declares no skill named ${skill.name}`)
            return () => {}
          }
          const skills = ctx.get('skills')
          if (skills === undefined) {
            ctx.logger.warn(
              `model-tools: ${skill.ownerExtension}'s skill ${skill.name} was dropped: no skill registry is mounted`,
            )
            return () => {}
          }
          let content: string
          let path: string
          try {
            // Package-relative by manifest validation; the containment check is defense in
            // depth, so a `./../` path can never read outside the installed package.
            const root = resolve(record.installPath)
            path = resolve(root, declared.path)
            if (path !== root && !path.startsWith(root + sep)) {
              throw new Error(`the declared path "${declared.path}" escapes the installed package`)
            }
            const size = statSync(path).size
            if (size > MAX_SKILL_BYTES) {
              throw new Error(`the skill body is ${size} bytes, over the ${MAX_SKILL_BYTES} cap`)
            }
            content = readFileSync(path, 'utf8')
          } catch (error) {
            ctx.logger.warn(
              `model-tools: ${skill.ownerExtension}'s skill ${skill.name} was dropped: `
              + `${error instanceof Error ? error.message : String(error)}`,
            )
            return () => {}
          }
          try {
            return skills.register({
              name: declared.name,
              description: declared.description,
              content,
              // The concrete file is the resource base: relative links in the body resolve
              // against the installed package, not the host process's cwd.
              path,
              source: 'extension',
            })
          } catch (error) {
            ctx.logger.warn(
              `model-tools: ${skill.ownerExtension}'s skill ${skill.name} was dropped: `
              + `${error instanceof Error ? error.message : String(error)}`,
            )
            return () => {}
          }
        },
        registerDeclarative: (contribution): (() => void) => {
          const record = selectedInstalled(contribution.extensionId)
          if (record === undefined) return () => {}
          const discovery = discoverExtension(record.installPath)
          const manifest = discovery.manifest as unknown as {
            execution?: { kind?: string }
            implementations?: readonly { id: string; contractId: string; recipeVersion: string }[]
          }
          if (manifest.execution?.kind !== 'declarative') {
            // A MODULE package's implementation is not a caller-facing tool; the model
            // catalogue binds it, and there is nothing to register.
            return () => {}
          }
          /**
           * THE RECIPES ARE RESOLVED BEFORE ANY PROVIDER DECISION, because their `kind`
           * decides which lane serves them (docs/runtime/PHASE2.md).
           *
           * The harness lane needs a composed `LlmProvider`; the model-runtime lane must NOT
           * (its engine is a factory the package ships and the recipe names). Checking for a
           * harness provider first — which is what this function did before the lane existed —
           * would refuse a model-runtime package for lacking something it never needs.
           */
          const resolved = resolveDeclarativeImplementations(record.installPath, manifest.implementations ?? [])
          if (!resolved.ok) {
            throw new Error(
              `${contribution.extensionId} is declarative but its recipe could not be resolved: `
              + `${resolved.id} — ${resolved.detail}`,
            )
          }
          const rawEntry = resolved.resolved.find(entry => entry.id === contribution.name)
          if (rawEntry === undefined) return () => {}

          /**
           * THE MODEL-RUNTIME LANE (AT-25, ARCH-02).
           *
           * A `kind: "model-runtime"` recipe is served WITHOUT a harness model: the host
           * parses the recipe, resolves the provider factory FROM THE EXTENSION'S OWN PACKAGE
           * (never from the host's module graph, which is why the host can declare no engine),
           * and registers the tool the recipe names with the recipe's schema files.
           *
           * Every failure here is a NAMED refusal thrown from registration, so a package that
           * cannot run is quarantined rather than published as a tool that fails at call time.
           */
          if (isModelRuntimeRecipe(rawEntry.recipe)) {
            const parsedRecipe = parseModelRuntimeRecipe(rawEntry.recipe)
            if (!parsedRecipe.ok) {
              throw new Error(
                `${contribution.extensionId} declares a model-runtime recipe for ${contribution.name} that did not validate: `
                + `${parsedRecipe.code} — ${parsedRecipe.detail}`,
              )
            }
            /**
             * The authority is the SAME one the extension-tool path uses, so a model-runtime
             * provider resolves caller paths through the host's grants rather than opening
             * whatever it is handed (SEC-06).
             */
            const authority = createInvocationAuthority(grant, 'interactive')
            const lane = createModelRuntimeTool({
              extensionId: contribution.extensionId,
              implementationId: contribution.name,
              installPath: record.installPath,
              recipe: parsedRecipe.recipe,
              assets: () => prepareAssetsSurface?.assetMapFor(contribution.extensionId) ?? { assetIds: [], get: () => undefined },
              invocationContext: exec => ({
                invocationId: `inv_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
                signal: exec?.signal ?? new AbortController().signal,
                limits: authority.limits,
                resolvePath: candidate => authority.resolvePath(candidate),
              }),
              onError: message => ctx.logger.warn(`model-tools: ${message}`),
            })
            if (!lane.ok) {
              throw new Error(
                `${contribution.extensionId} declares a model-runtime recipe for ${contribution.name} that cannot be served: `
                + `${lane.code} — ${lane.detail}`,
              )
            }
            const laneDescription = extensionToolDescription({
              toolName: lane.tool.name,
              description: lane.tool.description,
              fallback: `Provided by ${contribution.extensionId}.`,
              skill: extensionSkillGuidance(contribution.extensionId, lane.tool.name),
            })
            const laneDeferral = shouldDeferHeavySchema({
              toolName: lane.tool.name,
              schemaBytes: toolSchemaBytes({
                name: lane.tool.name,
                description: laneDescription,
                parameters: lane.tool.parameters,
              }),
              enabled: config.deferHeavySchemas === true,
            })
            const laneDeferMarker = laneDeferral ? { deferLoading: true as const } : {}
            const disposeTool = ctx.tools.register(defineTool({
              name: lane.tool.name,
              description: laneDescription,
              parameters: lane.tool.parameters as unknown as ParameterSchemaSpec,
              ...laneDeferMarker,
              output: {
                schema: { type: 'json' },
                render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
              },
              async execute(args, exec) {
                return await lane.tool.execute(args, exec) as never
              },
            }))
            exposeExtensionToolToMcp(lane.tool.name, {
              description: laneDescription,
              inputSchema: lane.tool.inputSchema,
              outputSchema: lane.tool.outputSchema,
            })
            return () => {
              // Withdraw first so no new call can start, then release the provider.
              withdrawExtensionToolFromMcp(lane.tool.name)
              disposeTool()
              void lane.tool.dispose()
            }
          }

          if (harnessProvider === undefined && config.harnessProfiles === undefined) {
            throw new Error(
              `${contribution.extensionId} is declarative and its recipes resolved, but they cannot be served: `
              + 'this deployment composes no harness LlmProvider, so a declarative package\'s recipes '
              + 'cannot be executed. Set config.harnessModel (or supply harnessProvider/harnessProfiles) to serve them.',
            )
          }
          const served = prepareDeclarative({
            ...harnessProvider === undefined ? {} : { provider: harnessProvider },
            ...config.harnessProfiles === undefined ? {} : { profiles: config.harnessProfiles },
            journal: journalRecord => recordAuxiliaryReceipt(journalRecord, contribution.extensionId, 'unknown'),
          }, resolved.resolved)
          if (!served.ok) {
            throw new Error(
              `${contribution.extensionId} is declarative and its ${resolved.resolved.length} recipe(s) resolved, `
              + `but they cannot be served: ${served.detail}`,
            )
          }
          const parsed = parseRecipe(rawEntry.recipe)
          if (!parsed.ok) {
            throw new Error(`${contribution.extensionId} declares a recipe that did not validate: ${JSON.stringify(parsed).slice(0, 300)}`)
          }
          const recipe = parsed.recipe as RecipeManifest
          const servedRecipe = served.served.find(entry => entry.implementationId === contribution.name)
          if (servedRecipe === undefined) return () => {}
          /**
           * THE CONTRACT A RECIPE IMPLEMENTS (task-54).
           *
           * A recipe's model replies with TEXT; the tool's CONTRACT declares an OBJECT with a
           * `meta` envelope. Serving the raw string (the pre-task behaviour) meant `text_title`
           * returned '{"title":…}' as a string with no provenance, while its contract advertised
           * `withMeta({title, description})`. The contract is the authority: when one exists the
           * reply is parsed into it, stamped and VALIDATED before it reaches a caller.
           */
          const recipeContract = STANDARD_CONTRACTS.find(candidate => candidate.contract === servedRecipe.contractId)
          // Registration-time contract check, exactly as the catalogue/extension lanes do:
          // the compiled validator it installs is what `assertValidOutput` later uses.
          if (recipeContract !== undefined) assertValidContract(recipeContract)
          // The ADVERTISEMENT comes from the RECIPE's declared inputs (AT-63: the built-in's
          // input schema comes from the recipe, never a host guess). The recipe format is
          // JSON-Schema-flavoured (per-property `required` flags, minLength/maxLength), which
          // the DSH value-schema DSL does not fully speak — so the host applies the same
          // dual discipline it applies to extension tools (P26-13): the registry advertises
          // the DSL subset, and the FULL schema is compiled and enforced at call time.
          const dsl: Record<string, unknown> = {}
          const properties: Record<string, unknown> = {}
          const requiredNames: string[] = []
          for (const [name, raw] of Object.entries(recipe.inputs)) {
            const record = raw as unknown as Record<string, unknown>
            const advertised: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(record)) {
              // The DSH DSL admits `required` only as true; a false flag is simply omitted.
              if (key === 'required' && value !== true) continue
              if (key === 'type' && value === 'image') {
                // Typed media is not a DSH scalar type; the broker does its own media
                // typing (and refuses a path/URL that is not typed media), so the
                // advertisement is the permissive json while enforcement stays full.
                advertised.type = 'json'
                continue
              }
              if (DSH_PARAMETER_KEYWORDS.has(key)) advertised[key] = value
            }
            dsl[name] = advertised
            // The full-schema half: per-property `required` folds into the root array,
            // image-typed properties validate as permissive objects (the broker types
            // them), and everything else keeps its declared keywords.
            const full: Record<string, unknown> = { ...record }
            delete full.required
            if (record.required === true) requiredNames.push(name)
            if (record.type === 'image') {
              full.type = 'object'
              full.additionalProperties = true
              delete full.mediaTypes
              delete full.maxBytes
            }
            properties[name] = full
          }
          const inputValidator = compileSchema({
            type: 'object',
            additionalProperties: false,
            properties,
            required: requiredNames,
          })
          const recipeDescription = extensionToolDescription({
            toolName: recipe.tool.name,
            description: recipe.description,
            fallback: `Provided by ${contribution.extensionId}.`,
            skill: extensionSkillGuidance(contribution.extensionId, recipe.tool.name),
          })
          const recipeDeferral = shouldDeferHeavySchema({
            toolName: recipe.tool.name,
            schemaBytes: toolSchemaBytes({ name: recipe.tool.name, description: recipeDescription, parameters: dsl }),
            enabled: config.deferHeavySchemas === true,
          })
          const recipeDeferMarker = recipeDeferral ? { deferLoading: true as const } : {}
          const disposeTool = ctx.tools.register(defineTool({
            name: recipe.tool.name,
            description: recipeDescription,
            parameters: dsl as unknown as ParameterSchemaSpec,
            ...recipeDeferMarker,
            output: recipeContract === undefined
              ? recipe.response === undefined
                ? {
                    schema: { type: 'string' },
                    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
                  }
                : {
                    schema: { type: 'json' },
                    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
                  }
              : {
                  // DECL-02: the CONTRACT's output, not the recipe's raw text shape.
                  schema: {
                    type: 'object',
                    properties: projectSchemaToDsh(recipeContract.outputSchema).parameters,
                    additionalProperties: false,
                  } as unknown as ValueSchemaSpec,
                  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
                },
            async execute(args, exec) {
              // FULL-SCHEMA enforcement before the broker runs the recipe: the
              // advertised DSL subset is looser, so the dropped keywords are enforced
              // here, exactly as the extension-tool path does (P26-13).
              assertAgainstSchema(`${recipe.tool.name} input`, inputValidator, args ?? {})
              // Typed media crosses the tool boundary in the JSON-safe form
              // `{ mediaType, bytes: number[] }` (the harness requires losslessly
              // JSON-serializable arguments); the recipe wants the ACTUAL bytes, so the
              // conversion happens HERE, and only here — never a path and never a URL,
              // which the recipe binding refuses (AT-64).
              const converted: Record<string, unknown> = { ...(args ?? {}) }
              for (const [name, value] of Object.entries(converted)) {
                const candidate = value as { mediaType?: unknown; bytes?: unknown }
                if (
                  typeof candidate?.mediaType === 'string'
                  && Array.isArray(candidate.bytes)
                  && candidate.bytes.every(entry => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 255)
                ) {
                  converted[name] = {
                    mediaType: candidate.mediaType,
                    bytes: Uint8Array.from(candidate.bytes as number[]),
                  }
                }
              }
              // NO lifecycle.admits gate: declarative tools have no per-tool entries in the
              // lifecycle state (the SDK models manifest tools only). Deactivation
              // withdrawal — the registrar's handle for exactly this disposer — is the
              // enforcement, and it removes the tool from the registry before any call.
              admitSerialized('input', converted, grant.limits.maxInputBytes)
              if (recipe.modelSelection?.strategy === 'approved-profile') {
                const profiles = externalGrantContext.currentProfiles() ?? grant.allowedHarnessProfiles
                if (!profiles.includes(recipe.modelSelection.profile)) {
                  throw new Error(
                    `EXECUTOR_NOT_CONFIGURED: harness executor profile "${recipe.modelSelection.profile}" is not `
                    + 'approved for this caller; an external caller cannot borrow the UI session or another client\'s profile',
                  )
                }
              } else if (externalGrantContext.currentProfiles() !== undefined) {
                // HLM-03/AT-67: an external MCP application does not automatically have
                // the DSH conversational model. It may use the operator's explicit
                // server-owned externalDefaultProfile only when its OWN grant names it.
                const profiles = externalGrantContext.currentProfiles() ?? []
                const externalDefault = config.harnessExecutorV3?.externalDefaultProfile
                if (typeof externalDefault !== 'string' || externalDefault.length === 0
                  || !profiles.includes(externalDefault)) {
                  throw new Error(
                    'EXECUTOR_NOT_CONFIGURED: an external caller has no DSH conversational model and no approved '
                    + 'server-owned executor profile for this client/workspace',
                  )
                }
              }
              const tracked = trackExtensionCall(contribution.extensionId, exec?.signal)
              const grantPolicy = narrowBrokerPolicy(INITIAL_HOST_POLICY, {
                outputTokens: grant.limits.maxOutputTokens,
                imageInputs: grant.limits.maxImages,
                // The native/interactive path uses the operator-configured DSH provider;
                // an EXTERNAL caller may reach remote only with an explicit remote grant.
                remoteDestinations: externalGrantContext.currentProfiles() === undefined
                  || (externalGrantContext.currentRemoteDestinations()?.length ?? 0) > 0,
              })
              let raw: unknown
              try {
                raw = await servedRecipe.invoke(converted, tracked.signal, {
                  policy: grantPolicy,
                  deadlineMs: grant.limits.deadlineMs,
                })
              } finally {
                tracked.finish()
              }
              if (typeof raw !== 'string') {
                throw new Error(`${recipe.tool.name}: the provider returned ${typeof raw}, not text`)
              }
              const interpreted = interpretRecipeResponse(recipe, raw)
              if (!interpreted.ok) {
                throw new Error(`${recipe.tool.name}: ${interpreted.code}: ${interpreted.reason}`)
              }
              /**
               * CONTRACT-SHAPED, OR REFUSED (task-54). A recipe with no `response` block keeps
               * the provider's raw text, which is only correct when the tool has NO contract.
               * With a contract, the text must parse to the contract's object; anything else
               * fails HERE rather than reaching a caller as an undocumented string.
               */
              let value: unknown = interpreted.value
              if (recipeContract !== undefined) {
                if (typeof value === 'string') {
                  try {
                    value = JSON.parse(value) as unknown
                  } catch {
                    throw new Error(`${recipe.tool.name}: the provider returned text that is not the ${recipeContract.contract} JSON object`)
                  }
                }
                if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                  throw new Error(`${recipe.tool.name}: the provider returned ${typeof value}, not a ${recipeContract.contract} object`)
                }
                const meta: ToolMeta = {
                  contract: recipeContract.contract,
                  contractVersion: recipeContract.version,
                  implementationId: contribution.name,
                  extension: contribution.extensionId,
                  extensionVersion: selectedInstalled(contribution.extensionId)?.version ?? '0.0.0',
                  activationGeneration: extensionLifecycle?.generation ?? host.activationGeneration,
                  executionLocation: 'host',
                  receiptId: host.nextReceiptId(),
                  warnings: [],
                }
                // SAFETY: the value was proven to be a non-null, non-array object immediately
                // above, and `assertValidOutput` enforces the full contract below.
                const stamped = { ...(value as Record<string, unknown>), meta }
                assertValidOutput(recipeContract, stamped)
                value = stamped
              }
              admitSerialized('result', value, grant.limits.maxResultBytes)
              return value as never
            },
          }))
          exposeExtensionToolToMcp(recipe.tool.name, {
            description: recipeDescription,
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties,
              required: requiredNames,
            },
            // DECL-02 parity: the advertised schema is the contract's when one applies.
            outputSchema: recipeContract !== undefined
              ? recipeContract.outputSchema
              : recipe.response === undefined ? { type: 'string' } : { type: 'json' },
          })
          if (servedRecipe.recipeDigest !== undefined) {
            declarativeRecipeDigests.set(recipe.tool.name, servedRecipe.recipeDigest)
          }
          return () => {
            declarativeRecipeDigests.delete(recipe.tool.name)
            withdrawExtensionToolFromMcp(recipe.tool.name)
            disposeTool()
          }
        },
      },
      onRefused: (contribution, error) => {
        ctx.logger.warn(`model-tools: refused ${contribution.name} from ${contribution.extensionId}: ${error.message}`)
      },
    })
    extensionLifecycle = new ExtensionLifecycle({
      store,
      profile: 'default',
      registrar,
      // EXT-20, task-29's hook: when the lifecycle finishes withdrawing an
      // extension's handles (deactivate or uninstall, success or failure), the host
      // disposes that extension's managed worker so the child process is joined
      // before the deactivation returns — no worker outlives its extension.
      onWithdrawal: async (extensionId) => {
        // EXT-27: abort owned foreground calls, then TERMINATE the managed workers so a
        // hung callback cannot keep the call alive to its invoke deadline. Wait for the
        // aborted calls within the documented 5s grace.
        const calls = withdrawExtensionCalls(extensionId)
        await workerRegistry.dispose(extensionId)
        const callsStopped = await calls
        // EXT-29: release the extension instance (and any native/model resources it
        // owns) BEFORE an uninstall deletes the package directory. A dispose failure is
        // surfaced after the worker join so the lifecycle can report cleanup pending.
        let failure: unknown
        for (const [key, pending] of extensionInstances) {
          if (!key.startsWith(`${extensionId}@`)) continue
          try {
            const instance = await pending
            await instance.dispose?.('extension withdrawn')
          } catch (error) {
            failure ??= error
          }
          extensionInstances.delete(key)
        }
        if (!callsStopped) {
          failure ??= new Error(
            `${extensionId}: owned foreground call(s) did not settle within the 5s grace; they were terminated and reported`,
          )
        }
        if (failure !== undefined) throw failure
      },
      // EXT-03: the host release's trusted lock, never a package manifest claim.
      protectedBuiltins: PROTECTED_BUILTIN_IDS,
      networkPolicy: config.networkPolicy ?? 'any',
      // EXT-35: lifecycle outcomes are recorded separately from invocation
      // receipts, with the approving principal and the installed content digest.
      onAudit: (event) => {
        const installed = store.listInstalled().value.find(record => (
          record.extensionId === event.extensionId
          && (event.version === null || record.version === event.version)
        ))
        try {
          lifecycleRecords.push(buildLifecycleRecord({
            operation: event.operation,
            extensionId: event.extensionId,
            version: event.version,
            contentDigest: installed?.contentDigest ?? null,
            profile: 'default',
            outcome: event.outcome === 'succeeded' ? 'succeeded' : 'failed',
            reason: event.reason ?? null,
            approvedBy: { kind: 'operator', identity: 'local-interactive' },
          }))
          if (lifecycleRecords.length > MAX_RETAINED_RECEIPTS) lifecycleRecords.shift()
        } catch (error) {
          ctx.logger.warn(`model-tools: lifecycle audit record failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    })

    /**
     * EXT-29: retry owned deletion left pending by an uninstall that could not remove
     * its private installation. Only records whose profile state is already absent are
     * touched, and only their recorded install path.
     */
    {
      const cleanup = await extensionLifecycle.retryCleanupPending()
      for (const failure of cleanup.failed) {
        ctx.logger.warn(`model-tools: pending cleanup for ${failure.extensionId} failed: ${failure.reason}`)
      }
    }

    /**
     * EXT-30 slice 3: the host update surface over the SDK's staged-update seams.
     *
     * quiesce = deactivate through the lifecycle (withdraws the handles, stops
     * admissions — the onWithdrawal hook disposes the worker). rebind = activate
     * the named version through the lifecycle (all-or-nothing: a failed
     * activation withdraws its own partial publications). The surface module
     * wraps the rebind all-or-nothing with the internal revert and bounds the
     * rollback's rebindRestored host-side.
     */
    updateSurface = createUpdateHostSurface({
      storeDir: extensionStoreDir,
      profile: 'default',
      hooks: {
        quiesce: async (extensionId) => {
          const lifecycle = extensionLifecycle
          if (lifecycle === undefined) return
          await lifecycle.deactivate(extensionId)
        },
        rebind: async (extensionId, version) => {
          const lifecycle = extensionLifecycle
          if (lifecycle === undefined) throw new Error(`the extension lifecycle is not mounted; ${extensionId}@${version} cannot rebind`)
          await lifecycle.activate(extensionId, version)
        },
      },
    })

    /**
     * RES-02/03/05, the LAST in-repo slice: the prepared-assets surface.
     *
     * The cache root is the ISOLATED STATE DIR the host already owns (the
     * directory of the state file), never the repository and never HOME. The
     * default source is the real ranged HTTP source — a real acquisition run
     * stays OPT-IN (an operator explicitly runs extensions-prepare); the test
     * suite injects a local file source and performs no network.
     */
    {
      const statePath = config.stateFile ?? defaultStateFile()
      const registry: PreparedAssetRegistry = createPreparedAssetRegistry({
        cacheRoot: assetCacheRoot.length > 0 ? assetCacheRoot : join(dirname(resolve(statePath)), 'asset-cache'),
        ...config.assetFreeSpaceProbe === undefined ? {} : { freeSpaceBytes: config.assetFreeSpaceProbe },
      })
      const planCache = new Map<string, { plan: ReturnType<typeof planPreparation>; groups: readonly LockGroup[]; modelId: string }>()
      prepareAssetsSurface = {
        plan(extensionId) {
          const cached = planCache.get(extensionId)
          if (cached !== undefined) return cached.plan
          const record = selectedInstalled(extensionId)
          if (record === undefined) throw new Error(`${extensionId} is not installed, so its assets cannot be planned`)
          const discovery = discoverExtension(record.installPath)
          const model = discovery.manifest.models[0]
          if (model === undefined) throw new Error(`${extensionId} declares no model deployment to prepare`)
          const lockPath = join(dirname(discovery.manifestPath), model.assetLock)
          const lock = parseAssetLock(readFileSync(lockPath, 'utf8'))
          const groups = lockGroups(lock, model.assetSet)
          const plan = planPreparation(
            identityFor(extensionId, model.id, lock),
            plannedAssets(lock, model.assetSet),
            lock.license,
          )
          planCache.set(extensionId, { plan, groups, modelId: model.id })
          return plan
        },
        groupsForPlan(extensionId) {
          const cached = planCache.get(extensionId)
          if (cached === undefined) throw new Error(`no preparation plan for ${extensionId}; run the plan disclosure first`)
          return cached.groups
        },
        modelIdFor(extensionId) {
          const cached = planCache.get(extensionId)
          if (cached === undefined) throw new Error(`no preparation plan for ${extensionId}`)
          return cached.modelId
        },
        async prepare(extensionId, options) {
          const cached = planCache.get(extensionId)
          if (cached === undefined) throw new Error(`no preparation plan for ${extensionId}; run the plan disclosure first`)
          /**
           * REFUSE BEFORE THE TRANSFER when readiness has no writer. Acquiring a
           * multi-GB asset set is the expensive half of preparation, and it buys
           * nothing if the readiness write that lets activation proceed cannot
           * happen. The old wiring SKIPPED that write when the lifecycle was not
           * mounted and still returned `ok`, so the page could report a successful
           * prepare while the deployment stayed `needs-preparation` forever — the
           * exact "Prepare did not make it usable" report. Naming the host gap here
           * costs nothing and acquires nothing.
           */
          const lifecycle = extensionLifecycle
          if (lifecycle === undefined) {
            throw new Error(
              `the extension lifecycle is not mounted, so ${extensionId}'s readiness cannot be recorded; `
              + 'no assets were acquired',
            )
          }
          const outcome = await registry.prepare(extensionId, cached.plan, cached.groups, options)
          if (!outcome.ok) return outcome
          // The verified assets flip the deployment from needs-preparation to
          // PREPARED-COLD through the same readiness recorder the restore
          // chain uses — the prepared-cold-callable admission then admits the
          // tool's first call.
          await lifecycle.recordReadiness(extensionId, { [cached.modelId]: 'prepared-cold' })
          return outcome
        },
        assetMapFor(extensionId) {
          return registry.assetMapFor(extensionId)
        },
        /**
         * RESTART RESTORE: rebuild this process's handles from the group
         * directories an earlier process's verified prepare left on disk. Without
         * it, a restart keeps `prepared-cold` in the store while the in-memory map
         * is empty, so every tool call fails with "the … asset group was not
         * prepared" and the page offers no Prepare action (the requirement is
         * already satisfied).
         */
        restore(extensionId) {
          const cached = planCache.get(extensionId) ?? (() => {
            const record = selectedInstalled(extensionId)
            if (record === undefined) throw new Error(`${extensionId} is not installed, so its assets cannot be restored`)
            const discovery = discoverExtension(record.installPath)
            const model = discovery.manifest.models[0]
            if (model === undefined) throw new Error(`${extensionId} declares no model deployment to restore`)
            const lockPath = join(dirname(discovery.manifestPath), model.assetLock)
            const lock = parseAssetLock(readFileSync(lockPath, 'utf8'))
            const entry = {
              plan: planPreparation(identityFor(extensionId, model.id, lock), plannedAssets(lock, model.assetSet), lock.license),
              groups: lockGroups(lock, model.assetSet),
              modelId: model.id,
            }
            planCache.set(extensionId, entry)
            return entry
          })()
          return registry.restore(extensionId, cached.plan, cached.groups)
        },
        async purge(extensionId) {
          const cached = planCache.get(extensionId)
          const result = registry.purge(extensionId)
          planCache.delete(extensionId)
          const lifecycle = extensionLifecycle
          if (lifecycle !== undefined && cached !== undefined) {
            await lifecycle.recordReadiness(extensionId, { [cached.modelId]: 'needs-preparation' })
          }
          return result
        },
        registry,
      }
    }

    /**
     * RESTORE what the operator already approved.
     *
     * RUN-05 permits exactly this much at startup: an approved activation may be restored
     * and its declarations read. It performs NO model preparation and NO package
     * resolution, so nothing downloads because the plugin loaded.
     *
     * A failure is LOGGED rather than thrown: one broken extension must not remove every
     * working tool (RUN-06).
     */

    /**
     * Inspect every provider-backed catalog entry belonging to an extension and record
     * the results into the lifecycle, so activation can publish callable tools instead
     * of leaving every deployment at the `needs-preparation` default.
     *
     * Inspection is read-only (EXT-18): it never loads model assets, so this does not
     * prepare anything at startup.
     * @param lifecycle - the lifecycle whose store receives the recorded readiness.
     * @param extensionId - the extension being restored.
     */
    void restoreExtensions({
      ctx,
      store,
      config,
      extensionStoreDir,
      extensionLifecycle: () => extensionLifecycle,
      prepareAssetsSurface: () => prepareAssetsSurface,
      assetRestoreFailures,
      activationGenerations,
      extensionsService,
      bridge,
      resolved,
    })

    ctx.effect(() => () => {
      extensionLifecycle = undefined
      // EXT-20: host teardown disposes every managed worker process — no child
      // outlives the host that spawned it.
      void workerRegistry.disposeAll()
    }, 'model-tools extension teardown')
    ctx.logger.info(`model-tools: extension store mounted at ${extensionStoreDir}`)
  }


  /**
   * RES-01: one admission boundary covers EVERY registered tool — catalog,
   * extension, declarative and control surfaces — because the DSH registry's
   * execute is the single path all of them use. The host grant is the authority;
   * an external client's own grant is additionally enforced before this point.
   */
  {
    const executeBeforeAdmission = ctx.tools.execute.bind(ctx.tools)
    ctx.tools.execute = (async request => {
      admitSerialized('input', (request as { arguments?: unknown }).arguments ?? {}, grant.limits.maxInputBytes)
      const result = await executeBeforeAdmission(request)
      admitSerialized('result', result, grant.limits.maxResultBytes)
      return result
    }) as typeof ctx.tools.execute
  }

  const runnable = resolved.filter(item => item.verdict.runnable).length
  ctx.logger.info(
    `model-tools: ${installed.size} model tool(s) registered from ${entries.length} catalogued models `
    + `(${runnable} runnable in this process)`,
  )
}

export { loadCatalog, CatalogError, DEFAULT_CATALOG_FILE } from './catalog.ts'
export { resolveCapability, resolveCatalog, canResolve, packageSpecifier, type ResolvedModel } from './capability.ts'
export { createAdapter, ADAPTER_FACTORIES } from './adapters/index.ts'
export {
  buildArgv,
  commandExists,
  createCliTransport,
  createRemoteTransport,
  parseBridgeResponse,
  parseCliOutcome,
  splitArguments,
  BRIDGE_PATH,
  DEFAULT_CLI_COMMAND,
  type CommandRunner,
  type CommandTransport,
  type HttpPost,
  type TransportOptions,
} from './transport.ts'
export { renderSkillBody } from './skills.ts'
export {
  EmbeddingIndex, IncompatibleEmbeddingSpace, openMemoryEmbeddingIndex,
  type EmbeddingRecord, type EmbeddingSpaceIdentity,
} from './embedding-index.ts'
export { loadPlaybooks, DEFAULT_PLAYBOOK_FILE, type ModelPlaybook } from './playbook.ts'
export {
  createFileStateStore,
  createMemoryStateStore,
  defaultStateFile,
  parseState,
  resolveSelection,
  withChoice,
  EMPTY_STATE,
  StateError,
  type PersistedState,
  type StateStore,
} from './state.ts'
export type {
  CapabilityVerdict,
  ModelCatalogEntry,
  ModelInput,
  ModelParam,
  ModelParamType,
  ModelRoute,
  ModelToolSpec,
  ModelSkillSpec,
  WindowsSupport,
} from './types.ts'