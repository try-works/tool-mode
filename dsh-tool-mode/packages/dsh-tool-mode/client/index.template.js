// dsh-tool-mode browser half: the Settings -> Model as Tool page.
//
// Plain JavaScript by necessity: DSH's client module system serves this file to
// the page as a lazy-CJS bundle, so it IS the shipped artifact. The loader id is
// the PACKAGE name (the web client looks that up); the Cordis entry id
// (`model-tools`) is the settings namespace this page configures.
//
// Only 'react' is requested. Controls and styles are written here, using only
// theme tokens that exist on the shipped settings pages: a token that does not
// exist is dropped by the browser and the page degrades into undifferentiated
// prose.
//
// The model catalog is GENERATED INTO THIS FILE at build time (see
// client/index.template.js and scripts/gen-client-catalog.mjs): it carries the
// same entries model_tools reports, with the platform verdict resolved on the
// host that builds the package.
window.__ModuleLoader__.load({
  id: '@try-works/dsh-tool-mode',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // The chat cards, INLINED at build time from client/toolmode-toolview.js. A plugin's
    // client module service serves only the declared bundle file, so a sibling chunk is a
    // 404 and the cards would silently fall back to the generic tool card.
    /*__TOOLVIEW_SOURCE__*/
    const toolviews = createToolviews(h)

    // The Tool Insights page, INLINED at build time from client/tool-insights.js
    // for the same reason: a sibling chunk is a 404 and the page would vanish.
    /*__TOOL_INSIGHTS_SOURCE__*/
    const toolInsights = createToolInsights(h, React)

    /**
     * The catalog, embedded at build time by scripts/gen-client-catalog.mjs.
     *
     * Each entry: { id, name, summary, package, capability, sizeMB, license,
     * runnable, reason }. `runnable` is this host's capability verdict, so the
     * page can only offer toggles for models that can actually run and can say
     * why the rest cannot.
     */
    const CATALOG = /*__CATALOG_JSON__*/ []

    /**
     * The Tool Mode extensions this repository ships, embedded at build time.
     *
     * Each entry: { id, name, package, version, license, summary, models, tools,
     * contracts }. The host's extension store is the authority for
     * installed/active state, and it is reachable as `ctx.remote.modelTools`
     * when this client assembly mounts that Remote. When it does not, the page
     * degrades to the config-only `disabledExtensions` preference and says so:
     * it never invents an installed state.
     */
    const EXTENSIONS = /*__EXTENSIONS_JSON__*/ []

    /** Page styles, prefixed to avoid colliding with host styles. */
    const CSS = `
.mtt-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
  color: var(--dsw-alias-label-primary);
}
.mtt-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.mtt-intro {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-tertiary);
}
.mtt-card {
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  background: var(--dsw-alias-settings-card-fill);
  border-radius: var(--dsw-radius-xl);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mtt-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 0;
  border-top: 0.5px solid var(--dsw-alias-settings-card-stroke);
}
.mtt-row:first-of-type { border-top: none; }
.mtt-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mtt-label {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.mtt-name { font-weight: 500; }
.mtt-meta {
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-all;
}
.mtt-help {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.mtt-control { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
.mtt-input {
  box-sizing: border-box;
  width: 300px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
}
.mtt-input:disabled { opacity: 0.6; }
.mtt-toggle {
  width: 40px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid #C9CEDA;
  /* Off is a GREY track: the theme bg-layer token resolves to the page white,
     which made an off switch look like an empty hole (and indistinguishable from
     a disabled one). Explicit greys keep off/disabled readable on every theme. */
  background: #D6DAE2;
  position: relative;
  cursor: pointer;
  padding: 0;
  flex: 0 0 auto;
  transition: background 120ms ease, border-color 120ms ease;
}
.mtt-toggle[data-on='true'] { background: var(--dsw-alias-button-primary-fill); border-color: transparent; }
.mtt-toggle[data-on='true'] .mtt-knob { background: #FFFFFF; }
.mtt-toggle:disabled {
  cursor: not-allowed;
  /* Disabled is a LIGHTER grey than off, never the page white. */
  opacity: 1;
  background: #EDEFF2;
  border-color: #D5D9E0;
}
.mtt-toggle[data-on='true']:disabled {
  background: #B9C0CB;
  border-color: transparent;
}
.mtt-toggle:disabled .mtt-knob {
  background: #FFFFFF;
  opacity: 1;
}
.mtt-toggle[data-on='true']:disabled .mtt-knob {
  background: #F2F4F7;
}
.mtt-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #FFFFFF;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.25);
  transition: transform 120ms ease;
}
.mtt-toggle[data-on='true'] .mtt-knob { transform: translateX(18px); }
.mtt-badge {
  font-size: 11px;
  line-height: 16px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
}
.mtt-badge-on { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-tertiary); }
.mtt-row-note {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.mtt-row-error {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary));
}
.mtt-row-blocker {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary));
}
.mtt-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 8px;
}
.mtt-button {
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-inverted);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}
.mtt-button:disabled { opacity: 0.5; cursor: default; }
.mtt-button-small {
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
}
.mtt-status { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.mtt-status-ok { color: var(--dsw-alias-label-secondary); }
.mtt-status-error { color: var(--dsw-alias-label-primary); }
`

    // The settings namespace is the plugin's ENTRY ID (the bundle patch row id);
    // a hand-written row may use the package name, so both are tried in order.
    const NAMESPACES = ['model-tools', '@try-works/dsh-tool-mode']

    /** Global fields (per-model toggles are rendered from CATALOG). */
    const FIELDS = [
      {
        key: 'exposeUnavailable',
        kind: 'toggle',
        label: 'Expose unavailable models',
        help: 'Register a tool even when its runtime is missing, so a model turn can discover why it cannot run.',
      },
      {
        key: 'registerSkills',
        kind: 'toggle',
        label: 'Register skills',
        help: 'Publish one skill per registered tool, teaching when to use it.',
      },
      {
        key: 'registerControlTool',
        kind: 'toggle',
        label: 'Register the inspection tool',
        help: 'Expose the model_tools inspection surface to authorised native callers.',
      },
      {
        key: 'allowNpm',
        kind: 'toggle',
        label: 'Allow in-process packages',
        help: 'Resolve model packages from this installation. Turn off to force every call through the CLI or the bridge.',
      },
      {
        key: 'managedWorkers',
        kind: 'toggle',
        label: 'Managed workers',
        help: 'Run extension entries in a managed child process with a scrubbed environment.',
      },
      {
        key: 'repairAttempts',
        kind: 'number',
        label: 'Repair attempts',
        help: 'Bounded title-repair budget per call (0-8). Out-of-range values are refused, never clamped.',
      },
      {
        key: 'approvedRoots',
        kind: 'list',
        label: 'Approved roots',
        help: 'Comma-separated absolute paths file-reading tools may reach. Empty approves nothing.',
      },
      {
        key: 'models',
        kind: 'list',
        label: 'Allowlist override',
        help: 'Advanced: comma-separated model ids. Empty means every enabled model below; set only to pin an exact set.',
      },
    ]

    /** Read the value a field should display: the draft, else the saved value. */
    function fieldValue(field, value, draft) {
      if (draft[field.key] !== undefined) return draft[field.key]
      const saved = value[field.key]
      if (field.kind === 'list') return Array.isArray(saved) ? saved.join(', ') : ''
      if (field.kind === 'number') return saved === undefined || saved === null ? '' : String(saved)
      return saved === true
    }

    /** Parse one edited field back into its config representation. */
    function fieldPatch(field, text) {
      if (field.kind === 'list') {
        return text.split(',').map(part => part.trim()).filter(part => part.length > 0)
      }
      if (field.kind === 'number') return Number(text)
      return text
    }

    /** One global row: label + help on the left, the control on the right. */
    function fieldRow(field, value, draft, edit, disabled) {
      const current = fieldValue(field, value, draft)
      let control
      if (field.kind === 'toggle') {
        control = h('button', {
          type: 'button',
          className: 'mtt-toggle',
          'data-on': current === true ? 'true' : 'false',
          disabled,
          'aria-pressed': current === true,
          onClick: () => edit(field.key, !(current === true)),
        }, h('span', { className: 'mtt-knob' }))
      } else {
        control = h('input', {
          className: 'mtt-input',
          type: field.kind === 'number' ? 'number' : 'text',
          min: field.kind === 'number' ? 0 : undefined,
          max: field.kind === 'number' ? 8 : undefined,
          value: current,
          disabled,
          onChange: event => edit(field.key, event.target.value),
        })
      }
      return h('div', { className: 'mtt-row', key: field.key },
        h('div', { className: 'mtt-row-text' },
          h('span', { className: 'mtt-label' }, field.label),
          h('p', { className: 'mtt-help' }, field.help)),
        h('div', { className: 'mtt-control' }, control))
    }

    /** One model row: identity, package, size and status, with the toggle. */
    function modelRow(entry, enabled, disabled, onToggle) {
      // An extension-backed model is provided by another package; only the HOST
      // can tell whether it is installed, so the row says "extension" instead of
      // promising it runs here.
      const badge = entry.extension !== null && entry.extension !== undefined
        ? h('span', { className: 'mtt-badge' }, 'extension')
        : entry.runnable === true
          ? h('span', { className: 'mtt-badge mtt-badge-on' }, 'runnable here')
          : h('span', { className: 'mtt-badge' }, 'unavailable here')
      const source = entry.extension ?? (entry.package === null ? 'no package' : entry.package)
      return h('div', { className: 'mtt-row', key: entry.id },
        h('div', { className: 'mtt-row-text' },
          h('span', { className: 'mtt-label' },
            h('span', { className: 'mtt-name' }, entry.name),
            badge),
          h('p', { className: 'mtt-help' }, entry.summary),
          h('span', { className: 'mtt-meta' },
            entry.id,
            ' · ',
            source,
            entry.sizeMB === null ? '' : ' · ' + entry.sizeMB + ' MB',
            ' · ',
            entry.license,
            entry.extension !== null && entry.extension !== undefined
              ? ' · provided by the Tool Mode extension; install and activate it to run'
              : entry.runnable !== true && entry.reason ? ' · ' + entry.reason : '')),
        h('div', { className: 'mtt-control' },
          h('button', {
            type: 'button',
            className: 'mtt-toggle',
            'data-on': enabled ? 'true' : 'false',
            disabled: disabled,
            'aria-pressed': enabled,
            title: enabled ? 'Disable this model' : 'Enable this model',
            onClick: () => onToggle(entry.id, !enabled),
          }, h('span', { className: 'mtt-knob' }))))
    }

    /** How an in-flight Install/Enable/Disable is spelled in the card. */
    const EXTENSION_ACTION_LABELS = { install: 'Installing', prepare: 'Preparing', enable: 'Enabling', disable: 'Disabling' }

    // The extension Remote is a package-local lazy chunk (`client.model-tools.js`)
    // mounted by the wire half: it installs the generated Typert namespace on
    // ctx.remote as `modelTools`. It is optional on purpose — a host without the
    // Remote leaves the page on its config-only fallback.
    const REMOTE_CHUNK = './client.model-tools.js'

    // The namespace may arrive a moment after the page mounts (the chunk is
    // fetched, then the Remote contribution mounts). The first read retries
    // briefly, and the slot subscription below re-reads whenever the chunk's
    // mount settles, so a slow mount upgrades the card instead of stranding it.
    const REMOTE_RETRY_ATTEMPTS = 3
    const REMOTE_RETRY_DELAY_MS = 400

    /**
     * A tiny observable for the optional Remote mount.
     *
     * `apply()` cannot await the chunk before registering the Settings section:
     * on a host without the Remote the page must still render. So the mount runs
     * in the background and publishes its status here; the card subscribes and
     * re-reads when it changes.
     */
    function createRemoteSlot() {
      const listeners = new Set()
      let status = null
      return {
        get: () => status,
        set: next => {
          if (next === status) return
          status = next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              // A broken listener must not abort the mount or another listener.
            }
          }
        },
        subscribe: listener => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    /** Warn without letting a logger failure blank the page. */
    function warnClient(ctx, message) {
      try {
        if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message)
        else if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(message)
      } catch (error) {
        // A warning is diagnostics, never control flow.
      }
    }

    /**
     * Load the wire chunk and mount the optional `modelTools` namespace.
     *
     * Never throws into `apply`: a missing chunk (older host), a chunk that fails
     * to mount, or a host without `remote` all leave the slot unset, which is the
     * config-only fallback. The disposer is registered through ctx.effect so the
     * namespace unmounts with this plugin.
     */
    function mountExtensionRemote(ctx, slot) {
      const load = async () => {
        if (typeof require.async !== 'function') return
        const chunk = await require.async(REMOTE_CHUNK)
        if (chunk === null || chunk === undefined || typeof chunk.mount !== 'function') {
          throw new Error('the extension Remote chunk exposes no mount()')
        }
        const mounted = await chunk.mount(ctx)
        if (mounted === null || mounted === undefined) return
        if (typeof mounted.dispose === 'function') {
          ctx.effect(() => () => mounted.dispose(), 'model-tools: extension Remote')
        }
        slot.set(mounted)
      }
      load().catch(error => warnClient(ctx, 'model-tools: extension Remote unavailable: '
        + ((error && error.message) || String(error))))
    }

    /**
     * The extension Remote, when this client has one.
     *
     * The generated namespace is registered as the context service
     * `remote.modelTools`, so a direct service read is tried FIRST: the `remote`
     * service's associated-property lookup would resolve against this plugin's
     * own fiber and throw without an `inject`, while `ctx.get('remote.modelTools')`
     * reads the provided service without that requirement. The mount status is
     * still tried as a fallback (a future chunk could hand back the namespace
     * directly), and the associated `remote.modelTools` property is the last
     * route for an assembly that provides it that way. Every route is guarded so
     * absence is a value, not an exception.
     *
     * @param ctx - the client plugin context.
     * @param remoteStatus - the mounted status published by the wire chunk, or null.
     * @returns the namespace surface, or null when it is not available.
     */
    function modelToolsRemote(ctx, remoteStatus) {
      const usable = namespace => namespace !== null && namespace !== undefined
        && typeof namespace.describe === 'function'
      const routes = [() => ctx.get('remote.modelTools')]
      if (remoteStatus !== null && remoteStatus !== undefined) {
        routes.push(() => remoteStatus.remote.modelTools)
        routes.push(() => remoteStatus.modelTools)
      }
      routes.push(() => {
        const remote = ctx.get('remote')
        return remote === null || remote === undefined ? null : remote.modelTools
      })
      for (const route of routes) {
        try {
          const namespace = route()
          if (usable(namespace)) return namespace
        } catch (error) {
          // Try the next route: an undeclared associated namespace throws.
        }
      }
      return null
    }

    /**
     * Read one additive Tool Insights method from the optional Remote.
     *
     * The page's data methods (`toolUsageReport`, `toolInventory`, `mcpStatus`,
     * `mcpCalls`) are ADDITIVE: an older host does not expose them, so an
     * absent method is `null` (the page renders its named unavailable state),
     * never an exception. A refusal is returned in the RemoteResult shape the
     * page already understands, so its host text is shown verbatim.
     *
     * @param ctx - the client plugin context.
     * @param remoteSlot - the optional mounted Remote status.
     * @param method - the namespace method name.
     * @param args - its single arguments object.
     * @returns the value, a `{ok:false,error}` refusal, or null when absent.
     */
    async function callModelTools(ctx, remoteSlot, method, args) {
      const namespace = modelToolsRemote(ctx,
        remoteSlot === null || remoteSlot === undefined ? null : remoteSlot.get())
      if (namespace === null) return null
      const fn = namespace[method]
      if (typeof fn !== 'function') return null
      try {
        return unwrapRemoteResult(await fn.call(namespace, args))
      } catch (error) {
        return { ok: false, error: { message: remoteErrorText(error) } }
      }
    }

    /**
     * The install operation on the wire namespace.
     *
     * The verb is `installExtension`, not `install`: the harness gateway's
     * RemoteNamespaceService owns a private `install`, and a colliding descriptor
     * is refused at mount. The host-side service keeps the raw name `install`;
     * this helper tolerates either spelling so a wire rename cannot blank the UI.
     *
     * @param namespace - the modelTools namespace.
     * @returns the method to call, or null when the host exposes neither.
     */
    function extensionInstallMethod(namespace) {
      if (namespace === null || namespace === undefined) return null
      if (typeof namespace.installExtension === 'function') return namespace.installExtension
      if (typeof namespace.install === 'function') return namespace.install
      return null
    }

    /**
     * The host's error text, without inventing one.
     *
     * @param error - a RemoteResult error, an Error, or a string.
     * @returns the message to show; never empty.
     */
    function remoteErrorText(error) {
      if (typeof error === 'string' && error.length > 0) return error
      if (error !== null && typeof error === 'object'
        && typeof error.message === 'string' && error.message.length > 0) return error.message
      return 'The host did not explain the failure.'
    }

    /**
     * Read a generated Remote method's answer.
     *
     * A generated Typert Remote method resolves a RemoteResult
     * (`{ ok: true, value }` / `{ ok: false, error }`); the host service itself
     * resolves the plain value. Both shapes are accepted so a hand-authored wire
     * artifact and a generated one behave the same here, and a refusal becomes a
     * thrown error carrying the host's own message.
     *
     * @param result - the method's resolved value.
     * @returns the value.
     */
    function unwrapRemoteResult(result) {
      if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') {
        if (result.ok !== true) throw new Error(remoteErrorText(result.error))
        return result.value
      }
      return result
    }

    /**
     * Narrow an ExtensionsDescribeResult. A malformed answer is an error, not an
     * empty list: rendering "not installed" from a broken state read would be a
     * guess, and a guess about installed state is exactly what this page must not
     * make.
     *
     * @param value - the value describe() resolved.
     * @returns { store, writable, extensions }.
     */
    function normalizeDescribe(value) {
      if (value === null || typeof value !== 'object') {
        throw new Error('The host returned no extension state.')
      }
      if (!Array.isArray(value.extensions)) {
        throw new Error('The host returned an extension state without its extension list.')
      }
      const extensions = value.extensions.filter(row => row !== null && typeof row === 'object'
        && typeof row.id === 'string' && row.id.length > 0)
      return {
        store: typeof value.store === 'string' && value.store.length > 0 ? value.store : null,
        writable: value.writable === true,
        extensions,
      }
    }

    /**
     * How long a normalized describe() snapshot is served without asking the host.
     *
     * The settings page is opened and closed repeatedly, and the host store is the
     * only source of truth but not an inexpensive one. Five minutes of reuse means
     * reopening Settings shows the last known state immediately; every action,
     * Recheck and failure re-read still invalidates the snapshot explicitly, and a
     * stale snapshot is refreshed in the background for the next open.
     */
    const REMOTE_SNAPSHOT_TTL_MS = 300000

    /**
     * Read state by STABLE namespace identity: one in-flight promise, the last
     * snapshot and when it was taken.
     *
     * A WeakMap keyed by the namespace OBJECT would miss whenever the page mounts
     * with a fresh proxy, which is exactly the "reloaded every time Settings opens"
     * case. The key is therefore the Remote service key when the namespace exposes
     * one (stable across mounts), with an object-identity fallback for fakes and
     * future assemblies that expose no key.
     */
    const extensionReads = new Map()
    const extensionReadObjectIds = new WeakMap()
    let extensionReadSequence = 1

    /** The cache key for one namespace: a service key when present, else identity. */
    function extensionReadKey(namespace) {
      const stable = namespace === null || namespace === undefined
        ? null
        : namespace.serviceKey ?? namespace.id ?? namespace.key
      if (typeof stable === 'string' && stable.length > 0) return 'service:' + stable
      let id = extensionReadObjectIds.get(namespace)
      if (id === undefined) {
        id = extensionReadSequence
        extensionReadSequence += 1
        extensionReadObjectIds.set(namespace, id)
      }
      return 'object:' + String(id)
    }

    /** The read state for one namespace key, created on first use. */
    function extensionReadState(namespace) {
      const key = extensionReadKey(namespace)
      let state = extensionReads.get(key)
      if (state === undefined) {
        state = { inFlight: null, snapshot: null, at: 0, generation: 0 }
        extensionReads.set(key, state)
      }
      return state
    }

    /**
     * Start one host read and publish it only while the state still wants it.
     *
     * @param namespace - the Remote namespace whose describe() is the host read.
     * @param state - the read state that will receive the snapshot.
     * @returns the normalized snapshot, or a rejection the caller must handle.
     */
    function startExtensionRead(namespace, state) {
      const generation = state.generation
      const read = (async () => {
        try {
          const described = normalizeDescribe(unwrapRemoteResult(await namespace.describe()))
          // Publish only an answer the current state still wants: an invalidation
          // that arrived while this read was in flight must win over it.
          if (state.generation === generation) {
            state.snapshot = described
            state.at = Date.now()
          }
          return described
        } finally {
          if (state.inFlight === read) state.inFlight = null
        }
      })()
      state.inFlight = read
      return read
    }

    /**
     * Read one extension state snapshot, cached across Settings opens.
     *
     * A snapshot younger than REMOTE_SNAPSHOT_TTL_MS is served without a host call.
     * A snapshot OLDER than the TTL is still served immediately (stale-while-
     * revalidate), and a background read refreshes the cache for the next open, so
     * opening Settings never waits for the store. An explicit invalidation (after
     * every action, Recheck, or a failed action) clears the snapshot, so the next
     * read is a real host read. Concurrent callers share one in-flight promise and a
     * rejection is never cached, so a retry reaches the host again.
     */
    function describeExtensions(namespace) {
      const state = extensionReadState(namespace)
      if (state.snapshot !== null) {
        const stale = Date.now() - state.at >= REMOTE_SNAPSHOT_TTL_MS
        if (stale && state.inFlight === null) {
          // Refresh for the next open; this read still answers from the snapshot.
          startExtensionRead(namespace, state).catch(() => {})
        }
        return Promise.resolve(state.snapshot)
      }
      if (state.inFlight !== null) return state.inFlight
      return startExtensionRead(namespace, state)
    }

    /**
     * Drop the cached and in-flight read state for a namespace.
     *
     * Called after install/enable/disable/prepare and by Recheck ("Try again"):
     * after an action the page must read the host, not a snapshot from before it.
     */
    function invalidateExtensionState(namespace) {
      const state = extensionReadState(namespace)
      state.generation += 1
      state.inFlight = null
      state.snapshot = null
      state.at = 0
    }

    /**
     * Find one shipped extension in a describe() snapshot. The host may key a row
     * by the extension id or by its package name, so both are compared.
     *
     * @param extension - the generated EXTENSIONS entry.
     * @param states - the describe() rows.
     * @returns the matching state, or null when the host did not report it.
     */
    function findExtensionState(extension, states) {
      for (let index = 0; index < states.length; index += 1) {
        const state = states[index]
        if (state.id === extension.id) return state
        if (typeof extension.package === 'string' && state.id === extension.package) return state
        if (typeof state.package === 'string' && state.package === extension.id) return state
        if (typeof state.package === 'string' && typeof extension.package === 'string'
          && state.package === extension.package) return state
      }
      return null
    }

    /**
     * The Config.disabledExtensions list after one Enable/Disable action.
     *
     * Two durable sources describe "disabled": the SDK lifecycle that
     * enable/disable change, and this config list, which the plugin's restore
     * filter checks on the next load. The Remote UI writes the lifecycle, so it
     * must dual-write this list too — otherwise a restart can undo the user's
     * choice in the other direction (the example that motivated this: Enable
     * succeeds, the list still names the id, and the next restore re-disables it).
     *
     * @param list - the saved disabledExtensions list (any value, tolerated).
     * @param id - the extension id being enabled/disabled.
     * @param action - 'enable' removes the id; anything else ('disable') adds it.
     * @returns the sorted next list, with non-string entries dropped.
     */
    function nextDisabledExtensions(list, id, action) {
      const next = new Set(Array.isArray(list)
        ? list.filter(entry => typeof entry === 'string' && entry.length > 0)
        : [])
      if (action === 'disable') next.add(id)
      else next.delete(id)
      return [...next].sort()
    }

    /**
     * The state badge: installed/active are the host's words, not a guess.
     *
     * RC3 (one source of truth): a row the host reports `blocked` — or that
     * carries an unmet requirement which blocks this row — is never rendered
     * as plainly "active". The badge reads "active · blocked" so the
     * lifecycle fact and the refusal are both visible (the toggle visual
     * follows the same rule in extensionRemoteRow).
     */
    function extensionBadge(state) {
      if (state === null) return h('span', { className: 'mtt-badge' }, 'not reported')
      if (state.installed !== true) return h('span', { className: 'mtt-badge' }, 'not installed')
      const blocked = state.blocked === true
      if (state.active === true && !blocked) return h('span', { className: 'mtt-badge mtt-badge-on' }, 'active')
      if (state.active === true && blocked) return h('span', { className: 'mtt-badge' }, 'active · blocked')
      return h('span', { className: 'mtt-badge' }, 'inactive')
    }

    /**
     * Whether one unmet requirement blocks THIS row (RC3; mirrors the host's
     * `blocksRow` classification and src/extension-page-state.ts verbatim).
     * Pre-install, only store/source/dependencies/platform/harness-model/
     * runtime unmet requirements block; assets and the other post-install
     * kinds are notes, never the headline blocker.
     */
    function requirementBlocksThisRow(installed, requirement) {
      if (requirement.satisfied === true) return false
      if (installed) return true
      return requirement.kind === 'store' || requirement.kind === 'source'
        || requirement.kind === 'dependencies' || requirement.kind === 'platform'
        || requirement.kind === 'harness-model' || requirement.kind === 'runtime'
    }

    /** The parts of one extension row shared by both flows: name, tools, models. */
    function extensionParts(entry) {
      const parts = []
      if (entry.tools.length > 0) parts.push('tools: ' + entry.tools.join(', '))
      if (entry.contracts.length > 0) parts.push('contracts: ' + entry.contracts.join(', '))
      if (entry.models.length > 0) parts.push('models: ' + entry.models.join(', '))
      return parts
    }

    /**
     * The requirements a describe() row reports, when the host checked them.
     *
     * A legacy host (older wire/host) has no `requirements` field, and [] then
     * means "the host did not check" — never "everything is satisfied". Malformed
     * entries are dropped rather than rendered as facts.
     */
    function extensionRequirements(state) {
      if (state === null || !Array.isArray(state.requirements)) return []
      return state.requirements.filter(requirement => requirement !== null && typeof requirement === 'object'
        && typeof requirement.kind === 'string' && typeof requirement.satisfied === 'boolean')
    }

    /** Unmet requirements, preserving the host's order. */
    function unmetExtensionRequirements(state) {
      return extensionRequirements(state).filter(requirement => requirement.satisfied !== true)
    }

    /** A compact disclosure of what the host checked and satisfied. */
    function extensionRequirementSummary(state) {
      const satisfied = extensionRequirements(state).filter(requirement => requirement.satisfied === true)
      if (satisfied.length === 0) return null
      return 'Requirements checked: ' + satisfied.map(requirement => requirement.kind + ' ✓').join(' · ')
    }

    /**
     * The one hint an unmet requirement carries, derived from `action` — never
     * from the message text, because the host may reword its reasons. Assets and
     * executable requirements get no hint: the Prepare control is their fix.
     *
     * @param requirement - one unmet ExtensionRequirement.
     * @returns a hint line, or null when the row's controls say it.
     */
    function requirementHint(requirement) {
      if (requirement.kind === 'assets' || requirement.kind === 'executable') return null
      if (requirement.action === 'config') return 'Configure the deployment to satisfy this requirement.'
      if (requirement.action === 'none') return 'This requirement cannot be fixed from this page.'
      if (requirement.action === 'install') return 'Install the extension to satisfy this requirement.'
      return null
    }

    /**
     * What a row's controls may do, keyed ONLY on requirement kind/action/satisfied
     * and the host's `blocked` flag.
     *
     * Absent fields mean a legacy host: no requirements, `blocked` false, actions
     * enabled exactly as before. Harness-model/platform/integrity/activation
     * blockers disable Enable; assets/executable disable Enable but keep Prepare
     * (the fix); store/source disable Install.
     *
     * @param state - the describe() row, or null.
     * @returns { blocked, unmet, enableBlocked, installBlocked, prepareNeeded }.
     */
    function extensionRequirementControls(state) {
      const installed = state !== null && state.installed === true
      const blocked = state !== null && state.blocked === true
      const unmet = unmetExtensionRequirements(state)
      return {
        blocked,
        unmet,
        enableBlocked: installed && blocked,
        installBlocked: unmet.some(requirement => requirement.kind === 'store' || requirement.kind === 'source'),
        prepareNeeded: installed && unmet.some(requirement => requirement.kind === 'assets'
          || requirement.kind === 'executable'),
      }
    }

    /**
     * Whether a describe() row says the extension's model assets must be
     * prepared before activation.
     *
     * On a current host this is decided ONLY by the requirements array (an unmet
     * assets/executable entry). A legacy host carries no requirements, so its
     * reason text is the only signal — and it only decides whether the Prepare
     * control is offered; the host's text is never rewritten.
     *
     * @param state - the describe() row, or null.
     * @returns true when the host names preparation as the blocker.
     */
    function extensionNeedsPreparation(state) {
      if (state === null || state.installed !== true) return false
      if (Array.isArray(state.requirements)) return extensionRequirementControls(state).prepareNeeded
      if (typeof state.reason !== 'string' || state.reason.length === 0) return false
      const reason = state.reason.toLowerCase()
      return reason.includes('needs its model assets prepared')
        || reason.includes('needs preparation')
        || reason.includes('run prepare for this extension')
        || reason.includes('then prepare again')
    }

    /**
     * What to show after a prepare() call.
     *
     * `prepare` reports acquisition failures IN BAND (`ok: true` with
     * `prepared: false` and a reason), and RES-02 executable approval refusals
     * arrive the same way, so the refusal text is returned verbatim and never
     * replaced with a success claim. A successful call renders the disclosure the
     * host returned (plan bytes/license) rather than a bare "done".
     *
     * @param result - the ExtensionPrepareResult.
     * @returns one operator-facing note.
     */
    function prepareResultNote(result) {
      if (result === null || result === undefined || typeof result !== 'object') {
        return 'The host returned no preparation state.'
      }
      if (result.prepared !== true) {
        return typeof result.reason === 'string' && result.reason.length > 0
          ? result.reason
          : 'The host reported the preparation did not complete.'
      }
      const plan = result.plan !== null && typeof result.plan === 'object' ? result.plan : null
      let text
      if (plan === null) {
        text = 'The host reported the model assets prepared.'
      } else {
        text = 'Prepared ' + (typeof plan.modelId === 'string' ? plan.modelId : 'the model assets')
        if (typeof plan.totalBytes === 'number' && typeof plan.storageBytes === 'number') {
          text += ' — ' + plan.totalBytes + ' bytes download, ' + plan.storageBytes + ' retained'
        }
        if (plan.license !== null && typeof plan.license === 'object'
          && typeof plan.license.name === 'string' && plan.license.name.length > 0) {
          text += ' · license: ' + plan.license.name
        }
      }
      if (result.activationReady === false) {
        text += ' (activation still has remaining blockers; see the row reason)'
      }
      return text
    }

    /**
     * The row note for a successful install.
     *
     * The wire result may carry `source` ('registry' | 'directory') and the exact
     * `resolvedVersion`. Both are OPTIONAL: an older host returns only
     * {id, version, active}, in which case this returns null and the describe()
     * row keeps showing today's "installed v<version>" text — provenance is never
     * invented from an absent or unknown source.
     *
     * @param result - the ExtensionInstallResult (any host version).
     * @returns the note, or null when the result does not name a known source.
     */
    function installResultNote(result) {
      if (result === null || result === undefined || typeof result !== 'object') return null
      const version = typeof result.resolvedVersion === 'string' && result.resolvedVersion.length > 0
        ? result.resolvedVersion
        : typeof result.version === 'string' && result.version.length > 0 ? result.version : null
      if (version === null) return null
      if (result.source === 'registry') return 'installed v' + version + ' from npm'
      if (result.source === 'directory') return 'installed v' + version + ' from the local package directory'
      return null
    }

    /**
     * The config-only row: the switch records a `disabledExtensions` preference
     * and cannot observe or change the store. Used when the Remote is absent.
     */
    function extensionFallbackRow(entry, enabled, disabled, onToggle) {
      const parts = extensionParts(entry)
      return h('div', { className: 'mtt-row', key: entry.id },
        h('div', { className: 'mtt-row-text' },
          h('span', { className: 'mtt-label' },
            h('span', { className: 'mtt-name' }, entry.name),
            h('span', { className: 'mtt-badge' }, 'extension')),
          h('p', { className: 'mtt-help' }, entry.summary),
          h('span', { className: 'mtt-meta' },
            entry.id,
            parts.length > 0 ? ' · ' + parts.join(' · ') : '',
            ' · ',
            entry.license ?? 'no license')),
        h('div', { className: 'mtt-control' },
          h('button', {
            type: 'button',
            className: 'mtt-toggle',
            'data-on': enabled ? 'true' : 'false',
            disabled: disabled,
            'aria-pressed': enabled,
            title: enabled ? 'Disable this extension' : 'Enable this extension',
            onClick: () => onToggle(entry.id, !enabled),
          }, h('span', { className: 'mtt-knob' }))))
    }

    /**
     * The store-backed row: Install when absent, Enable/Disable when installed.
     *
     * Nothing here is optimistic. `state` comes from the last describe(), the
     * toggle reflects `active` from that snapshot, and a failed action leaves the
     * host's error text on the row rather than flipping a switch that did not move.
     *
     * @param entry - the generated extension entry.
     * @param state - the describe() row for it, or null when not reported.
     * @param ui - { writable, canInstall, listed, busy, pending, error, prepareNote, installNote, onAction }.
     */
    function extensionRemoteRow(entry, state, ui) {
      const installed = state !== null && state.installed === true
      const active = installed && state.active === true
      const pending = ui.pending !== null && ui.pending.id === entry.id ? ui.pending.action : null
      const requirementControls = extensionRequirementControls(state)
      const needsPreparation = extensionNeedsPreparation(state)
      const parts = extensionParts(entry)
      if (state !== null && typeof state.version === 'string' && state.version.length > 0) {
        parts.push('installed v' + state.version)
      }
      if (installed && state.disabled === true) parts.push('disabled in config')

      // Note kinds: 'note' is muted disclosure, 'blocker' is an unmet requirement
      // (prominent), 'error' is the last action's failure. Keeping the kind per
      // note means the class never depends on an array position.
      const notes = []
      const addNote = (text, kind) => {
        if (typeof text === 'string' && text.length > 0) notes.push({ text, kind: kind ?? 'note' })
      }
      const summary = extensionRequirementSummary(state)
      if (summary !== null) addNote(summary)
      if (state === null) {
        addNote('The extension store did not report this package. Installing asks the host for it, and any refusal is shown here.')
      }
      // The host's reason is rendered VERBATIM: it is the authoritative
      // explanation. On a blocked row it is that row's headline, so it is
      // prominent instead of muted.
      if (state !== null && typeof state.reason === 'string' && state.reason.length > 0) {
        addNote(state.reason, requirementControls.blocked ? 'blocker' : 'note')
      }
      if (ui.prepareNote !== null && ui.prepareNote !== undefined && ui.prepareNote.id === entry.id) {
        addNote(ui.prepareNote.text)
      }
      if (ui.installNote !== null && ui.installNote !== undefined && ui.installNote.id === entry.id) {
        addNote(ui.installNote.text)
      }
      // Every unmet requirement gets its exact reason on the row. A requirement
      // whose reason is the row reason already is not repeated; the hint comes
      // from `action` only, never from the wording.
      //
      // RC3: the NOTE KIND follows the row classification — an unmet
      // requirement that blocks THIS row is a 'blocker'; a post-install fact
      // (assets/executable/readiness on a not-installed row) is a muted note,
      // so a pre-install assets hint can never read as the install blocker.
      if (state !== null && Array.isArray(state.requirements)) {
        for (const requirement of requirementControls.unmet) {
          if (requirement.reason !== state.reason) {
            addNote(requirement.reason, requirementBlocksThisRow(installed, requirement) ? 'blocker' : 'note')
          }
          addNote(requirementHint(requirement))
        }
        if (requirementControls.blocked && requirementControls.unmet.length === 0 && state.reason === null) {
          addNote('The host reports this extension blocked but named no requirement; see the dsh logs.', 'blocker')
        }
      }
      if (state !== null && state.integrity === 'changed') {
        addNote('The installed content changed since it was recorded; reinstall before enabling it.')
      }
      // The store and the config list must agree across a restart. Rendering both
      // is what lets the operator fix a disagreement with one toggle instead of
      // discovering it after the next restore.
      if (installed && active && ui.listed) {
        addNote('The config list still names this extension; it will be disabled on restart.')
      }
      if (installed && !active && !ui.listed) {
        addNote('The config list does not name this extension; it will not block a restore.')
      }
      if (!installed && !ui.canInstall) {
        addNote('This host exposes extension state but not the install action; install it through the extension store.')
      }
      if (ui.error !== null && ui.error.id === entry.id) addNote(ui.error.text, 'error')

      const canInstall = ui.canInstall
      // RC3: the toggle VISUAL is OFF whenever the row is blocked, so a
      // blocked row never renders as plainly ON; the aria-pressed state and
      // the action title keep the lifecycle fact (the host's own words), and
      // the disabled/enabled semantics are unchanged.
      const blockedRow = installed && requirementControls.blocked
      const control = installed
        ? h('button', {
          type: 'button',
          className: 'mtt-toggle',
          'data-on': active && !blockedRow ? 'true' : 'false',
          disabled: ui.busy || !ui.writable || requirementControls.enableBlocked,
          'aria-pressed': active,
          'aria-busy': pending !== null,
          title: requirementControls.enableBlocked
            ? 'Enable is blocked by a host requirement; see the row reason'
            : active ? 'Disable this extension' : 'Enable this extension',
          onClick: () => ui.onAction(entry.id, active ? 'disable' : 'enable'),
        }, h('span', { className: 'mtt-knob' }))
        : h('button', {
          type: 'button',
          className: 'mtt-button mtt-button-small',
          disabled: ui.busy || !ui.writable || !canInstall || requirementControls.installBlocked,
          'aria-busy': pending === 'install',
          title: !canInstall
            ? 'This host does not expose the extension install action'
            : requirementControls.installBlocked
              ? 'Install is blocked by a host requirement; see the row reason'
              : state === null ? 'Ask the host to install this extension' : 'Install this extension',
          onClick: () => ui.onAction(entry.id, 'install'),
        }, pending === 'install' ? 'Installing…' : 'Install')

      return h('div', { className: 'mtt-row', key: entry.id },
        h('div', { className: 'mtt-row-text' },
          h('span', { className: 'mtt-label' },
            h('span', { className: 'mtt-name' }, entry.name),
            extensionBadge(state)),
          h('p', { className: 'mtt-help' }, entry.summary),
          h('span', { className: 'mtt-meta' },
            entry.id,
            parts.length > 0 ? ' · ' + parts.join(' · ') : '',
            ' · ',
            entry.license ?? 'no license'),
          notes.map((note, index) => h('p', {
            className: note.kind === 'error'
              ? 'mtt-row-error'
              : note.kind === 'blocker' ? 'mtt-row-blocker' : 'mtt-row-note',
            key: 'note-' + index,
          }, note.text))),
        h('div', { className: 'mtt-control' },
          control,
          // Preparation is offered only when the HOST names it as the blocker (or
          // an unmet assets/executable requirement names it); it is not a second
          // way to force activation. After a successful prepare the row's
          // requirements change and this control disappears.
          needsPreparation
            ? h('button', {
              type: 'button',
              className: 'mtt-button mtt-button-small',
              disabled: ui.busy || !ui.writable,
              'aria-busy': pending === 'prepare',
              title: 'Prepare the model assets this extension needs before it can be enabled',
              onClick: () => ui.onAction(entry.id, 'prepare'),
            }, pending === 'prepare' ? 'Preparing…' : 'Prepare')
            : null))
    }

    function ModelToolsSettings({ form, ctx, remoteSlot }) {
      const [snap, setSnap] = React.useState(() => form.getSnapshot())
      const [draft, setDraft] = React.useState({})
      const [exclude, setExclude] = React.useState(null)
      const [disabledExt, setDisabledExt] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      // Extension state is the HOST's answer, read from ctx.remote.modelTools.
      // `kind` is loading | ready | absent | error; it starts loading so the card
      // never renders a guessed installed/active state before the first read.
      const [extRemote, setExtRemote] = React.useState({ kind: 'loading' })
      const [extPending, setExtPending] = React.useState(null)
      const [extRowError, setExtRowError] = React.useState(null)
      // Non-fatal: activation succeeded but the config-list dual-write did not.
      // The action is never rolled back for this; the note tells the operator the
      // two stores can disagree until the list is saved manually.
      const [extConfigNote, setExtConfigNote] = React.useState(null)
      // The last prepare() disclosure/refusal, per row. It is rendered beside the
      // host's reason so a RES-02 refusal or plan is shown verbatim.
      const [extPrepareNote, setExtPrepareNote] = React.useState(null)
      // The provenance note from the last successful install, per row ("installed
      // v<resolvedVersion> from npm / from the local package directory"). Null for
      // a legacy host result that carries neither source nor resolvedVersion.
      const [extInstallNote, setExtInstallNote] = React.useState(null)

      /** This mount's namespace status, or null when the wire chunk is absent. */
      const mounted = () => (remoteSlot === null || remoteSlot === undefined ? null : remoteSlot.get())

      React.useEffect(() => form.subscribe(() => setSnap(form.getSnapshot())), [form])

      // Read the extension state on mount. The namespace may arrive after this
      // page (the wire chunk is fetched first), so an absent namespace is retried
      // briefly AND the chunk's slot subscription re-reads when the mount settles.
      // `alive` keeps a late answer from writing into an unmounted page.
      React.useEffect(() => {
        let alive = true
        let timer = null
        let attempts = 0
        const adopt = namespace => {
          describeExtensions(namespace).then(described => {
            if (alive) setExtRemote({ kind: 'ready', namespace, ...described })
          }, error => {
            if (alive) setExtRemote({ kind: 'error', text: remoteErrorText(error) })
          })
        }
        const read = () => {
          const namespace = modelToolsRemote(ctx, mounted())
          if (namespace !== null) {
            adopt(namespace)
            return
          }
          if (attempts >= REMOTE_RETRY_ATTEMPTS) {
            if (alive) setExtRemote({ kind: 'absent' })
            return
          }
          attempts += 1
          timer = setTimeout(read, REMOTE_RETRY_DELAY_MS)
        }
        read()
        const unsubscribe = remoteSlot !== null && remoteSlot !== undefined
          && typeof remoteSlot.subscribe === 'function'
          ? remoteSlot.subscribe(() => {
            if (!alive) return
            const namespace = modelToolsRemote(ctx, mounted())
            if (namespace !== null) adopt(namespace)
          })
          : null
        return () => {
          alive = false
          if (unsubscribe !== null) unsubscribe()
          if (timer !== null) clearTimeout(timer)
        }
      }, [ctx])

      if (snap.status === 'unavailable') {
        return h('div', { className: 'mtt-page' },
          h('style', null, CSS),
          h('h2', { className: 'mtt-title' }, 'Model as Tool'),
          h('p', { className: 'mtt-intro' },
            'The model-tools configuration namespace is not exposed to this client. '
            + 'Edit the profile cordis.patch.yml entry with id "model-tools" instead.'))
      }

      const value = snap.value || {}
      const disabled = snap.writable === false
      const edit = (key, next) => setDraft(previous => {
        const updated = { ...previous }
        updated[key] = next
        return updated
      })

      const savedExclude = Array.isArray(value.exclude) ? value.exclude : []
      const currentExclude = exclude ?? savedExclude
      const allowlist = Array.isArray(value.models) ? value.models : []

      /** Whether a model is exposed: not excluded (and inside the allowlist when one is set). */
      function isEnabled(id) {
        if (currentExclude.includes(id)) return false
        return allowlist.length === 0 || allowlist.includes(id)
      }

      const dirty = FIELDS.some(field => draft[field.key] !== undefined) || exclude !== null || disabledExt !== null

      /** Drop one key from the draft after it has been committed (or refused). */
      const clearDraft = key => setDraft(previous => {
        if (previous[key] === undefined) return previous
        const updated = { ...previous }
        delete updated[key]
        return updated
      })

      /**
       * Commit a TOGGLE immediately.
       *
       * A switch reads as an applied setting, not as an edit waiting for a Save two
       * screens below it: that is why "Managed workers" looked on while the profile
       * patch still had no managedWorkers value. The switch is committed on click,
       * the draft is cleared only after the host accepts it, and a refusal or error
       * clears the optimistic draft so the control shows the host's value again.
       */
      const saveToggle = async (key, next) => {
        edit(key, next)
        setStatus({ kind: 'busy', text: 'Saving…' })
        try {
          const accepted = await form.set(key, next)
          if (accepted === false) {
            clearDraft(key)
            setStatus({ kind: 'error', text: 'Refused by the host — see the dsh logs.' })
            return
          }
          clearDraft(key)
          setStatus({ kind: 'ok', text: 'Saved. Changes apply to new sessions.' })
        } catch (error) {
          clearDraft(key)
          setStatus({ kind: 'error', text: String((error && error.message) || error) })
        }
      }

      const save = async () => {
        setStatus({ kind: 'busy', text: 'Saving…' })
        try {
          let refused = false
          for (const field of FIELDS) {
            if (draft[field.key] === undefined) continue
            const accepted = await form.set(field.key, fieldPatch(field, draft[field.key]))
            if (accepted === false) refused = true
          }
          if (exclude !== null) {
            const accepted = await form.set('exclude', exclude)
            if (accepted === false) refused = true
          }
          if (disabledExt !== null) {
            const accepted = await form.set('disabledExtensions', disabledExt)
            if (accepted === false) refused = true
          }
          setDraft({})
          setExclude(null)
          setDisabledExt(null)
          setStatus(refused
            ? { kind: 'error', text: 'Refused by the host — see the dsh logs.' }
            : { kind: 'ok', text: 'Saved. Changes apply to new sessions.' })
        } catch (error) {
          setStatus({ kind: 'error', text: String((error && error.message) || error) })
        }
      }

      const savedDisabledExt = Array.isArray(value.disabledExtensions) ? value.disabledExtensions : []
      const currentDisabledExt = disabledExt ?? savedDisabledExt
      const isExtensionEnabled = id => !currentDisabledExt.includes(id)
      const toggleExtension = (id, on) => setDisabledExt(() => {
        const next = new Set(currentDisabledExt)
        if (on) next.delete(id)
        else next.add(id)
        return [...next].sort()
      })

      const toggleModel = (id, on) => setExclude(() => {
        const next = new Set(currentExclude)
        if (on) next.delete(id)
        else next.add(id)
        return [...next].sort()
      })

      /**
       * Best-effort write of Config.disabledExtensions after a lifecycle
       * enable/disable. Activation is the authority: a refusal here is reported
       * as a NON-FATAL note and never undoes or hides the activation.
       *
       * The list is read from the form's CURRENT snapshot (another tab or the
       * Save button may have changed it since this render), falling back to the
       * render's saved value.
       */
      const dualWriteDisabledExtensions = async (id, action) => {
        const snapshot = form.getSnapshot()
        const snapshotValue = snapshot && snapshot.value !== null && typeof snapshot.value === 'object'
          ? snapshot.value
          : {}
        const saved = Array.isArray(snapshotValue.disabledExtensions)
          ? snapshotValue.disabledExtensions
          : savedDisabledExt
        const nextList = nextDisabledExtensions(saved, id, action)
        const unchanged = Array.isArray(saved) && nextList.length === saved.length
          && nextList.every((entry, index) => entry === saved[index])
        if (unchanged) return
        const what = action === 'disable' ? 'disabled' : 'enabled'
        try {
          const accepted = await form.set('disabledExtensions', nextList)
          if (accepted === false) {
            setExtConfigNote('The extension was ' + what + ', but the host refused the disabledExtensions update; '
              + 'the config list can disagree with the store until it is saved manually.')
          }
        } catch (error) {
          setExtConfigNote('The extension was ' + what + ', but the config list update failed: '
            + remoteErrorText(error))
        }
      }

      /**
       * Prepare and activate a freshly installed extension.
       *
       * A first-party package ships model assets that activation refuses to run
       * until they are prepared, so "install" only ever reached the middle of the
       * job: the operator then had to press Prepare and then Enable. The install
       * click is the operator's request, so the page now performs the same two host
       * actions it exposes — prepare() and enable() — in order. A refusal (an
       * executable-approval policy, a missing asset source, activation blocked) is
       * reported as a NON-FATAL note: the install itself succeeded, and the row's
       * own controls remain the way to retry.
       *
       * @param namespace - the Remote namespace.
       * @param id - the extension just installed.
       * @returns the follow-through note, or null when the host has no prepare.
       */
      const followThroughInstall = async (namespace, id) => {
        let prepareNote = ''
        try {
          // Read the NEW row first: preparation is only needed when the host names
          // it as the blocker, and an activation attempt that is known to fail would
          // only leave a failure record behind.
          invalidateExtensionState(namespace)
          const snapshot = await describeExtensions(namespace)
          const state = findExtensionState({ id }, snapshot.extensions)
          if (extensionNeedsPreparation(state)) {
            if (typeof namespace.prepare !== 'function') {
              return 'installed, but this host does not expose the extension prepare action.'
            }
            setExtPending({ id, action: 'prepare' })
            const prepared = unwrapRemoteResult(await namespace.prepare(id))
            const described = prepareResultNote(prepared)
            if (typeof described === 'string' && described.length > 0) prepareNote = described
            if (prepared === null || typeof prepared !== 'object' || prepared.prepared !== true) {
              return 'installed, but preparation did not complete: ' + prepareNote
            }
          }
        } catch (error) {
          return 'installed, but its readiness could not be read: ' + remoteErrorText(error)
        }
        try {
          setExtPending({ id, action: 'enable' })
          unwrapRemoteResult(await namespace.enable(id))
          await dualWriteDisabledExtensions(id, 'enable')
          return (prepareNote.length > 0 ? prepareNote + ' ' : '') + 'Enabled automatically.'
        } catch (error) {
          return (prepareNote.length > 0 ? prepareNote + ' ' : '')
            + 'activation was refused: ' + remoteErrorText(error)
        }
      }

      /** Read the host state once, after a manual "Try again". */
      const recheckExtensions = async () => {
        setExtRowError(null)
        setExtConfigNote(null)
        setExtPrepareNote(null)
        setExtInstallNote(null)
        setExtRemote({ kind: 'loading' })
        const namespace = modelToolsRemote(ctx, mounted())
        if (namespace === null) {
          setExtRemote({ kind: 'absent' })
          return
        }
        invalidateExtensionState(namespace)
        try {
          setExtRemote({ kind: 'ready', namespace, ...(await describeExtensions(namespace)) })
        } catch (error) {
          setExtRemote({ kind: 'error', text: remoteErrorText(error) })
        }
      }

      /**
       * Run one extension action, then RE-READ the host state.
       *
       * The host is the authority: a successful install is not activation, and
       * enable/disable may be refused for reasons only describe() can explain.
       * The re-read is what moves the controls; the action result is never
       * painted as a state change by itself.
       */
      const runExtensionAction = async (id, action) => {
        setExtRowError(null)
        setExtConfigNote(null)
        setExtPrepareNote(null)
        setExtInstallNote(null)
        setExtPending({ id, action })
        try {
          const namespace = modelToolsRemote(ctx, mounted())
          if (namespace === null) {
            setExtRemote({ kind: 'absent' })
            return
          }
          if (action === 'install') {
            const install = extensionInstallMethod(namespace)
            if (install === null) throw new Error('This host does not expose the extension install action.')
            // The wire descriptor is installExtension(id, source): Typert counts
            // business arguments exactly, and an omitted `source` still occupies
            // its positional slot. Passing only the id is refused by the gateway
            // ("expected 2 business argument(s) ... got 1"), so pass undefined to
            // mean "use the configured first-party source".
            const installed = unwrapRemoteResult(await install.call(namespace, id, undefined))
            // Provenance note when the host names the route; null on a legacy
            // result, in which case describe()'s "installed v<version>" stands.
            const note = installResultNote(installed)
            if (note !== null) setExtInstallNote({ id, text: note })
            // Preparation and activation are part of installing from this page.
            const followUp = await followThroughInstall(namespace, id)
            if (followUp !== null) setExtPrepareNote({ id, text: followUp })
          } else if (action === 'prepare') {
            if (typeof namespace.prepare !== 'function') {
              throw new Error('This host does not expose the extension prepare action.')
            }
            // prepare(id) has no optional data argument; an AbortSignal may ride
            // as the second wire slot, which this page does not need.
            const prepared = unwrapRemoteResult(await namespace.prepare(id))
            setExtPrepareNote({ id, text: prepareResultNote(prepared) })
          } else if (action === 'enable') {
            unwrapRemoteResult(await namespace.enable(id))
            // Dual-write Config.disabledExtensions so a restart cannot re-disable
            // what the operator just enabled. Best-effort and non-fatal.
            await dualWriteDisabledExtensions(id, 'enable')
          } else {
            unwrapRemoteResult(await namespace.disable(id))
            await dualWriteDisabledExtensions(id, 'disable')
          }
          invalidateExtensionState(namespace)
          setExtRemote({ kind: 'ready', namespace, ...(await describeExtensions(namespace)) })
          // A store write and the following describe can land in either order
          // under load. One bounded re-read after a successful action settles
          // the row's controls (the Enable switch appears on an install) without
          // asking the operator to reopen the page. mounted() gates a stale
          // update after the dialog closes.
          setTimeout(() => {
            void (async () => {
              try {
                const settled = modelToolsRemote(ctx, mounted())
                if (settled !== null) {
                  invalidateExtensionState(settled)
                  setExtRemote({ kind: 'ready', namespace: settled, ...(await describeExtensions(settled)) })
                }
              } catch (settleError) {
                // The snapshot already rendered is the last known host truth.
              }
            })()
          }, 500)
        } catch (error) {
          setExtRowError({ id, text: remoteErrorText(error) })
          // The action may have changed host state before failing. Read it back,
          // but keep the action's error text if the re-read fails as well.
          try {
            const namespace = modelToolsRemote(ctx, mounted())
            if (namespace !== null) {
              invalidateExtensionState(namespace)
              setExtRemote({ kind: 'ready', namespace, ...(await describeExtensions(namespace)) })
            }
          } catch (readError) {
            // The row keeps the host's action error; the state stays the last
            // snapshot describe() gave us, which is still the last known truth.
          }
        } finally {
          setExtPending(null)
        }
      }

      const runnable = CATALOG.filter(entry => entry.runnable === true)
      const unavailable = CATALOG.filter(entry => entry.runnable !== true)

      const extPendingEntry = extPending === null
        ? null
        : EXTENSIONS.find(entry => entry.id === extPending.id) ?? { name: extPending.id }
      const extPendingText = extPending === null
        ? null
        : (EXTENSION_ACTION_LABELS[extPending.action] ?? 'Working on') + ' ' + extPendingEntry.name + '…'
      const extWritable = extRemote.kind === 'ready' && extRemote.writable === true
      const extBusy = extPending !== null

      let extensionCard
      if (extRemote.kind === 'ready') {
        const notes = []
        if (extRemote.store === null) {
          notes.push('No extension store is configured on this host (extensionStore), so an extension cannot be installed or activated here.')
        } else if (!extRemote.writable) {
          notes.push('The host reports its extension store as read-only right now; the extension controls are disabled.')
        }
        const canInstall = extensionInstallMethod(extRemote.namespace) !== null
        extensionCard = h('div', { className: 'mtt-card' },
          h('p', { className: 'mtt-help' },
            'Tool Mode extensions shipped with this plugin. The host\'s extension store is the authority: '
            + 'Install copies a package into the store, then the switch activates it. Installation is not activation.'),
          notes.map((note, index) => h('p', { className: 'mtt-row-note', key: 'store-note-' + index }, note)),
          extPendingText === null ? null : h('p', { className: 'mtt-status' }, extPendingText),
          extConfigNote === null ? null : h('p', { className: 'mtt-row-note' }, extConfigNote),
          EXTENSIONS.map(entry => extensionRemoteRow(
            entry,
            findExtensionState(entry, extRemote.extensions),
            {
              writable: extWritable,
              canInstall,
              // The SAVED config list, not the fallback draft: the row describes
              // what a restart will actually read, and the dual-write compares
              // against the same saved value.
              listed: savedDisabledExt.includes(entry.id),
              // ONE ROW'S ACTION IS NOT A PAGE-WIDE LOCK. Only the row whose action
              // is in flight disables its own controls; every other row stays
              // operable, and the host's own refusal (e.g. a lifecycle operation in
              // progress) is shown on that row instead of greying out the page.
              busy: extBusy && extPending !== null && extPending.id === entry.id,
              pending: extPending,
              error: extRowError,
              prepareNote: extPrepareNote,
              installNote: extInstallNote,
              onAction: runExtensionAction,
            })))
      } else if (extRemote.kind === 'error') {
        extensionCard = h('div', { className: 'mtt-card' },
          h('p', { className: 'mtt-help' },
            'The host exposes extension controls, but reading their state failed.'),
          h('p', { className: 'mtt-row-error' }, extRemote.text),
          h('div', { className: 'mtt-actions' },
            h('button', {
              type: 'button',
              className: 'mtt-button mtt-button-small',
              onClick: recheckExtensions,
            }, 'Try again')))
      } else if (extRemote.kind === 'absent') {
        extensionCard = h('div', { className: 'mtt-card' },
          h('p', { className: 'mtt-help' },
            'Tool Mode extensions shipped with this plugin. The host\'s extension controls are not available to '
            + 'this page (an older host build, or the extension Remote is not mounted), so this page cannot install, '
            + 'verify, or observe them.'),
          h('p', { className: 'mtt-row-note' },
            'The switches below only record a disabledExtensions preference for the next load: they neither install '
            + 'nor verify the package.'),
          EXTENSIONS.map(entry => extensionFallbackRow(entry, isExtensionEnabled(entry.id), disabled, toggleExtension)),
          h('div', { className: 'mtt-actions' },
            h('button', {
              type: 'button',
              className: 'mtt-button mtt-button-small',
              onClick: recheckExtensions,
            }, 'Recheck')))
      } else {
        extensionCard = h('div', { className: 'mtt-card' },
          h('p', { className: 'mtt-help' }, 'Reading the extension state from the host…'))
      }

      return h('div', { className: 'mtt-page' },
        h('style', null, CSS),
        h('h2', { className: 'mtt-title' }, 'Model as Tool'),
        h('p', { className: 'mtt-intro' },
          'On-device models from the Desert Ant catalog, exposed as tools and skills. A model becomes a tool only when this '
          + 'process can actually run it; extension-backed models are listed with the extension that provides them.'),
        h('p', { className: 'mtt-help mtt-restart-notice', role: 'note' }, 'Model and tool registration changes apply after restart.'),
        h('div', { className: 'mtt-card' },
          h('p', { className: 'mtt-help' },
            runnable.length + ' of ' + CATALOG.length + ' catalog models are runnable in this process. '
            + 'Unavailable models are listed with the reason they cannot run here.'),
          runnable.map(entry => modelRow(entry, isEnabled(entry.id), disabled, toggleModel)),
          // Unavailable rows are not operable switches: render them as disabled
          // controls so the grey off state matches their real state.
          unavailable.map(entry => modelRow(entry, false, true, toggleModel))),
        EXTENSIONS.length === 0 ? null : extensionCard,
        h('div', { className: 'mtt-card' }, FIELDS.map(field => fieldRow(
          field, value, draft, field.kind === 'toggle' ? saveToggle : edit, disabled))),
        h('div', { className: 'mtt-actions' },
          h('button', {
            type: 'button', className: 'mtt-button', disabled: disabled || !dirty || status?.kind === 'busy', onClick: save,
          }, 'Save'),
          status ? h('span', { className: 'mtt-status mtt-status-' + status.kind }, status.text) : null,
          disabled
            ? h('span', { className: 'mtt-status' }, 'Read-only: connected from a remote browser.')
            : null),
        h('p', { className: 'mtt-help' },
          'Per-model toggles write the exclude list; the allowlist override pins an exact set. Credentials, the '
          + 'bridge endpoint, the extension store and the headless MCP listener live in the profile cordis.patch.yml '
          + 'row (id "model-tools"), where the launcher and doctor read them.'))
    }

    function apply(ctx) {
      // The extension Remote is optional. Mount it in the BACKGROUND (never await
      // it before registering this section): on a host without it the page must
      // still render its config-only fallback. The slot's subscription upgrades
      // the card when the mount settles.
      const remoteSlot = createRemoteSlot()
      mountExtensionRemote(ctx, remoteSlot)
      // The chat cards were INLINED above, so registration cannot depend on a chunk
      // fetch that the client module service would refuse.
      toolviews.register(ctx)

      // The Tool Insights page is OPTIONAL: an older host may not declare the root
      // `main` / `sidebar.panellist` slots, and this plugin's Settings page must keep
      // working there. Do NOT probe `ctx.slots.spec()` here: this plugin can apply
      // before ui-sidebar declares its slots, and `inject` is the lazy registration
      // path that resolves once that declaration exists.
      const registerPageSlot = (name, factory) => {
        if (ctx.slots === null || ctx.slots === undefined || typeof ctx.slots.inject !== 'function') return
        try {
          ctx.slots.inject(name, factory)
        } catch {
          // Older host without this root slot: the Settings page still works.
        }
      }
      registerPageSlot('main', () => ctx.slots.register({
        name: 'main',
        key: 'tool-insights',
        inject: () => ({
          // Additive methods only; the page degrades when a host lacks them.
          call: (method, args) => callModelTools(ctx, remoteSlot, method, args),
          openSession: id => {
            const workspace = ctx.get('uiWorkspace')
            if (workspace !== null && workspace !== undefined
              && typeof workspace.openSession === 'function') workspace.openSession(id)
          },
          // The Inventory tab owns the detailed extension/model configuration.
          // Resolve the config form lazily: inject runs at render time, after
          // apply() has registered configForms.
          settings: () => {
            const candidates = NAMESPACES.map(namespace => ctx.configForms.get(namespace))
            const form = candidates.find(candidate => {
              const snap = candidate.getSnapshot()
              return snap.status === 'ready' || snap.value !== undefined
            }) ?? candidates[0]
            return h(ModelToolsSettings, { form, ctx, remoteSlot })
          },
        }),
      }, toolInsights.ToolInsightsPage))
      registerPageSlot('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'tool-insights',
        order: 15,
        label: 'Tool Insights',
      }, toolInsights.ToolInsightsIcon))

      const forms = NAMESPACES.map(namespace => ctx.configForms.get(namespace))
      const served = () => forms.find(candidate => {
        const snap = candidate.getSnapshot()
        return snap.status === 'ready' || snap.value !== undefined
      })
      // Fall back to the first candidate so the page still renders its explanatory copy.
      const form = {
        getSnapshot: () => (served() ?? forms[0]).getSnapshot(),
        subscribe: listener => {
          const disposers = forms.map(candidate => candidate.subscribe(listener))
          return () => { for (const dispose of disposers) dispose() }
        },
        set: (field, value) => (served() ?? forms[0]).set(field, value),
      }

      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'model-tools',
        // After the shipped sections (general 0, models 10, plugins 15, agent-presets 20).
        order: 65,
        label: 'Model as Tool',
      }, () => h(ModelToolsSettings, { form, ctx, remoteSlot }))))
    }

    exports.name = 'model-tools'
    // 'remote' is deliberately NOT injected: the mount above is optional and
    // reaches the namespace through a guarded context read, so a host that does
    // not mount it can only fall back to the config-only switches. A required
    // 'remote' / 'remote.modelTools' would park this Settings page instead.
    exports.inject = ['slots', 'configForms']
    exports.apply = apply
    exports.__internals = {
      NAMESPACES,
      FIELDS,
      CATALOG,
      fieldValue,
      fieldPatch,
      createRemoteSlot,
      modelToolsRemote,
      extensionInstallMethod,
      remoteErrorText,
      unwrapRemoteResult,
      normalizeDescribe,
      describeExtensions,
      invalidateExtensionState,
      REMOTE_SNAPSHOT_TTL_MS,
      findExtensionState,
      nextDisabledExtensions,
      extensionRequirements,
      unmetExtensionRequirements,
      extensionRequirementSummary,
      requirementHint,
      extensionRequirementControls,
      extensionNeedsPreparation,
      prepareResultNote,
      installResultNote,
      callModelTools,
      toolInsights,
    }
    return module.exports
  },
})
