/**
 * The single source of truth for the `modelTools` Remote namespace.
 *
 * Three artifacts are built from this module and must never drift:
 * - `typert.host.mjs`: the Host Loader face the `typert-loader` registers as
 *   strict invocation descriptors (`./typert` package export);
 * - `typert.remote-client.mjs`: the mountable Client contribution (`./remote`);
 * - `client/client.model-tools.js`: the package-local lazy-CJS chunk the
 *   plugin's browser half loads with `require.async('./client.model-tools.js')`
 *   (the client module system serves only `./client`, so the contribution the
 *   page mounts travels as a sibling chunk).
 *
 * The wire method for install is `installExtension`, not `install`: DSH's
 * client RemoteNamespaceService owns a private method `install` and refuses a
 * descriptor method that collides with it. The Host service keeps its member
 * name `install`; the descriptor's `implementation` maps the two.
 *
 * These functions stay dependency-free and self-contained because
 * `scripts/gen-remote-artifacts.mjs` inlines their source into the browser
 * chunk; changing one to reference an enclosing binding breaks the chunk.
 */

/** npm package that owns the namespace. */
export const PACKAGE = '@try-works/dsh-tool-mode'
/** Cordis service key the Host dispatch resolves. */
export const SERVICE = 'modelTools'
/** Wire namespace exposed as `ctx.remote.modelTools`. */
export const NAMESPACE = 'modelTools'
/** Browser-facing install method (see the collision note above). */
export const INSTALL_WIRE_METHOD = 'installExtension'

/** Structural validators for the JSON values the wire carries. */
const STRING = { kind: 'string' }
const BOOLEAN = { kind: 'boolean' }
const NULLABLE_STRING = { kind: 'nullable', of: STRING }
const STRING_LIST = { kind: 'array', of: STRING }
const INTEGRITY = {
  kind: 'union',
  of: [
    { kind: 'literal', value: 'unchanged' },
    { kind: 'literal', value: 'changed' },
    { kind: 'literal', value: 'unknown' },
  ],
}
/** The preflight prerequisite vocabulary (`extensions-api.ts` task-92). */
const REQUIREMENT_KIND = {
  kind: 'union',
  of: [
    'store',
    'source',
    'dependencies',
    'runtime',
    'assets',
    'executable',
    'harness-model',
    'platform',
    'integrity',
    'activation',
  ].map(value => ({ kind: 'literal', value })),
}
/** The action that clears an unmet requirement. */
const REQUIREMENT_ACTION = {
  kind: 'union',
  of: ['install', 'prepare', 'enable', 'config', 'none'].map(value => ({ kind: 'literal', value })),
}
const EXTENSION_REQUIREMENT = {
  kind: 'object',
  fields: {
    kind: REQUIREMENT_KIND,
    satisfied: BOOLEAN,
    reason: STRING,
    action: REQUIREMENT_ACTION,
  },
}
/**
 * One extension row.
 *
 * `requirements` and `blocked` are ADDITIVE against the older row shape: both
 * are optional here so a Host that predates the requirements model still
 * validates. The browser half treats an absent `requirements` as "the host did
 * not check" (no invented rows) and an absent `blocked` as false.
 */
const EXTENSION_STATE = {
  kind: 'object',
  fields: {
    id: STRING,
    package: NULLABLE_STRING,
    version: NULLABLE_STRING,
    installed: BOOLEAN,
    active: BOOLEAN,
    disabled: BOOLEAN,
    integrity: INTEGRITY,
    tools: STRING_LIST,
    reason: NULLABLE_STRING,
    requirements: { kind: 'optional', of: { kind: 'array', of: EXTENSION_REQUIREMENT } },
    blocked: { kind: 'optional', of: BOOLEAN },
  },
}
const DESCRIBE_RESULT = {
  kind: 'object',
  fields: {
    store: NULLABLE_STRING,
    writable: BOOLEAN,
    sourceDir: NULLABLE_STRING,
    extensions: { kind: 'array', of: EXTENSION_STATE },
  },
}
/**
 * The install result.
 *
 * `source` and `resolvedVersion` are ADDITIVE against the older result shape:
 * a Host that predates registry installs omits them and still validates. When
 * present the route is exactly `registry` or `directory`, and the resolved
 * version is the exact version the request resolved to.
 */
