/**
 * The MCP host service and optional loopback endpoint.
 *
 * The HTTP/auth/subscription machinery lives under `src/mcp/`; this module owns
 * the lifecycle seam: expose `model-tools.mcp-host`, resolve the bearer/OAuth
 * choice and bind the configured endpoint without taking the host down.
 *
 * @module mcp-surface
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- SAFETY: the config values were parsed by the plugin schema; the cast at the provide seam is the DSH service boundary. */

import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientCredentialStore } from './mcp/credential-store.ts'
import { selectHttpAuth } from './mcp/auth-selection.ts'
import { startHttpServer, type BoundEndpoint } from './mcp/http.ts'
import type { McpHost } from './mcp/server.ts'

/** The endpoint the server returned. */
export type McpEndpoint = BoundEndpoint

/** The MCP configuration this seam reads. */
export interface McpSurfaceConfig {
  readonly enabled?: boolean | undefined
  readonly tokenFile?: string | undefined
  readonly host?: string | undefined
  readonly port?: number | undefined
  readonly path?: string | undefined
  readonly allowedOrigins?: readonly string[] | undefined
  readonly grants?: Readonly<Record<string, unknown>> | undefined
  readonly auth?: {
    readonly mode?: string | undefined
    readonly authorizationServerProfile?: unknown
  } | undefined
}

/** What the MCP surface needs from the composition root. */
export interface McpSurfaceDeps {
  readonly ctx: Context
  readonly mcpV3: McpSurfaceConfig | undefined
  readonly credentialStore: ClientCredentialStore | undefined
  readonly mcpHost: McpHost
  readonly onStarted: (endpoint: McpEndpoint) => void
}

/**
 * Expose the MCP host and, when enabled, serve it on loopback.
 * @param deps - host, config and credential store.
 */
export async function startMcpSurface(deps: McpSurfaceDeps): Promise<void> {
  const ctx = deps.ctx
  const config = { mcpV3: deps.mcpV3 }
  const credentialStore = deps.credentialStore
  const mcpHost = deps.mcpHost
  const onStarted = deps.onStarted
try {
  ;(ctx as unknown as { provide?: (name: string, value: unknown) => void }).provide?.('model-tools.mcp-host', mcpHost)
} catch (error) {
  ctx.logger?.warn?.(
    `model-tools: could not expose the MCP host service: ${error instanceof Error ? error.message : String(error)}`,
  )
}

/**
 * SERVE the host's MCP surface on loopback when the operator enables it (MCP-02).
 *
 * The plugin has always EXPOSED `model-tools.mcp-host`; nothing bound a port, so an
 * MCP client could only reach the separate headless composition. With
 * `mcpV3.enabled` the SAME surface is served here, so dispatch, per-client grants and
 * receipts stay in DSH. Credentials come from `DSH_TOOL_MODE_MCP_TOKEN` (the operator
 * token) and, when present, the generated-credential store — the raw token is never
 * configuration. A missing token or a port conflict is LOGGED and the host keeps
 * running (RUN-06); it never takes the session down.
 */
if (config.mcpV3?.enabled === true) {
  /**
   * The bearer token: the launch environment WINS (it is the explicit override), then
   * the operator's token FILE. The file route exists because a desktop-launched host
   * inherits an environment the operator cannot change; without it, enabling MCP in a
   * profile had no effect until the app was launched with a special variable.
   */
  const envToken = process.env.DSH_TOOL_MODE_MCP_TOKEN
  const configuredTokenFile = config.mcpV3.tokenFile ?? ''
  let fileToken = ''
  if (configuredTokenFile.length > 0) {
    try {
      fileToken = readFileSync(configuredTokenFile, 'utf8').trim()
    } catch (error) {
      ctx.logger.warn(
        `model-tools: could not read mcpV3.tokenFile ${configuredTokenFile}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const mcpToken = envToken !== undefined && envToken.length > 0 ? envToken : fileToken
  const authSelection = selectHttpAuth({
    ...config.mcpV3.auth?.mode === undefined ? {} : { mode: config.mcpV3.auth.mode },
    ...config.mcpV3.auth?.authorizationServerProfile === undefined
      ? {}
      : { profile: config.mcpV3.auth.authorizationServerProfile },
    token: mcpToken,
    ...credentialStore === undefined ? {} : { store: credentialStore },
  })
  if (!authSelection.ok) {
    ctx.logger.warn(`model-tools: ${authSelection.reason}; no MCP endpoint is served`)
  } else {
    try {
      const endpoint = await startHttpServer({
        host: config.mcpV3.host ?? '127.0.0.1',
        port: config.mcpV3.port ?? 3765,
        path: config.mcpV3.path ?? '/mcp',
        maxBodyBytes: 4 * 1024 * 1024,
        allowedOrigins: config.mcpV3.allowedOrigins ?? [],
        auth: authSelection.auth,
        grants: config.mcpV3.grants ?? {},
      }, mcpHost)
      // TASK-13: the status surface reports the ACTUAL bound endpoint (port 0 is
      // resolved to the OS-assigned port by startHttpServer), never the config.
      onStarted(endpoint)
      ctx.effect(() => () => { void endpoint.close() })
      try {
        ;(ctx as unknown as { provide?: (name: string, value: unknown) => void })
          .provide?.('model-tools.mcp-endpoint', endpoint)
      } catch (error) {
        ctx.logger?.warn?.(
          `model-tools: could not expose the MCP endpoint service: `
          + `${error instanceof Error ? error.message : String(error)}`,
        )
      }
      ctx.logger.info(`model-tools: MCP endpoint ${endpoint.url}`)
    } catch (error) {
      ctx.logger.warn(
        `model-tools: could not serve MCP on ${config.mcpV3.host ?? '127.0.0.1'}:`
        + `${String(config.mcpV3.port ?? 3765)}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
}