const INSTALL_RESULT = {
  kind: 'object',
  fields: {
    id: STRING,
    version: STRING,
    active: BOOLEAN,
    source: {
      kind: 'optional',
      of: {
        kind: 'union',
        of: [
          { kind: 'literal', value: 'registry' },
          { kind: 'literal', value: 'directory' },
        ],
      },
    },
    resolvedVersion: { kind: 'optional', of: STRING },
  },
}
const TOGGLE_RESULT = {
  kind: 'object',
  fields: { id: STRING, active: BOOLEAN, disabled: BOOLEAN },
}
const TOOL_TOGGLE_RESULT = {
  kind: 'object',
  fields: { id: STRING, toolName: STRING, enabled: BOOLEAN, active: BOOLEAN },
}
const UNINSTALL_RESULT = {
  kind: 'object',
  fields: { id: STRING, removed: BOOLEAN, active: BOOLEAN },
}
const OPTIONAL_STRING = { kind: 'optional', of: STRING }
const NUMBER = { kind: 'number' }
/** The readiness vocabulary from `extensions-api.ts` (EXT-25 / RES-04). */
const MODEL_READINESS = {
  kind: 'union',
  of: ['unavailable', 'needs-preparation', 'preparing', 'prepared-cold', 'loading', 'ready', 'busy', 'failed']
    .map(value => ({ kind: 'literal', value })),
}
const PREPARATION_ASSET = {
  kind: 'object',
  fields: { assetId: STRING, bytes: NUMBER, source: STRING, executable: BOOLEAN },
}
const PREPARATION_LICENSE = {
  kind: 'object',
  fields: { name: STRING, url: STRING },
}
const PREPARATION_PLAN = {
  kind: 'object',
  fields: {
    modelId: STRING,
    modelRevision: STRING,
    assets: { kind: 'array', of: PREPARATION_ASSET },
    totalBytes: NUMBER,
    storageBytes: NUMBER,
    requiresExecutableApproval: BOOLEAN,
    license: PREPARATION_LICENSE,
  },
}
const PREPARE_RESULT = {
  kind: 'object',
  fields: {
    id: STRING,
    prepared: BOOLEAN,
    reason: NULLABLE_STRING,
    plan: { kind: 'nullable', of: PREPARATION_PLAN },
    readiness: { kind: 'record', of: MODEL_READINESS },
    groups: STRING_LIST,
    activationReady: BOOLEAN,
  },
}

/** Tool Insights additions (task-13): additive methods on the same namespace. */
const NULLABLE_NUMBER = { kind: 'nullable', of: NUMBER }
const NULLABLE_BOOLEAN = { kind: 'nullable', of: BOOLEAN }
const OPTIONAL_NUMBER = { kind: 'optional', of: NUMBER }
const OPTIONAL_STRING_FIELD = { kind: 'optional', of: STRING }
const TOOL_KIND = {
  kind: 'union',
  of: ['built-in', 'extension', 'tool-mode', 'mcp', 'unknown'].map(value => ({ kind: 'literal', value })),
}
const TOOL_ORIGIN = {
  kind: 'union',
  of: ['dsh-core', 'extension', 'tool-mode', 'mcp', 'unknown'].map(value => ({ kind: 'literal', value })),
}
const INVENTORY_STATE = {
  kind: 'union',
  of: ['active', 'prepared-cold', 'failed'].map(value => ({ kind: 'literal', value })),
}
const TOOL_SOURCE = {
  kind: 'object',
  fields: { name: STRING, description: STRING, owner: STRING, kind: TOOL_KIND, origin: TOOL_ORIGIN },
}
const TOOL_SOURCES_RESULT = { kind: 'object', fields: { tools: { kind: 'array', of: TOOL_SOURCE } } }
const TOOL_INVENTORY_ROW = {
  kind: 'object',
  fields: {
    name: STRING,
    description: STRING,
    owner: STRING,
    kind: TOOL_KIND,
    origin: TOOL_ORIGIN,
    state: INVENTORY_STATE,
    extension: NULLABLE_STRING,
    version: NULLABLE_STRING,
    extensionVersion: NULLABLE_STRING,
    contractVersion: NULLABLE_STRING,
    argumentCount: NUMBER,
    lastRegistered: NULLABLE_NUMBER,
    mcpExposed: BOOLEAN,
    calls: NUMBER,
    success: NUMBER,
    lastUsed: NULLABLE_NUMBER,
  },
}
const TOOL_INVENTORY_RESULT = { kind: 'object', fields: { tools: { kind: 'array', of: TOOL_INVENTORY_ROW } } }
const USAGE_RANGE = {
  kind: 'union',
  of: ['24h', '7d', '30d', 'all'].map(value => ({ kind: 'literal', value })),
}
const RECENT_CALL = {
  kind: 'object',
  fields: {
    time: NUMBER,
    name: STRING,
    owner: STRING,
    model: STRING,
    ms: NULLABLE_NUMBER,
    ok: NULLABLE_BOOLEAN,
    errorCode: NULLABLE_STRING,
    kind: { kind: 'union', of: [{ kind: 'literal', value: 'direct' }, { kind: 'literal', value: 'code' }] },
    callId: STRING,
    parentCallId: NULLABLE_STRING,
    sessionId: STRING,
    workspace: NULLABLE_STRING,
  },
}
const USAGE_TOOL_ROW = {
  kind: 'object',
  fields: {
    name: STRING,
    owner: STRING,
    calls: NUMBER,
    errors: NUMBER,
    unsettled: NUMBER,
    codeCalls: NUMBER,
    directCalls: NUMBER,
    totalMs: NUMBER,
    maxMs: NUMBER,
    p50: NULLABLE_NUMBER,
    p95: NULLABLE_NUMBER,
    firstUsed: NULLABLE_NUMBER,
    lastUsed: NULLABLE_NUMBER,
    argsBytes: NUMBER,
    resultBytes: NUMBER,
  },
}
const USAGE_MODEL_ROW = {
  kind: 'object',
  fields: { model: STRING, calls: NUMBER, errors: NUMBER, tools: NUMBER, ms: NUMBER, p50: NULLABLE_NUMBER, p95: NULLABLE_NUMBER },
}
const USAGE_WORKSPACE_ROW = {
  kind: 'object',
  fields: { workspace: STRING, sessions: NUMBER, calls: NUMBER, errors: NUMBER, ms: NUMBER },
}
const USAGE_DAY_ROW = {
  kind: 'object',
  fields: { day: STRING, calls: NUMBER, errors: NUMBER, ms: NUMBER, unsettled: NUMBER },
}
const USAGE_ERROR_CODE_ROW = { kind: 'object', fields: { code: STRING, calls: NUMBER } }
const USAGE_REPORT = {
  kind: 'object',
  fields: {
    range: USAGE_RANGE,
    from: NUMBER,
    to: NUMBER,
    calls: NUMBER,
    errors: NUMBER,
    unsettled: NUMBER,
    toolMs: NUMBER,
    codeCalls: NUMBER,
    sessions: NUMBER,
    uniqueTools: NUMBER,
    successRate: NULLABLE_NUMBER,
    p50: NULLABLE_NUMBER,
    p95: NULLABLE_NUMBER,
    tools: { kind: 'array', of: USAGE_TOOL_ROW },
    models: { kind: 'array', of: USAGE_MODEL_ROW },
    days: { kind: 'array', of: USAGE_DAY_ROW },
    workspaces: { kind: 'array', of: USAGE_WORKSPACE_ROW },
    errorCodes: { kind: 'array', of: USAGE_ERROR_CODE_ROW },
    recentCalls: { kind: 'array', of: RECENT_CALL },
    histogramScope: { kind: 'literal', value: 'retained' },
  },
}
const USAGE_REPORT_QUERY = {
  kind: 'object',
  fields: {
    range: { kind: 'optional', of: USAGE_RANGE },
    from: OPTIONAL_NUMBER,
    to: OPTIONAL_NUMBER,
  },
}
const MCP_CALL = {
  kind: 'object',
  fields: {
    time: NUMBER,
    tool: STRING,
    clientId: STRING,
    grantId: NULLABLE_STRING,
    totalMs: NUMBER,
    queuedMs: NUMBER,
    loadMs: NUMBER,
    inferenceMs: NUMBER,
    failureClass: STRING,
    reason: NULLABLE_STRING,
    inputBytes: NUMBER,
    outputBytes: NUMBER,
    receiptId: STRING,
  },
}
const MCP_CALLS_RESULT = {
  kind: 'object',
  fields: {
    calls: { kind: 'array', of: MCP_CALL },
    total: NUMBER,
    page: NUMBER,
    pageSize: NUMBER,
    clients: STRING_LIST,
  },
}
const MCP_CALLS_QUERY = {
  kind: 'object',
  fields: {
    clientId: OPTIONAL_STRING_FIELD,
    page: OPTIONAL_NUMBER,
    pageSize: OPTIONAL_NUMBER,
  },
}
const MCP_ENDPOINT = { kind: 'object', fields: { host: STRING, port: NUMBER, path: STRING, url: STRING } }
const MCP_CONFIGURED = { kind: 'object', fields: { host: STRING, port: NUMBER, path: STRING } }
const MCP_AUTH_MODE = {
  kind: 'union',
  of: ['static-token', 'oauth-resource-server', 'none'].map(value => ({ kind: 'literal', value })),
}
const MCP_STATUS_RESULT = {
  kind: 'object',
  fields: {
    enabled: BOOLEAN,
    listening: BOOLEAN,
    endpoint: { kind: 'nullable', of: MCP_ENDPOINT },
    configured: { kind: 'nullable', of: MCP_CONFIGURED },
    transport: { kind: 'literal', value: 'http' },
    auth: { kind: 'object', fields: { scheme: MCP_AUTH_MODE, mode: MCP_AUTH_MODE, tokenFile: NULLABLE_STRING } },
    uptimeMs: NUMBER,
    clients: {
      kind: 'array',
      of: {
        kind: 'object',
        fields: {
          clientId: STRING,
          id: STRING,
          label: STRING,
          grantId: NULLABLE_STRING,
          calls: NUMBER,
          errors: NUMBER,
          lastSeen: NULLABLE_NUMBER,
        },
      },
    },
    exposed: STRING_LIST,
    withheld: STRING_LIST,
    exposedCount: NUMBER,
    withheldCount: NUMBER,
  },
}

const CUSTOM_TOOL_SUMMARY = {
  kind: 'object',
  fields: {
    id: STRING,
    name: STRING,
    title: STRING,
    description: STRING,
    kind: { kind: 'union', of: ['http', 'prompt', 'composite'].map(value => ({ kind: 'literal', value })) },
    version: NUMBER,
    enabled: BOOLEAN,
    agentExpose: BOOLEAN,
    mcpExpose: BOOLEAN,
    updatedAt: STRING,
  },
}
const CUSTOM_TOOLS_SNAPSHOT = {
  kind: 'object',
  fields: {
    store: STRING,
    writable: BOOLEAN,
    tools: { kind: 'array', of: CUSTOM_TOOL_SUMMARY },
  },
}
const CUSTOM_TOOL_TEST_RESULT = {
  kind: 'object',
  fields: {
    ok: BOOLEAN,
    value: { kind: 'optional', of: { kind: 'json' } },
    error: {
      kind: 'optional',
      of: { kind: 'object', fields: { code: STRING, message: STRING } },
    },
  },
}

/**
 * Validate one boundary value against the declarative schema.
 * @param schema - schema node from the METHOD_SPECS data.
 * @param value - untrusted boundary value.
 * @returns the validated value; objects are rebuilt without undeclared fields.
 * @throws TypeError when the value does not match.
 */
export function parseModelToolsValue(schema, value) {
  switch (schema.kind) {
    case 'string':
      if (typeof value !== 'string') throw new TypeError('expected a string')
      return value
    case 'boolean':
      if (typeof value !== 'boolean') throw new TypeError('expected a boolean')
      return value
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('expected a finite number')
      return value
    case 'json':
      return value
    case 'null':
      if (value !== null) throw new TypeError('expected null')
      return null
    case 'literal':
      if (value !== schema.value) throw new TypeError('expected ' + JSON.stringify(schema.value))
      return value
    case 'optional':
      return value === undefined ? undefined : parseModelToolsValue(schema.of, value)
    case 'nullable':
      return value === null ? null : parseModelToolsValue(schema.of, value)
    case 'array':
      if (!Array.isArray(value)) throw new TypeError('expected an array')
      return value.map((item) => parseModelToolsValue(schema.of, item))
    case 'record': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('expected a string-keyed record')
      }
      const parsed = {}
      for (const [key, item] of Object.entries(value)) parsed[key] = parseModelToolsValue(schema.of, item)
      return parsed
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('expected an object')
      }
      const parsed = {}
      for (const [key, field] of Object.entries(schema.fields)) {
        const raw = value[key]
        if (field.kind === 'optional') {
          const item = parseModelToolsValue(field, raw)
          if (item !== undefined) parsed[key] = item
          continue
        }
        if (raw === undefined) throw new TypeError('missing field ' + JSON.stringify(key))
        parsed[key] = parseModelToolsValue(field, raw)
      }
      return parsed
    }
    case 'union': {
      let last
      for (const variant of schema.of) {
        try {
          return parseModelToolsValue(variant, value)
        } catch (error) {
          last = error
        }
      }
      throw new TypeError('value matched no union variant: ' + last.message)
    }
    default:
      throw new TypeError('unknown schema kind ' + JSON.stringify(schema.kind))
  }
}

/**
 * Build one strict boundary codec from a declarative schema.
 * @param typeSymbol - stable type identity recorded on the codec.
 * @param schema - declarative schema the parser enforces.
 * @returns strict codec with a cached parser factory.
 */
export function codecForModelToolsValue(typeSymbol, schema) {
  let parser
  return {
    mode: 'strict',
    typeSymbol,
    create: () => (parser ??= { parse: (value) => parseModelToolsValue(schema, value) }),
  }
}

/**
 * Turn the static method specs into Host/client invocation descriptors.
 * @param packageName - owning npm package.
 * @param serviceKey - Cordis service key the Host dispatch resolves.
 * @param namespace - wire namespace (also the Client Remote service suffix).
 * @param specs - METHOD_SPECS.
 * @returns fresh descriptors both the Host registry and the Client mount accept.
 */
export function descriptorsFromModelToolsSpecs(packageName, serviceKey, namespace, specs) {
  return specs.map((spec) => {
    const descriptor = {
      id: packageName + '#' + namespace + '/' + spec.method,
      service: serviceKey,
      namespace,
      method: spec.method,
      description: spec.description,
      invocation: { kind: 'direct' },
      parameters: spec.parameters.map((parameter) => {
        const entry = {
          name: parameter.name,
          wire: parameter.wire,
          source: 'json',
          codec: codecForModelToolsValue(parameter.typeSymbol, parameter.schema),
          strictCodec: codecForModelToolsValue(parameter.strictTypeSymbol, parameter.schema),
        }
        if (parameter.description !== undefined) entry.description = parameter.description
        if (parameter.acceptsUndefined === true) entry.acceptsUndefined = true
        return entry
      }),
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: spec.result.typeSymbol,
        create: codecForModelToolsValue(spec.result.typeSymbol, spec.result.schema).create,
        description: spec.result.description,
      },
    }
    if (spec.implementation !== undefined) descriptor.implementation = spec.implementation
    return descriptor
  })
}

/** Static method specs. JSON-safe so the browser chunk can embed them verbatim. */
export const METHOD_SPECS = [
  {
    method: 'describe',
    description: 'Read the current extension state; the page calls it on mount and after each action.',
    parameters: [],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/describe:result',
      description: 'the extension surface as the host currently sees it.',
      schema: DESCRIBE_RESULT,
    },
  },
  {
    method: INSTALL_WIRE_METHOD,
    implementation: 'install',
    description: 'Install one extension from `source`, or the configured first-party source.',
    parameters: [
      {
        name: 'id',
        wire: 'id',
        description: 'the extension id, for example `@try-works/extension-laya`.',
        acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/install:id',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/install:id',
        schema: STRING,
      },
      {
        name: 'source',
        wire: 'source',
        description: 'an explicit install directory; absent means the configured first-party source.',
        acceptsUndefined: true,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/install:source',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/install:source',
        schema: OPTIONAL_STRING,
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/install:result',
      description: 'the installed extension; installation is not activation.',
      schema: INSTALL_RESULT,
    },
  },
  {
    method: 'enable',
    description: 'Activate an installed extension (removes it from `disabledExtensions`).',
    parameters: [
      {
        name: 'id',
        wire: 'id',
        description: 'the extension id to activate.',
        acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/enable:id',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/enable:id',
        schema: STRING,
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/enable:result',
      description: 'the extension state after activation.',
      schema: TOGGLE_RESULT,
    },
  },
  {
    method: 'disable',
    description: 'Deactivate an extension (adds it to `disabledExtensions`).',
    parameters: [
      {
        name: 'id',
        wire: 'id',
        description: 'the extension id to deactivate.',
        acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/disable:id',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/disable:id',
        schema: STRING,
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/disable:result',
      description: 'the extension state after deactivation.',
      schema: TOGGLE_RESULT,
    },
  },
  {
    method: 'prepare',
    description: 'Acquire and verify the installed extension\'s model assets, then record the readiness a following enable needs.',
    parameters: [
      {
        name: 'id',
        wire: 'id',
        description: 'the installed extension id to prepare.',
        acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/prepare:id',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/prepare:id',
        schema: STRING,
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/prepare:result',
      description: 'the preparation outcome, its RES-02 disclosure, and the readiness recorded for each declared model.',
      schema: PREPARE_RESULT,
    },
  },
  {
    method: 'setToolEnabled',
    description: 'Enable or disable ONE tool of an installed extension through the running host.',
    parameters: [
      {
        name: 'id',
        wire: 'id',
        description: 'the extension id.',
        acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/setToolEnabled:id',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/setToolEnabled:id',
        schema: STRING,
      },
      {
        name: 'toolName',
        wire: 'toolName',
        description: 'the caller-facing tool name to toggle.',
        acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/setToolEnabled:toolName',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/setToolEnabled:toolName',
        schema: STRING,
      },
      {
        name: 'enabled',
        wire: 'enabled',
        description: 'the desired enabled state.',
        acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/setToolEnabled:enabled',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/setToolEnabled:enabled',
        schema: BOOLEAN,
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/setToolEnabled:result',
      description: 'the extension, tool and state after the toggle.',
      schema: TOOL_TOGGLE_RESULT,
    },
  },
  {
    method: 'uninstall',
    description: 'Uninstall an extension through the running host; an active extension requires explicit deactivation.',
    parameters: [
      {
        name: 'id',
        wire: 'id',
        description: 'the extension id.',
        acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/uninstall:id',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/uninstall:id',
        schema: STRING,
      },
      {
        name: 'deactivate',
        wire: 'deactivate',
        description: 'whether to deactivate first; absent means false.',
        acceptsUndefined: true,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/uninstall:deactivate',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/uninstall:deactivate',
        schema: { kind: 'optional', of: BOOLEAN },
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/uninstall:result',
      description: 'the extension removed and its resulting active state.',
      schema: UNINSTALL_RESULT,
    },
  },
  {
    method: 'toolSources',
    description: 'List the registered tools with owner attribution (extension, Tool Mode, MCP, pinned first party, unknown).',
    parameters: [],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/toolSources:result',
      description: 'the tool catalog with owner attribution.',
      schema: TOOL_SOURCES_RESULT,
    },
  },
  {
    method: 'toolInventory',
    description: 'Read the live tool inventory: registered tools plus installed extension tools, with state, kind and usage.',
    parameters: [],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/toolInventory:result',
      description: 'every inventory row, including tools that were never called.',
      schema: TOOL_INVENTORY_RESULT,
    },
  },
  {
    method: 'mcpStatus',
    description: 'Read the MCP surface status: the bound endpoint, auth mode, clients, and exposed/withheld tools.',
    parameters: [],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/mcpStatus:result',
      description: 'the MCP status derived from the bound endpoint, identities, surface and ledger.',
      schema: MCP_STATUS_RESULT,
    },
  },
  {
    method: 'mcpCalls',
    description: 'Read the external MCP call log, newest first, from the persisted ledger.',
    parameters: [
      {
        name: 'query',
        wire: 'query',
        description: 'an optional client filter and page; absent means page 1 with the default size.',
        acceptsUndefined: true,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/mcpCalls:query',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/mcpCalls:query',
        schema: { kind: 'optional', of: MCP_CALLS_QUERY },
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/mcpCalls:result',
      description: 'one page of external calls plus the matching total and ledger client identities.',
      schema: MCP_CALLS_RESULT,
    },
  },
  {
    method: 'toolUsageReport',
    description: 'Aggregate tool usage over an explicit range from the session projection detail.',
    parameters: [
      {
        name: 'query',
        wire: 'query',
        description: 'an optional named range or explicit from/to epoch milliseconds.',
        acceptsUndefined: true,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/toolUsageReport:query',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/toolUsageReport:query',
        schema: { kind: 'optional', of: USAGE_REPORT_QUERY },
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/toolUsageReport:result',
      description: 'the range rollups: totals, by tool/model/owner/workspace/day/error code, and recent calls.',
      schema: USAGE_REPORT,
    },
  },
  {
    method: 'customToolsDescribe',
    description: 'List the profile-scoped custom tools and their enabled/exposure state.',
    parameters: [],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsDescribe:result',
      description: 'the custom-tool store and its active records.',
      schema: CUSTOM_TOOLS_SNAPSHOT,
    },
  },
  {
    method: 'customToolsGet',
    description: 'Read one full custom-tool record for editing; credential values are never included.',
    parameters: [{
      name: 'id', wire: 'id', description: 'custom-tool id.', acceptsUndefined: false,
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsGet:id',
      strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsGet:id', schema: STRING,
    }],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsGet:result',
      description: 'the active record, or null when it is not present.',
      schema: { kind: 'nullable', of: { kind: 'json' } },
    },
  },
  {
    method: 'customToolsDraft',
    description: 'Ask the host model to draft a custom tool from a description; never saves or executes it.',
    parameters: [{
      name: 'description', wire: 'description', description: 'natural-language description.', acceptsUndefined: false,
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsDraft:description',
      strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsDraft:description', schema: STRING,
    }],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsDraft:result',
      description: 'a validated draft or a named failure; the draft is not saved.',
      schema: { kind: 'json' },
    },
  },
  {
    method: 'customToolsValidate',
    description: 'Validate a custom-tool draft without persisting or executing it.',
    parameters: [{
      name: 'draft',
      wire: 'draft',
      description: 'the user-authored draft.',
      acceptsUndefined: false,
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsValidate:draft',
      strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsValidate:draft',
      schema: { kind: 'json' },
    }],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsValidate:result',
      description: 'the validation verdict and field issues.',
      schema: { kind: 'object', fields: { ok: BOOLEAN, issues: { kind: 'array', of: { kind: 'object', fields: { path: STRING, message: STRING } } } } },
    },
  },
  {
    method: 'customToolsTest',
    description: 'Execute a custom-tool draft once with sample arguments; never persists or registers it.',
    parameters: [
      {
        name: 'draft', wire: 'draft', description: 'the draft to execute.', acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsTest:draft',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsTest:draft', schema: { kind: 'json' },
      },
      {
        name: 'args', wire: 'args', description: 'sample arguments.', acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsTest:args',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsTest:args', schema: { kind: 'json' },
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsTest:result',
      description: 'the test value or a named failure.',
      schema: CUSTOM_TOOL_TEST_RESULT,
    },
  },
  {
    method: 'customToolsSave',
    description: 'Validate, persist and register a new immutable custom-tool version.',
    parameters: [{
      name: 'draft', wire: 'draft', description: 'the draft to save.', acceptsUndefined: false,
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsSave:draft',
      strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsSave:draft', schema: { kind: 'json' },
    }],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsSave:result',
      description: 'the persisted record.',
      schema: { kind: 'json' },
    },
  },
  {
    method: 'customToolsSetEnabled',
    description: 'Enable or disable a saved custom tool and reconcile its registration.',
    parameters: [
      {
        name: 'id', wire: 'id', description: 'custom-tool id.', acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsSetEnabled:id',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsSetEnabled:id', schema: STRING,
      },
      {
        name: 'enabled', wire: 'enabled', description: 'desired state.', acceptsUndefined: false,
        typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsSetEnabled:enabled',
        strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsSetEnabled:enabled', schema: BOOLEAN,
      },
    ],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsSetEnabled:result',
      description: 'the updated record.',
      schema: { kind: 'json' },
    },
  },
  {
    method: 'customToolsDelete',
    description: 'Delete the active pointer for a custom tool and remove its registration.',
    parameters: [{
      name: 'id', wire: 'id', description: 'custom-tool id.', acceptsUndefined: false,
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsDelete:id',
      strictTypeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsDelete:id', schema: STRING,
    }],
    result: {
      typeSymbol: PACKAGE + '#' + NAMESPACE + '/customToolsDelete:result',
      description: 'whether an active record was removed.',
      schema: BOOLEAN,
    },
  },
]

/** The mountable Client contribution (and the Host artifact's invocation source). */
export function buildContribution() {
  return {
    package: PACKAGE,
    descriptors: descriptorsFromModelToolsSpecs(PACKAGE, SERVICE, NAMESPACE, METHOD_SPECS),
  }
}

/** Host documentation for the methods, kept beside their specs. */
const METHOD_SIGNATURES = {
  describe: 'describe(signal?: AbortSignal): Promise<ExtensionsDescribeResult>',
  installExtension: 'install(id: string, source?: string, signal?: AbortSignal): Promise<ExtensionInstallResult>',
  enable: 'enable(id: string, signal?: AbortSignal): Promise<ExtensionToggleResult>',
  disable: 'disable(id: string, signal?: AbortSignal): Promise<ExtensionToggleResult>',
  prepare: 'prepare(id: string, signal?: AbortSignal): Promise<ExtensionPrepareResult>',
  setToolEnabled: 'setToolEnabled(id: string, toolName: string, enabled: boolean, signal?: AbortSignal): Promise<ExtensionToolToggleResult>',
  uninstall: 'uninstall(id: string, deactivate?: boolean, signal?: AbortSignal): Promise<ExtensionUninstallResult>',
  toolSources: 'toolSources(signal?: AbortSignal): Promise<ToolSourcesResult>',
  toolInventory: 'toolInventory(signal?: AbortSignal): Promise<ToolInventoryResult>',
  mcpStatus: 'mcpStatus(signal?: AbortSignal): Promise<McpStatusView>',
  mcpCalls: 'mcpCalls(query?: McpCallsQuery, signal?: AbortSignal): Promise<McpCallsPage>',
  toolUsageReport: 'toolUsageReport(query?: UsageReportQuery, signal?: AbortSignal): Promise<UsageReport>',
  customToolsDescribe: 'customToolsDescribe(signal?: AbortSignal): Promise<CustomToolsSnapshot>',
  customToolsGet: 'customToolsGet(id: string, signal?: AbortSignal): Promise<unknown | null>',
  customToolsDraft: 'customToolsDraft(description: string, signal?: AbortSignal): Promise<unknown>',
  customToolsValidate: 'customToolsValidate(draft: unknown, signal?: AbortSignal): Promise<CustomToolValidation>',
  customToolsTest: 'customToolsTest(draft: unknown, args: unknown, signal?: AbortSignal): Promise<CustomToolTestResult>',
  customToolsSave: 'customToolsSave(draft: unknown, signal?: AbortSignal): Promise<unknown>',
  customToolsSetEnabled: 'customToolsSetEnabled(id: string, enabled: boolean, signal?: AbortSignal): Promise<unknown>',
  customToolsDelete: 'customToolsDelete(id: string, signal?: AbortSignal): Promise<boolean>',
}

const SERVICE_MODEL = {
  description: 'Host service backing the generated `ctx.remote.modelTools` namespace. It reports the extension store truthfully (store null when unconfigured), performs staged installs, persisted enable/disable, and model-asset preparation with the RES-02 disclosure. The ADDITIVE Tool Insights methods (toolSources/toolInventory/mcpStatus/mcpCalls/toolUsageReport) may be absent on an older host.',
  summary: 'Host service backing the generated `ctx.remote.modelTools` namespace.',
  tags: [],
  jsDoc: '/** Host service backing the generated `ctx.remote.modelTools` namespace. */',
  key: SERVICE,
  exportName: 'ExtensionsService',
  members: METHOD_SPECS.map((spec) => ({
    kind: 'method',
    name: spec.implementation ?? spec.method,
    signature: METHOD_SIGNATURES[spec.method],
    description: spec.description,
    jsDoc: `/** ${spec.description} */`,
  })),
  types: [],
}

/**
 * Build the Host Loader manifest the `typert-loader` validates and registers.
 * @returns `TYPERT` host-face contribution.
 */
export function buildHostManifest() {
  return {
    package: PACKAGE,
    face: 'host',
    schemas: [],
    get invocations() {
      return buildContribution().descriptors
    },
    model: {
      services: [SERVICE_MODEL],
      events: [],
      objects: [],
    },
  }
}
