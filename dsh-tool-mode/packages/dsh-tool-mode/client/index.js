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
    /**
 * The chat tool view for every Tool Mode model call.
 *
 * A generic tool card already lists name, arguments and the JSON result, but it
 * cannot say WHICH extension and model answered, whether the call ran on the
 * device or a remote harness, or what the receipt was. Those are the fields a
 * reader of this plugin needs, and they are all present in the result envelope.
 *
 * The harness dispatches `tool.call.toolview` by TOOL NAME (see the slot
 * declaration in `@deepseek-ai/dsh-client-ui-tool`), so this module registers one
 * key per tool the plugin can expose. A tool name the plugin does not know falls
 * back to the generic card, which is the correct outcome: this card must never
 * pretend to recognize a call it does not.
 *
 * THIS FILE IS INLINED INTO client/index.js by `scripts/gen-client-catalog.mjs`.
 * It is not a separate chunk: the client module service serves only the bundle file
 * a plugin declares as its client entry, so an unreferenced sibling chunk answers
 * 404 and the view silently falls back to the generic card. Keeping the source
 * separate here and injecting it at build time gives one testable module and one
 * served file.
 *
 * Renders with plain `React.createElement` and inline styles, so it needs no CSS
 * asset and cannot break the page stylesheet.
 * @param createElement - React's createElement, supplied by the client bundle.
 * @returns the registrations and the pure helpers (also used by tests).
 */
function createToolviews(createElement) {
  const h = createElement

    /**
     * Every tool name this plugin can register.
     *
     * Extension tools are dynamic in principle, but a keyed slot can only be
     * claimed by name. The list is the union of the shipped extensions' tools
     * plus the plugin's own control tools; a future extension's tool shows the
     * generic card until its name is added here.
     */
    const TOOL_NAMES = Object.freeze([
      // The plugin's own control and discovery tools.
      'tool_mode_list', 'tool_mode_describe', 'tool_mode_run', 'model_tools', 'model_tools_manage',
      // Host-owned decision composition registered by this plugin.
      'decision_combine', 'decision_evaluate', 'decision_route',
      // embeddinggemma
      'multimodal_embed', 'semantic_similarity', 'semantic_rank', 'semantic_classify',
      'semantic_deduplicate', 'media_find_moments', 'dedupe_and_rank',
      // laya
      'decision_choose', 'decision_test', 'decision_score',
      'decision_choose_local', 'decision_score_typed', 'decision_test_typed',
      // needle
      'tools_plan', 'structured_extract', 'validate_record', 'extract_with_repair',
      // tongue, voz, minilm, declarative recipes, harness text/vision
      'lang_detect', 'stt_transcribe', 'text_embed', 'text_rerank', 'text_title', 'describe_image',
      // mirage
      'mirage_describe', 'mirage_detect', 'mirage_ocr', 'mirage_extract',
      // Runtime-layer extensions (LiteRT/ONNX engines and code-free recipes).
      'redact_text', 'shape_recognize', 'detect_fillers', 'enhance_speech',
      'classify_nsfw', 'identify_language', 'suggest_emojis',
      // Vendor catalog tools served through adapters when installed.
      'align_transcript', 'select_clips', 'detect_spoken_language', 'suggest_emoji', 'score_frames',
      'match_faces', 'tag_topics', 'detect_nsfw', 'redact_pii', 'extract_fields', 'recognize_shape',
      'suggest_title', 'moderate_text', 'transcribe_audio', 'detect_speakers',
      // Remote Jev decisions (opt-in).
      'decision_choose_jev', 'decision_judgments_jev',
    ])

    /** The first text block of a tool result, or null. */
    function resultText(block) {
      const content = block && Array.isArray(block.content) ? block.content : []
      for (let index = 0; index < content.length; index += 1) {
        const entry = content[index]
        if (entry && entry.type === 'text' && typeof entry.text === 'string') return entry.text
      }
      return null
    }

    /** The raw arguments text of any phase, or ''. */
    function argsText(block) {
      if (!block || typeof block !== 'object') return ''
      if (typeof block.argsRaw === 'string' && block.argsRaw.length > 0) return block.argsRaw
      if (block.args && typeof block.args.raw === 'string') return block.args.raw
      return ''
    }

    /** Parse JSON without throwing: a half-streamed argument block is normal. */
    function safeJson(text) {
      if (typeof text !== 'string' || text.length === 0) return null
      try {
        return JSON.parse(text)
      } catch (error) {
        return null
      }
    }

    /** The host envelope, from the payload or the result record, or null. */
    function envelopeOf(payload, block) {
      if (payload && typeof payload === 'object' && payload.meta && typeof payload.meta === 'object') {
        return payload.meta
      }
      if (block && block.meta && typeof block.meta === 'object') return block.meta
      return null
    }

    /** Round a measured number for display, keeping enough digits to compare. */
    function number(value) {
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : null
    }

    /** Numbers inside a vector, truncated to the first three. */
    function firstValues(vector, count) {
      if (!Array.isArray(vector)) return []
      return vector.slice(0, count).map(value => (typeof value === 'number' ? String(value) : String(value)))
    }

    /**
     * One line per tool family, describing what the call actually produced.
     *
     * Every branch reads a field the tool's own contract declares; a shape the
     * branch does not recognize falls through to the raw JSON disclosure rather
     * than a guessed sentence.
     * @param toolName - the wire tool name.
     * @param payload - the parsed result payload, or null.
     * @returns display lines (never null).
     */
    function summaryFor(toolName, payload) {
      if (payload === null || typeof payload !== 'object') return []
      const lines = []
      switch (toolName) {
        case 'multimodal_embed': {
          const vector = Array.isArray(payload.vectors) ? payload.vectors[0] : null
          if (vector) {
            lines.push('dimensions ' + String(vector.dimensions) + ' · normalized ' + String(vector.normalized === true))
            lines.push('first values ' + firstValues(vector.values, 3).join(', '))
            if (typeof vector.embeddingSpaceId === 'string') lines.push('space ' + vector.embeddingSpaceId)
          }
          break
        }
        case 'semantic_similarity': {
          if (typeof payload.score === 'number') {
            lines.push('score ' + (number(payload.score) ?? '?') + ' · ' + String(payload.scoreKind))
          }
          break
        }
        case 'semantic_rank':
          if (Array.isArray(payload.results)) {
            lines.push(payload.results.length + ' ranked · ' + String(payload.scoreKind))
          }
          break
        case 'semantic_classify':
          if (typeof payload.label === 'string' || typeof payload.status === 'string') {
            lines.push('label ' + String(payload.label ?? payload.status))
          }
          break
        case 'semantic_deduplicate':
          if (Array.isArray(payload.groups)) lines.push(payload.groups.length + ' group(s)')
          break
        case 'dedupe_and_rank': {
          if (Array.isArray(payload.groups) && Array.isArray(payload.ranking)) {
            lines.push(payload.groups.length + ' group(s) · ' + payload.ranking.length
              + ' ranked at threshold ' + String(payload.threshold))
          }
          break
        }
        case 'media_find_moments': {
          const match = Array.isArray(payload.matches) ? payload.matches[0] : null
          if (match) {
            lines.push('top window ' + String(match.startSeconds) + '–' + String(match.endSeconds) + ' s · score '
              + (number(match.score) ?? '?'))
          }
          lines.push(String(payload.windowsEvaluated) + ' window(s) evaluated')
          break
        }
        case 'decision_choose':
          if (typeof payload.chosen !== 'string') break
          lines.push('chosen ' + String(payload.chosen))
          lines.push('confidence ' + String(payload.confidence) + ' · calibrated ' + String(payload.calibrated))
          break
        case 'decision_test':
          if (typeof payload.decision !== 'string') break
          lines.push('decision ' + String(payload.decision))
          lines.push('confidence ' + String(payload.confidence) + ' · calibrated ' + String(payload.calibrated))
          break
        case 'decision_score':
          if (typeof payload.score !== 'string') break
          lines.push('score ' + String(payload.score))
          lines.push('confidence ' + String(payload.confidence) + ' · calibrated ' + String(payload.calibrated))
          break
        case 'validate_record':
          if (typeof payload.valid !== 'boolean') break
          lines.push('valid ' + String(payload.valid) + ' · ' + (Array.isArray(payload.issues) ? payload.issues.length : 0) + ' issue(s)')
          break
        case 'extract_with_repair':
          if (typeof payload.valid !== 'boolean') break
          lines.push('valid ' + String(payload.valid) + ' · repaired ' + String(payload.repaired === true)
            + ' · ' + (Array.isArray(payload.attempts) ? payload.attempts.length : 0) + ' attempt(s)')
          break
        case 'structured_extract':
          if (typeof payload.valid !== 'boolean') break
          lines.push('proposed ' + String(payload.proposed === true) + ' · valid ' + String(payload.valid))
          break
        case 'tools_plan':
          if (!Array.isArray(payload.proposals)) break
          lines.push(payload.proposals.length + ' proposal(s) · '
            + (Array.isArray(payload.suppressed) ? payload.suppressed.length : 0) + ' suppressed')
          break
        case 'stt_transcribe':
          if (typeof payload.text === 'string') lines.push('"' + payload.text.slice(0, 120) + '"')
          break
        case 'lang_detect':
          lines.push('language ' + String(payload.language ?? '?'))
          break
        case 'text_title':
          if (typeof payload.title === 'string') lines.push(payload.title)
          break
        case 'text_embed':
          lines.push('dimensions ' + String(Array.isArray(payload.vectors) && payload.vectors[0]
            ? payload.vectors[0].dimensions : '?'))
          break
        case 'text_rerank':
          lines.push((Array.isArray(payload.ranking) || Array.isArray(payload.results)
            ? (payload.ranking ?? payload.results).length : 0) + ' ranked')
          break
        case 'model_tools':
        case 'model_tools_manage': {
          if (typeof payload.action === 'string') lines.push('action ' + payload.action)
          if (typeof payload.installed === 'number') {
            lines.push('installed ' + String(payload.installed) + ' · runnable ' + String(payload.runnable))
          }
          break
        }
        case 'redact_text':
          if (Array.isArray(payload.spans)) lines.push(payload.spans.length + ' span(s)')
          break
        case 'shape_recognize':
          if (typeof payload.shape === 'string') {
            lines.push('shape ' + payload.shape + ' · confidence ' + (number(payload.confidence) ?? '?'))
          }
          break
        case 'detect_fillers':
          if (Array.isArray(payload.fillers)) lines.push(payload.fillers.length + ' filler span(s)')
          break
        case 'enhance_speech':
          if (typeof payload.sampleRate === 'number' && typeof payload.durationSeconds === 'number') {
            lines.push(String(payload.sampleRate) + ' Hz · ' + String(payload.durationSeconds) + ' s')
          }
          if (payload.coverage && typeof payload.coverage === 'object') {
            lines.push('coverage complete ' + String(payload.coverage.complete === true))
          }
          break
        case 'classify_nsfw':
          if (typeof payload.isNSFW === 'boolean') {
            lines.push('isNSFW ' + String(payload.isNSFW) + ' · score ' + (number(payload.score) ?? '?'))
          }
          break
        case 'identify_language':
          if (typeof payload.language === 'string') {
            lines.push('language ' + payload.language + ' · confidence ' + (number(payload.confidence) ?? '?'))
          }
          if (typeof payload.isReliable === 'boolean') lines.push('reliable ' + String(payload.isReliable))
          break
        case 'suggest_emojis': {
          const top = Array.isArray(payload.suggestions) ? payload.suggestions[0] : null
          if (top && typeof top.emoji === 'string') {
            lines.push(top.emoji + ' · confidence ' + (number(top.confidence) ?? '?'))
          }
          break
        }
        case 'decision_combine':
          if (typeof payload.exit === 'string') lines.push('exit ' + payload.exit)
          break
        default:
          break
      }
      return lines
    }

    /** A small inline badge. */
    function badge(text, tone) {
      return h('span', {
        style: {
          display: 'inline-block', padding: '1px 6px', marginLeft: 6, borderRadius: 9,
          fontSize: 11, lineHeight: '16px',
          background: tone === 'device' ? '#e8f5ec' : tone === 'remote' ? '#fff4e5' : '#eef1f5',
          color: tone === 'device' ? '#1f6b3a' : tone === 'remote' ? '#8a5a00' : '#4a5563',
          border: '1px solid ' + (tone === 'device' ? '#b7e0c4' : tone === 'remote' ? '#f0d29b' : '#d7dce3'),
        },
      }, text)
    }

    /**
     * The chat row for one Tool Mode call.
     *
     * Shows the tool, the extension/model that answered, the device/remote route,
     * the receipt, and a family-specific summary; the full JSON is behind a
     * disclosure so a long embedding payload never floods the transcript.
     */
    function ToolModeToolCard(props) {
      const block = props.block
      const toolName = props.toolName
      const payload = safeJson(resultText(block))
      const args = safeJson(argsText(block))
      const envelope = envelopeOf(payload, block)
      const failed = block && block.isError === true
      const phase = block && typeof block.phase === 'string' ? block.phase : 'result'

      const metaBits = []
      if (envelope && typeof envelope.extension === 'string') metaBits.push(envelope.extension)
      if (envelope && typeof envelope.implementationId === 'string') metaBits.push(envelope.implementationId)
      if (envelope && typeof envelope.extensionVersion === 'string') metaBits.push('v' + envelope.extensionVersion)
      if (envelope && typeof envelope.receiptId === 'string') metaBits.push(envelope.receiptId)
      else if (phase === 'result' && !failed) metaBits.push('no receipt')

      const lines = summaryFor(toolName, payload)
      const failureText = failed
        ? (block.error && (block.error.reason ?? block.error.code)) ?? resultText(block) ?? 'the call failed'
        : null

      const rawArgs = argsText(block)
      const rawResult = resultText(block)

      return h('div', {
        style: {
          border: '1px solid #d7dce3', borderRadius: 8, padding: '8px 10px', margin: '4px 0',
          background: '#fbfcfd', fontSize: 13,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 } },
        h('span', { style: { fontWeight: 600 } }, toolName),
        envelope && typeof envelope.executionLocation === 'string'
          ? badge(envelope.executionLocation, envelope.executionLocation)
          : null,
        phase !== 'result' ? badge(phase) : null,
        failureText !== null ? badge('error', 'remote') : null),
      metaBits.length > 0
        ? h('div', { style: { color: '#5b6675', fontSize: 12, marginTop: 2 } }, metaBits.join(' · '))
        : null,
      failureText !== null
        ? h('div', { style: { color: '#8a1f1f', marginTop: 4 } }, String(failureText))
        : null,
      lines.length > 0
        ? h('div', { style: { marginTop: 4 } }, lines.map((line, index) => h('div', { key: 'line-' + index }, line)))
        : null,
      h('details', { style: { marginTop: 6 } },
        h('summary', { style: { cursor: 'pointer', color: '#5b6675', fontSize: 12 } }, 'arguments and result'),
        h('div', { style: { marginTop: 4 } },
          h('div', { style: { fontSize: 11, color: '#5b6675' } }, 'arguments'),
          h('pre', { style: { margin: 0, maxHeight: 160, overflow: 'auto', fontSize: 11 } }, pretty(rawArgs)),
          h('div', { style: { fontSize: 11, color: '#5b6675', marginTop: 4 } }, 'result'),
          h('pre', { style: { margin: 0, maxHeight: 240, overflow: 'auto', fontSize: 11 } }, pretty(rawResult)))))
    }

    /**
     * The trace a `tool_mode_run` result carries, or [].
     *
     * The host reports `meta.calls` as a BOUNDED list (name, ok, elapsedMs, previews);
     * this function is the one place that shape is read, so the card and its tests agree.
     * @param payload - the parsed run report.
     * @returns the trace entries.
     */
    function runTrace(payload) {
      if (payload === null || typeof payload !== 'object') return []
      const meta = payload.meta
      if (meta === null || typeof meta !== 'object' || !Array.isArray(meta.calls)) return []
      return meta.calls.filter(call => call !== null && typeof call === 'object' && typeof call.name === 'string')
    }

    /**
     * The chat row for a Code Mode program.
     *
     * Shows the program's description and requested tool set, then the ORDERED sub-call
     * trace (which tool, whether it succeeded, how long, argument/result previews), the
     * program's own logs and result, and the run's receipt. This is the only way a reader
     * can see how a program combined tools: the tool result itself reports a count.
     */
    function ToolModeRunCard(props) {
      const block = props.block
      const payload = safeJson(resultText(block))
      const args = safeJson(argsText(block))
      const trace = runTrace(payload)
      const meta = payload && typeof payload === 'object' && payload.meta && typeof payload.meta === 'object'
        ? payload.meta : null
      const failed = block && block.isError === true
      const requested = args && Array.isArray(args.tools) ? args.tools : []
      const code = args && typeof args.code === 'string' ? args.code : ''
      const logs = payload && Array.isArray(payload.logs) ? payload.logs : []

      return h('div', {
        style: {
          border: '1px solid #cfd8e3', borderRadius: 8, padding: '8px 10px', margin: '4px 0',
          background: '#f7fafc', fontSize: 13,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 } },
        h('span', { style: { fontWeight: 600 } }, 'tool_mode_run'),
        badge('code mode', 'device'),
        meta && typeof meta.toolCalls === 'number' ? badge(meta.toolCalls + ' tool call(s)') : null,
        failed ? badge('error', 'remote') : null),
      args && typeof args.description === 'string'
        ? h('div', { style: { marginTop: 2 } }, args.description)
        : null,
      meta !== null
        ? h('div', { style: { color: '#5b6675', fontSize: 12, marginTop: 2 } },
          [typeof meta.receiptId === 'string' ? meta.receiptId : null,
            typeof meta.elapsedMs === 'number' ? meta.elapsedMs + ' ms' : null,
            typeof meta.catalogRevision === 'string' ? 'catalog ' + meta.catalogRevision : null]
            .filter(part => part !== null).join(' · '))
        : null,
      requested.length > 0
        ? h('div', { style: { marginTop: 4, fontSize: 12 } },
          h('span', { style: { color: '#5b6675' } }, 'tools available: '),
          requested.map(name => badge(String(name), 'plain')))
        : null,
      trace.length > 0
        ? h('div', { style: { marginTop: 6 } },
          h('div', { style: { fontSize: 11, color: '#5b6675' } }, 'sub-calls, in dispatch order'),
          trace.map((call, index) => h('div', {
            key: 'trace-' + index,
            style: {
              marginTop: 3, paddingLeft: 6,
              borderLeft: '2px solid ' + (call.ok === true ? '#b7e0c4' : '#e7b4b4'),
            },
          },
          h('div', null,
            h('span', { style: { fontWeight: 600 } }, String(index + 1) + '. ' + call.name),
            ' ',
            badge(call.ok === true ? 'ok' : 'failed', call.ok === true ? 'device' : 'remote'),
            typeof call.elapsedMs === 'number'
              ? h('span', { style: { color: '#5b6675', fontSize: 11 } }, ' ' + call.elapsedMs + ' ms')
              : null),
          h('div', { style: { fontSize: 11, color: '#4a5563', whiteSpace: 'pre-wrap' } },
            typeof call.argumentsPreview === 'string' ? 'args ' + call.argumentsPreview : ''),
          typeof call.resultPreview === 'string'
            ? h('div', { style: { fontSize: 11, color: '#4a5563', whiteSpace: 'pre-wrap' } },
              'result ' + call.resultPreview)
            : null,
          typeof call.error === 'string'
            ? h('div', { style: { fontSize: 11, color: '#8a1f1f' } }, 'error ' + call.error)
            : null)))
        : h('div', { style: { fontSize: 12, color: '#5b6675', marginTop: 4 } },
          'No sub-call trace was reported for this run.'),
      logs.length > 0
        ? h('details', { style: { marginTop: 6 } },
          h('summary', { style: { cursor: 'pointer', fontSize: 12 } }, 'logs (' + logs.length + ')'),
          h('pre', { style: { margin: 0, maxHeight: 140, overflow: 'auto', fontSize: 11 } }, logs.join('\n')))
        : null,
      h('details', { style: { marginTop: 6 } },
        h('summary', { style: { cursor: 'pointer', fontSize: 12 } }, 'program, arguments and result'),
        h('div', { style: { marginTop: 4 } },
          h('div', { style: { fontSize: 11, color: '#5b6675' } }, 'program'),
          h('pre', { style: { margin: 0, maxHeight: 220, overflow: 'auto', fontSize: 11 } },
            code.length > 0 ? code : '(none)'),
          h('div', { style: { fontSize: 11, color: '#5b6675', marginTop: 4 } }, 'result'),
          h('pre', { style: { margin: 0, maxHeight: 240, overflow: 'auto', fontSize: 11 } },
            payload !== null && typeof payload === 'object' && 'result' in payload
              ? pretty(JSON.stringify(payload.result))
              : pretty(resultText(block))))))
    }

    /** Pretty-print JSON when it parses; otherwise show the raw text unchanged. */
    function pretty(text) {
      const parsed = safeJson(text)
      if (parsed === null) return typeof text === 'string' && text.length > 0 ? text : '(none)'
      try {
        return JSON.stringify(parsed, null, 2)
      } catch (error) {
        return String(text)
      }
    }

    /**
     * Register the card for every known tool name.
     *
     * One registration per key: the slot is keyed by tool name, and a missing
     * key falls back to the generic card. Disposers are registered through
     * `ctx.effect` so a disabled/reloaded plugin leaves no view behind.
     * @param ctx - the client plugin context, with the `slots` service.
     */
    function register(ctx) {
      if (!ctx || !ctx.slots) return
      for (const toolName of TOOL_NAMES) {
        ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: toolName,
          // Code Mode needs its own view: the program, the tools it could call, and the
          // ordered sub-call trace are not fields the generic family summary reads.
        }, toolName === 'tool_mode_run' ? ToolModeRunCard : ToolModeToolCard)))
      }
    }

  return {
    TOOL_NAMES,
    ToolModeToolCard,
    ToolModeRunCard,
    runTrace,
    summaryFor,
    register,
    internals: { safeJson, resultText, argsText, envelopeOf, pretty, firstValues, runTrace },
  }
}

    const toolviews = createToolviews(h)

    // The Tool Insights page, INLINED at build time from client/tool-insights.js
    // for the same reason: a sibling chunk is a 404 and the page would vanish.
    /**
 * Tool Insights — the three-tab first-level page (Tool Insights / Tool Inventory /
 * MCP) in the approved blue system.
 *
 * THIS FILE IS INLINED INTO client/index.js by `scripts/gen-client-catalog.mjs`.
 * It is deliberately not a sibling chunk: the client module service serves only the
 * bundle file a plugin declares, so a chunk would answer 404 and the page would
 * silently disappear (the same reason the chat cards are inlined).
 *
 * Data sources, all guarded:
 * - the compact `toolModeUsage` projection carried by each session row in
 *   `projectionValues` (free with `session.list`);
 * - the host's additive Remote methods `toolUsageReport`, `toolInventory`,
 *   `mcpStatus` and `mcpCalls`, reached through the injected `call(method, args)`
 *   (which already unwraps RemoteResult and never throws).
 *
 * Nothing here invents data: a missing projection is an empty state, a failed
 * report is a named degraded mode that says what is missing, and an older host
 * without the methods still renders the page from the compact projection.
 *
 * @param createElement - React.createElement, supplied by the client bundle.
 * @param reactLib - React itself (hooks); the bundle passes it, tests may stub it.
 * @returns the page components and the pure helpers (also used by tests).
 */
function createToolInsights(createElement, reactLib) {
  const h = createElement
  const React = reactLib

  /** The blue system from the approved cover card. */
  const PALETTE = Object.freeze({
    primary: '#4F63FF',
    tint: '#E9EDFF',
    page: '#F7F8FC',
    surface: '#F5F8FF',
    border: '#E5E8F2',
    ink: '#0B1015',
    muted: '#5F6B80',
    failure: '#B7791F',
  })

  const TABS = Object.freeze([
    { id: 'insights', label: 'Tool Insights' },
    { id: 'inventory', label: 'Tool Inventory' },
    { id: 'mcp', label: 'MCP' },
    { id: 'create', label: 'Create tool' },
    { id: 'settings', label: 'Settings' },
  ])

  const RANGES = Object.freeze(['24h', '7d', '30d', 'all'])
  const TOOL_PAGE_SIZES = Object.freeze([25, 50, 100])
  const CALL_PAGE_SIZES = Object.freeze([10, 25, 50])
  const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

  // ── small value helpers ────────────────────────────────────────────────────

  /** A plain object (arrays and null excluded). */
  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  /** A finite number, else null. */
  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  /** A non-negative finite number, else 0. */
  function count(value) {
    const number = finite(value)
    return number === null || number < 0 ? 0 : number
  }

  /** A non-empty string, else undefined. */
  function text(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }

  /** Assign an own data property, so `__proto__` and `constructor` stay data. */
  function own(target, key, value) {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
    return target
  }

  /** Iterate the own entries of a plain object, tolerating any junk. */
  function entries(value) {
    if (!isObject(value)) return []
    return Object.keys(value).map(key => [key, value[key]])
  }

  // ── tabs and deep links ────────────────────────────────────────────────────

  /**
   * Resolve a location.hash to a tab id.
   * @param hash - `location.hash` (any value; junk falls back to insights).
   * @returns the matching tab id from {@link TABS}, else 'insights'.
   */
  function readTabFromHash(hash) {
    if (typeof hash !== 'string') return 'insights'
    const id = hash.replace(/^#/, '').trim().toLowerCase()
    return TABS.some(entry => entry.id === id) ? id : 'insights'
  }

  /** The hash to write for a tab id (invalid ids fall back to insights). */
  function tabHash(id) {
    return '#' + readTabFromHash('#' + String(id))
  }

  // ── formatting ─────────────────────────────────────────────────────────────

  /** Group the integer part with commas; non-numbers are an em dash. */
  function formatNumber(value) {
    const number = finite(value)
    if (number === null) return '—'
    return Math.round(number).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  /** A fraction as a percentage; a missing fraction is an em dash. */
  function formatPercent(value) {
    const number = finite(value)
    if (number === null) return '—'
    const percent = number * 100
    return (Number.isInteger(percent) ? String(percent) : percent.toFixed(1)) + '%'
  }

  /** Milliseconds in a compact human duration. */
  function formatDuration(value) {
    const number = finite(value)
    if (number === null) return '—'
    if (number < 1000) return Math.max(0, Math.round(number)) + 'ms'
    if (number < 60_000) return (number / 1000).toFixed(1) + 's'
    const minutes = Math.floor(number / 60_000)
    const seconds = Math.round((number % 60_000) / 1000)
    return minutes + 'm' + (seconds === 0 ? '' : ' ' + seconds + 's')
  }

  /** Bytes in KB/MB, bounded to one decimal. */
  function formatBytes(value) {
    const number = finite(value)
    if (number === null) return '—'
    if (number < 1024) return Math.round(number) + ' B'
    if (number < 1024 * 1024) return (number / 1024).toFixed(1) + ' KB'
    return (number / (1024 * 1024)).toFixed(1) + ' MB'
  }

  /** A relative "n ago" label; a missing time is an em dash. */
  function formatAgo(value, now) {
    const time = finite(value)
    const current = finite(now) ?? Date.now()
    if (time === null) return '—'
    const delta = Math.max(0, current - time)
    if (delta < 10_000) return 'just now'
    if (delta < 60_000) return Math.round(delta / 1000) + 's ago'
    if (delta < 3_600_000) return Math.round(delta / 60_000) + 'm ago'
    if (delta < DAY_MILLISECONDS) return Math.round(delta / 3_600_000) + 'h ago'
    return Math.round(delta / DAY_MILLISECONDS) + 'd ago'
  }

  // ── pagination ─────────────────────────────────────────────────────────────

  /**
   * Page math for a list.
   * @param total - number of rows.
   * @param pageSize - rows per page (positive).
   * @param page - requested page (clamped into range).
   * @returns { page, pages, from, to, total, pageSize } (1-based, inclusive).
   */
  function pageInfo(total, pageSize, page) {
    const size = finite(pageSize) !== null && pageSize > 0 ? Math.floor(pageSize) : 10
    const rows = Math.max(0, Math.floor(finite(total) ?? 0))
    const pages = Math.max(1, Math.ceil(rows / size))
    const requested = Math.floor(finite(page) ?? 1)
    const current = Math.min(Math.max(requested, 1), pages)
    return {
      page: current,
      pages,
      from: rows === 0 ? 0 : (current - 1) * size + 1,
      to: Math.min(current * size, rows),
      total: rows,
      pageSize: size,
    }
  }

  /** Slice rows for a page and return both slices and page math. */
  function paginate(rows, page, pageSize) {
    const list = Array.isArray(rows) ? rows : []
    const info = pageInfo(list.length, pageSize, page)
    return { rows: list.slice(info.from === 0 ? 0 : info.from - 1, info.to), info }
  }

  // ── compact projection ────────────────────────────────────────────────────

  /** A normalized per-owner/entry usage triple. */
  function usageTriple(value) {
    if (!isObject(value)) return null
    return { calls: count(value.calls), errors: count(value.errors), ms: count(value.ms) }
  }

  /**
   * Normalize the compact wire one session row carries.
   * @param value - `projectionValues.toolModeUsage` (any shape).
   * @returns the normalized compact value, or null when it is not an object.
   */
  function normalizeProjection(value) {
    if (!isObject(value)) return null
    const projection = {
      calls: count(value.calls),
      errors: Math.min(count(value.errors), count(value.calls)),
      toolMs: count(value.toolMs),
      uniqueTools: count(value.uniqueTools),
      byOwner: {},
      byModel: {},
      byDay: {},
      recent: [],
      topTools: [],
    }
    for (const [owner, usage] of entries(value.byOwner)) {
      const triple = usageTriple(usage)
      if (triple !== null && owner.length > 0) own(projection.byOwner, owner, triple)
    }
    for (const [model, usage] of entries(value.byModel)) {
      const triple = usageTriple(usage)
      if (triple === null || model.length === 0) continue
      own(projection.byModel, model, { ...triple, tools: count(usage.tools) })
    }
    for (const [day, usage] of entries(value.byDay)) {
      const triple = usageTriple(usage)
      if (triple === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      own(projection.byDay, day, triple)
    }
    if (Array.isArray(value.recent)) {
      for (const candidate of value.recent) {
        if (!isObject(candidate) || typeof candidate.name !== 'string' || candidate.name.length === 0) continue
        const recent = {
          time: finite(candidate.time),
          name: candidate.name,
          model: text(candidate.model),
          ms: finite(candidate.ms),
          ok: candidate.ok !== false,
          kind: candidate.kind === 'code' ? 'code' : 'direct',
        }
        if (projection.recent.length < 20) projection.recent.push(recent)
      }
    }
    if (Array.isArray(value.topTools)) {
      for (const candidate of value.topTools) {
        if (!isObject(candidate) || typeof candidate.name !== 'string' || candidate.name.length === 0) continue
        if (projection.topTools.length >= 5) break
        projection.topTools.push({ name: candidate.name, calls: count(candidate.calls), ms: count(candidate.ms) })
      }
    }
    return projection
  }

  /** Merge one normalized compact value into an aggregate. */
  function mergeProjection(target, projection, top) {
    target.calls += projection.calls
    target.errors += projection.errors
    target.toolMs += projection.toolMs
    target.uniqueTools = Math.max(target.uniqueTools, projection.uniqueTools)
    for (const [owner, usage] of entries(projection.byOwner)) {
      const previous = Object.hasOwn(target.byOwner, owner) && isObject(target.byOwner[owner])
        ? target.byOwner[owner]
        : { calls: 0, errors: 0, ms: 0 }
      own(target.byOwner, owner, { calls: previous.calls + usage.calls, errors: previous.errors + usage.errors, ms: previous.ms + usage.ms })
    }
    for (const [model, usage] of entries(projection.byModel)) {
      const previous = Object.hasOwn(target.byModel, model) && isObject(target.byModel[model])
        ? target.byModel[model]
        : { calls: 0, errors: 0, tools: 0, ms: 0 }
      own(target.byModel, model, {
        calls: previous.calls + usage.calls,
        errors: previous.errors + usage.errors,
        tools: Math.max(previous.tools, usage.tools),
        ms: previous.ms + usage.ms,
      })
    }
    for (const [day, usage] of entries(projection.byDay)) {
      const previous = Object.hasOwn(target.byDay, day) && isObject(target.byDay[day])
        ? target.byDay[day]
        : { calls: 0, errors: 0, ms: 0 }
      own(target.byDay, day, { calls: previous.calls + usage.calls, errors: previous.errors + usage.errors, ms: previous.ms + usage.ms })
    }
    for (const recent of projection.recent) {
      if (target.recent.length >= 200) break
      target.recent.push(recent)
    }
    for (const tool of projection.topTools) {
      const previous = top.get(tool.name) ?? { name: tool.name, calls: 0, ms: 0 }
      previous.calls += tool.calls
      previous.ms += tool.ms
      top.set(tool.name, previous)
    }
  }

  /**
   * Aggregate the compact projection across session rows.
   * @param rows - session rows carrying `projectionValues.toolModeUsage`.
   * @returns totals, rollups, bounded recent/top lists and coverage counts.
   */
  function aggregateProjections(rows) {
    const aggregate = {
      calls: 0, errors: 0, toolMs: 0, uniqueTools: 0,
      byOwner: {}, byModel: {}, byDay: {},
      recent: [], topTools: [],
      coverage: { sessions: 0, covered: 0 },
    }
    const top = new Map()
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!isObject(row)) continue
      aggregate.coverage.sessions += 1
      const projectionValues = row.projectionValues
      if (!isObject(projectionValues)) continue
      const projection = normalizeProjection(projectionValues.toolModeUsage)
      if (projection === null) continue
      aggregate.coverage.covered += 1
      mergeProjection(aggregate, projection, top)
    }
    aggregate.topTools = [...top.values()].sort((left, right) => right.calls - left.calls).slice(0, 5)
    aggregate.sessions = aggregate.coverage.covered
    aggregate.recent.sort((left, right) => (finite(right.time) ?? 0) - (finite(left.time) ?? 0))
    return aggregate
  }

  // ── host report ───────────────────────────────────────────────────────────

  /** Normalize one report tool row; null when it carries no name. */
  function reportTool(value) {
    if (!isObject(value) || typeof value.name !== 'string' || value.name.length === 0) return null
    return {
      name: value.name,
      owner: text(value.owner),
      calls: count(value.calls),
      errors: Math.min(count(value.errors), count(value.calls)),
      totalMs: count(value.totalMs),
      maxMs: finite(value.maxMs),
      p50: finite(value.p50),
      p95: finite(value.p95),
      firstUsed: finite(value.firstUsed),
      lastUsed: finite(value.lastUsed),
      codeCalls: count(value.codeCalls),
    }
  }

  /** Normalize one report model row; null when it carries no model. */
  function reportModel(value) {
    if (!isObject(value) || typeof value.model !== 'string' || value.model.length === 0) return null
    return {
      model: value.model,
      calls: count(value.calls),
      errors: Math.min(count(value.errors), count(value.calls)),
      tools: count(value.tools),
      ms: count(value.ms),
      p50: finite(value.p50),
      p95: finite(value.p95),
    }
  }

  /** Normalize a call row for the All calls table. */
  function callRow(value) {
    if (!isObject(value) || typeof value.name !== 'string' || value.name.length === 0) return null
    const callId = text(value.callId)
    const time = finite(value.time)
    if (callId === undefined && time === null) return null
    return {
      time,
      name: value.name,
      owner: text(value.owner),
      model: text(value.model),
      ms: finite(value.ms),
      ok: value.ok !== false && value.isError !== true,
      errorCode: text(value.errorCode) ?? text(value.error?.code),
      kind: value.kind === 'code' ? 'code' : 'direct',
      callId,
      parentCallId: text(value.parentCallId),
      sessionId: text(value.sessionId),
      workspace: text(value.workspace),
    }
  }

  /**
   * Normalize the host report, dropping malformed rows and preserving only facts.
   * @param value - the `toolUsageReport` value.
   * @returns the normalized report, or null when it is not a usable object.
   */
  function normalizeReport(value) {
    if (!isObject(value)) return null
    const tools = []
    for (const candidate of Array.isArray(value.tools) ? value.tools : []) {
      const row = reportTool(candidate)
      if (row !== null) tools.push(row)
    }
    const models = []
    for (const candidate of Array.isArray(value.models) ? value.models : []) {
      const row = reportModel(candidate)
      if (row !== null) models.push(row)
    }
    const days = []
    for (const candidate of Array.isArray(value.days) ? value.days : []) {
      if (!isObject(candidate) || typeof candidate.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.day)) continue
      days.push({ day: candidate.day, calls: count(candidate.calls), errors: count(candidate.errors), ms: count(candidate.ms) })
    }
    const calls = []
    const callList = Array.isArray(value.calls)
      ? value.calls
      : Array.isArray(value.callRows) ? value.callRows : Array.isArray(value.recentCalls) ? value.recentCalls : []
    for (const candidate of callList) {
      const row = callRow(candidate)
      if (row !== null) calls.push(row)
    }
    calls.sort((left, right) => (finite(right.time) ?? 0) - (finite(left.time) ?? 0))
    // A host may send `calls` as the count or as the list itself; when it is the
    // list the count comes from `callCount`, else from the list length.
    const callCount = Array.isArray(value.calls)
      ? (finite(value.callCount) !== null ? count(value.callCount) : calls.length)
      : count(value.calls)
    return {
      calls: callCount,
      errors: Math.min(count(value.errors), callCount),
      unsettled: count(value.unsettled),
      toolMs: count(value.toolMs),
      codeCalls: count(value.codeCalls),
      sessions: count(value.sessions),
      p50: finite(value.p50),
      p95: finite(value.p95),
      tools,
      models,
      days,
      callRows: calls,
    }
  }

  // ── derived view model ────────────────────────────────────────────────────

  /** Milliseconds covered by a range id. */
  function rangeWindow(range, now) {
    const current = finite(now) ?? Date.now()
    const days = range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : null
    return { from: days === null ? null : current - days * DAY_MILLISECONDS, to: current }
  }

  /**
   * The query value for `toolUsageReport`. `all` is range-only: a numeric window
   * requires both bounds and null is not a number. The value is passed
   * POSITIONALLY to the generated method (see requestUsageReport).
   */
  function reportQuery(range, now) {
    const window = rangeWindow(range, now)
    return window.from === null ? { range } : { range, from: window.from, to: window.to }
  }

  /**
   * Call the positional Client Remote method. The generated namespace takes the
   * descriptor's parameters positionally and the gateway builds the wire
   * `args` object; passing `{ query: … }` here would nest it one level too deep
   * and the host would fall back to its default 7d window.
   */
  function requestUsageReport(call, range, now) {
    return call('toolUsageReport', reportQuery(range, now))
  }

  /** The same positional convention for the MCP calls page. */
  function requestMcpCalls(call, page, pageSize) {
    return call('mcpCalls', { page, pageSize })
  }

  /** Success rate for a calls/errors pair (null when there were no calls). */
  function successRate(calls, errors) {
    return calls > 0 ? (calls - Math.min(errors, calls)) / calls : null
  }

  /** Success rate of a tool row; null when the row carries no error facts. */
  function toolSuccessRate(tool) {
    return typeof tool.errors === 'number' && typeof tool.calls === 'number' ? successRate(tool.calls, tool.errors) : null
  }

  /**
   * Success ratio for an inventory row. The host's `success` column is a COUNT
   * of successful calls (not a ratio); normalize it here so every renderer
   * formats the same value.
   */
  function inventorySuccessRate(row) {
    const calls = finite(row.calls)
    const success = finite(row.success)
    if (calls === null || success === null || calls <= 0) return null
    return Math.max(0, Math.min(success, calls)) / calls
  }

  /**
   * Build the workbench view model from the compact projection and/or the report.
   * The report wins when present; otherwise the page degrades to the compact
   * projection and says so.
   * @param input - { projection, report, range, now, toolsAvailable }.
   * @returns { degraded, banner, kpis, days, models, tools, calls, range }.
   */
  function deriveInsights(input) {
    const projection = isObject(input.projection) ? input.projection : aggregateProjections([])
    const report = normalizeReport(input.report)
    const range = typeof input.range === 'string' ? input.range : '7d'
    const toolsAvailable = finite(input.toolsAvailable)

    if (report !== null) {
      const tools = report.tools.slice().sort((left, right) => right.calls - left.calls)
      return {
        degraded: false,
        banner: null,
        range,
        kpis: {
          calls: report.calls,
          errors: report.errors,
          unsettled: report.unsettled,
          successRate: successRate(report.calls, report.errors),
          toolMs: report.toolMs,
          sessions: report.sessions,
          callsPerSession: report.sessions > 0 ? report.calls / report.sessions : null,
          p50: report.p50,
          p95: report.p95,
          codeModeShare: report.calls > 0 ? report.codeCalls / report.calls : null,
          toolsUsed: report.tools.length,
          toolsAvailable,
        },
        days: report.days.slice().sort((left, right) => left.day.localeCompare(right.day)),
        models: report.models.slice().sort((left, right) => right.calls - left.calls),
        tools,
        calls: report.callRows.slice(),
        coverage: projection.coverage,
      }
    }

    const byDay = entries(projection.byDay)
      .map(([day, usage]) => ({ day, calls: usage.calls, errors: usage.errors, ms: usage.ms }))
      .sort((left, right) => left.day.localeCompare(right.day))
    const models = entries(projection.byModel)
      .map(([model, usage]) => ({ model, calls: usage.calls, errors: usage.errors, tools: usage.tools, ms: usage.ms, p50: null, p95: null }))
      .sort((left, right) => right.calls - left.calls)
    const tools = projection.topTools
      .slice()
      .sort((left, right) => right.calls - left.calls)
      .map(tool => ({ name: tool.name, owner: null, calls: tool.calls, errors: null, totalMs: tool.ms, maxMs: null, p50: null, p95: null, firstUsed: null, lastUsed: null, codeCalls: null }))
    const codeCalls = projection.recent.filter(recent => recent.kind === 'code').length
    return {
      degraded: true,
      banner: 'The exact host report is not available on this build; these figures come from session projections '
        + '(' + projection.coverage.covered + ' of ' + projection.coverage.sessions + ' sessions carry the usage projection).',
      range,
      kpis: {
        calls: projection.calls,
        errors: projection.errors,
        unsettled: null,
        successRate: successRate(projection.calls, projection.errors),
        toolMs: projection.toolMs,
        sessions: projection.sessions,
        callsPerSession: projection.sessions > 0 ? projection.calls / projection.sessions : null,
        p50: null,
        p95: null,
        codeModeShare: projection.calls > 0 ? codeCalls / projection.calls : null,
        toolsUsed: projection.uniqueTools,
        toolsAvailable,
      },
      days: byDay,
      models,
      tools,
      calls: projection.recent.slice(),
      coverage: projection.coverage,
    }
  }

  // ── Code Mode grouping ────────────────────────────────────────────────────

  /**
   * Group call rows: a `tool_mode_run` parent carries its component sub-calls.
   * A sub-call whose parent is absent is shown as its own row, never hidden.
   * @param calls - call rows (report or projection shape).
   * @returns top-level rows, each with a `children` array.
   */
  function groupCallRows(calls) {
    const rows = []
    for (const candidate of Array.isArray(calls) ? calls : []) {
      const row = callRow(candidate)
      if (row !== null) rows.push({ ...row, children: [] })
    }
    const byId = new Map()
    for (const row of rows) {
      if (row.callId !== undefined && !byId.has(row.callId)) byId.set(row.callId, row)
    }
    const top = []
    for (const row of rows) {
      const parent = row.parentCallId === undefined ? undefined : byId.get(row.parentCallId)
      if (parent !== undefined && parent !== row) parent.children.push(row)
      else top.push(row)
    }
    for (const row of top) {
      row.children.sort((left, right) => (finite(left.time) ?? 0) - (finite(right.time) ?? 0))
    }
    return top
  }

  // ── inventory ─────────────────────────────────────────────────────────────

  /** The origin group a tool belongs to. */
  function originOf(tool) {
    if (tool.kind === 'built-in' || tool.kind === 'core') return 'core'
    if (tool.kind === 'extension' || tool.kind === 'tool-mode') return 'tool-mode'
    if (tool.kind === 'custom') return 'custom'
    if (typeof tool.owner === 'string') {
      if (tool.owner.startsWith('@deepseek-ai/dsh')) return 'core'
      if (tool.owner.startsWith('@try-works/')) return 'tool-mode'
    }
    return 'other'
  }

  const ORIGIN_LABELS = Object.freeze({ core: 'DSH core', 'tool-mode': 'Tool Mode', custom: 'Custom tools', other: 'Other plugins' })

  /** Normalize one inventory row; null when it carries no usable name. */
  function inventoryRow(value) {
    if (!isObject(value) || typeof value.name !== 'string' || value.name.length === 0) return null
    const row = {
      name: value.name,
      description: text(value.description),
      owner: text(value.owner),
      kind: typeof value.kind === 'string' && value.kind.length > 0 ? value.kind : 'unknown',
      state: typeof value.state === 'string' && value.state.length > 0 ? value.state : 'unknown',
      extension: text(value.extension),
      extensionVersion: text(value.extensionVersion),
      contractVersion: text(value.contractVersion),
      argumentCount: finite(value.argumentCount),
      lastRegistered: finite(value.lastRegistered),
      calls: finite(value.calls),
      success: finite(value.success),
      lastUsed: finite(value.lastUsed),
      mcpExposed: value.mcpExposed === true ? true : value.mcpExposed === false ? false : undefined,
    }
    row.origin = originOf(row)
    return row
  }

  /**
   * Filter, group and paginate the inventory.
   * @param tools - raw inventory rows.
   * @param query - { query, origin, state, page, pageSize }.
   * @returns { available, groups, total, info, filtered }.
   */
  function filterAndGroupInventory(tools, query) {
    const options = isObject(query) ? query : {}
    const search = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
    const origin = typeof options.origin === 'string' && options.origin !== 'all' ? options.origin : 'all'
    const state = typeof options.state === 'string' && options.state !== 'all' ? options.state : 'all'
    const rows = []
    for (const candidate of Array.isArray(tools) ? tools : []) {
      const row = inventoryRow(candidate)
      if (row === null) continue
      if (origin !== 'all' && row.origin !== origin) continue
      if (state !== 'all' && row.state !== state) continue
      if (search.length > 0) {
        const haystack = (row.name + ' ' + (row.owner ?? '') + ' ' + (row.description ?? '') + ' ' + row.kind).toLowerCase()
        if (!haystack.includes(search)) continue
      }
      rows.push(row)
    }
    const page = paginate(rows, options.page, options.pageSize)
    const order = ['core', 'tool-mode', 'custom', 'other']
    const groups = order
      .map(id => ({ origin: id, label: ORIGIN_LABELS[id], rows: page.rows.filter(row => row.origin === id) }))
      .filter(group => group.rows.length > 0)
    return {
      available: true,
      groups,
      filtered: rows,
      total: rows.length,
      info: page.info,
    }
  }

  // ── MCP ───────────────────────────────────────────────────────────────────

  /** Normalize a names list or a {count,tools} object. */
  function namesOf(value) {
    if (Array.isArray(value)) return value.filter(name => typeof name === 'string' && name.length > 0)
    if (isObject(value) && Array.isArray(value.tools)) return value.tools.filter(name => typeof name === 'string' && name.length > 0)
    return []
  }

  /** Normalize the MCP status document; null when it is not usable. */
  function normalizeMcpStatus(value) {
    if (!isObject(value) || typeof value.enabled !== 'boolean') return null
    const endpoint = isObject(value.endpoint) ? value.endpoint : null
    const host = endpoint === null ? undefined : text(endpoint.host)
    const port = endpoint === null ? null : finite(endpoint.port)
    const path = endpoint === null ? undefined : text(endpoint.path)
    const url = host !== undefined && port !== null ? 'http://' + host + ':' + String(port) + (path ?? '') : null
    const clients = []
    for (const candidate of Array.isArray(value.clients) ? value.clients : []) {
      if (!isObject(candidate) || typeof candidate.id !== 'string' || candidate.id.length === 0) continue
      clients.push({
        id: candidate.id,
        label: text(candidate.label),
        calls: count(candidate.calls),
        errors: Math.min(count(candidate.errors), count(candidate.calls)),
        lastSeen: finite(candidate.lastSeen),
      })
    }
    const exposed = namesOf(value.exposed)
    const withheld = namesOf(value.withheld)
    return {
      enabled: value.enabled,
      endpoint: url,
      host: host ?? null,
      port,
      path: path ?? null,
      transport: text(value.transport) ?? null,
      scheme: isObject(value.auth) ? text(value.auth.scheme) ?? null : null,
      tokenFile: isObject(value.auth) ? text(value.auth.tokenFile) ?? null : null,
      uptimeMs: finite(value.uptimeMs),
      clients,
      exposed,
      withheld,
      exposedCount: exposed.length,
      withheldCount: withheld.length,
    }
  }

  /** Normalize one external call row. */
  function mcpCallRow(value) {
    if (!isObject(value) || typeof value.tool !== 'string' || value.tool.length === 0) return null
    return {
      time: finite(value.time),
      tool: value.tool,
      clientId: text(value.clientId) ?? 'unknown client',
      totalMs: finite(value.totalMs),
      failureClass: text(value.failureClass),
      inputBytes: finite(value.inputBytes),
      outputBytes: finite(value.outputBytes),
      receiptId: text(value.receiptId),
    }
  }

  /**
   * Build the MCP view model: endpoint, clients, exposure and a page of calls.
   * @param status - the `mcpStatus` value (or null when the host lacks it).
   * @param calls - the `mcpCalls` value (or null).
   * @param options - { page, pageSize }.
   */
  function mcpView(status, calls, options) {
    const normalized = normalizeMcpStatus(status)
    const optionsValue = isObject(options) ? options : {}
    if (normalized === null) {
      return {
        available: false,
        banner: 'The MCP status is not available on this host build (the mcpStatus remote method is absent).',
        enabled: false, endpoint: null, host: null, port: null, path: null, transport: null,
        scheme: null, tokenFile: null, uptimeMs: null, clients: [], exposed: [], withheld: [],
        exposedCount: 0, withheldCount: 0, calls: [], callsInfo: pageInfo(0, 10, 1),
      }
    }
    const rawCalls = Array.isArray(calls) ? calls : isObject(calls) && Array.isArray(calls.calls) ? calls.calls : []
    const rows = []
    for (const candidate of rawCalls) {
      const row = mcpCallRow(candidate)
      if (row !== null) rows.push(row)
    }
    rows.sort((left, right) => (finite(right.time) ?? 0) - (finite(left.time) ?? 0))
    const page = paginate(rows, optionsValue.page, optionsValue.pageSize)
    return {
      available: true,
      banner: null,
      ...normalized,
      calls: page.rows,
      callsInfo: page.info,
    }
  }

  // ── components ────────────────────────────────────────────────────────────

  const CSS = `
.mti-page { box-sizing: border-box; height: 100%; min-height: 100%; overflow-y: auto; overflow-x: hidden; padding: 18px 24px 44px; background: ${PALETTE.page}; color: ${PALETTE.ink}; font-size: 13px; line-height: 20px; }
.mti-page *, .mti-page *::before, .mti-page *::after { box-sizing: border-box; }
.mti-page:focus-visible, .mti-page button:focus-visible, .mti-page input:focus-visible, .mti-page select:focus-visible {
  outline: 2px solid ${PALETTE.primary}; outline-offset: 2px;
}
.mti-tabs { display: flex; gap: 2px; border-bottom: 1px solid ${PALETTE.border}; margin-bottom: 16px; }
.mti-tab { appearance: none; border: 0; background: transparent; color: ${PALETTE.muted}; font: inherit; font-size: 13px; line-height: 20px;
  padding: 8px 12px 10px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; border-radius: 6px 6px 0 0; }
.mti-tab:hover { color: ${PALETTE.ink}; background: ${PALETTE.tint}; }
.mti-tab[data-active='true'] { color: ${PALETTE.primary}; border-bottom-color: ${PALETTE.primary}; font-weight: 600; }
.mti-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
.mti-title { margin: 0; font-size: 22px; line-height: 28px; font-weight: 650; letter-spacing: -0.01em; }
.mti-sub { margin: 4px 0 0; color: ${PALETTE.muted}; font-size: 12.5px; line-height: 18px; max-width: 720px; }
.mti-range { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mti-range-label { color: ${PALETTE.muted}; font-size: 11.5px; }
.mti-seg { display: inline-flex; border: 1px solid ${PALETTE.border}; border-radius: 7px; overflow: hidden; background: #FFFFFF; }
.mti-seg button { appearance: none; border: 0; background: transparent; color: ${PALETTE.muted}; font: inherit; font-size: 12px;
  padding: 5px 10px; cursor: pointer; border-left: 1px solid ${PALETTE.border}; }
.mti-seg button:first-child { border-left: 0; }
.mti-seg button[data-active='true'] { background: ${PALETTE.tint}; color: ${PALETTE.primary}; font-weight: 600; }
.mti-banner { display: flex; align-items: flex-start; gap: 8px; border: 1px solid ${PALETTE.border}; border-left: 3px solid ${PALETTE.primary};
  background: ${PALETTE.tint}; color: ${PALETTE.ink}; border-radius: 8px; padding: 9px 12px; margin: 0 0 14px; font-size: 12.5px; }
.mti-banner[data-kind='warn'] { border-left-color: ${PALETTE.failure}; background: #FDF6EA; }
.mti-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.mti-kpi { background: #FFFFFF; border: 1px solid ${PALETTE.border}; border-radius: 10px; padding: 11px 13px; min-width: 0; }
.mti-kpi-label { color: ${PALETTE.muted}; font-size: 11px; line-height: 15px; letter-spacing: 0.03em; text-transform: uppercase; }
.mti-kpi-value { margin-top: 3px; font-size: 23px; line-height: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mti-kpi-hint { color: ${PALETTE.muted}; font-size: 11px; line-height: 15px; margin-top: 2px; }
.mti-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 12px; margin-bottom: 14px; }
.mti-card { background: #FFFFFF; border: 1px solid ${PALETTE.border}; border-radius: 10px; padding: 13px 15px; min-width: 0; margin-bottom: 14px; }
.mti-grid .mti-card { margin-bottom: 0; }
.mti-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.mti-card-title { margin: 0; font-size: 13px; line-height: 18px; font-weight: 600; }
.mti-card-note { color: ${PALETTE.muted}; font-size: 11px; }
.mti-bars { display: flex; align-items: flex-end; gap: 6px; min-height: 96px; border-bottom: 1px solid ${PALETTE.border}; padding-top: 6px; }
.mti-bar { flex: 1 1 0; min-width: 6px; display: flex; flex-direction: column; justify-content: flex-end; height: 96px; }
.mti-bar-stack { display: flex; flex-direction: column-reverse; gap: 1px; }
.mti-bar-ok { background: ${PALETTE.primary}; border-radius: 2px 2px 0 0; min-height: 1px; }
.mti-bar-err { background: ${PALETTE.failure}; border-radius: 2px 2px 0 0; min-height: 1px; }
.mti-bar-label { color: ${PALETTE.muted}; font-size: 10px; text-align: center; margin-top: 5px; white-space: nowrap; }
.mti-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.mti-table th { text-align: left; color: ${PALETTE.muted}; font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  padding: 6px 8px; border-bottom: 1px solid ${PALETTE.border}; white-space: nowrap; }
.mti-table th.mti-num { text-align: right; }
.mti-table td { padding: 7px 8px; border-bottom: 1px solid ${PALETTE.border}; font-size: 12.5px; vertical-align: top; }
.mti-table tbody tr:last-child td { border-bottom: 0; }
.mti-table tbody tr:hover td { background: ${PALETTE.surface}; }
.mti-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mti-name { font-weight: 550; color: ${PALETTE.ink}; }
.mti-tool-link { appearance: none; border: 0; background: transparent; padding: 0; font: inherit; color: ${PALETTE.primary}; cursor: pointer; text-align: left; }
.mti-tool-link:hover { text-decoration: underline; }
.mti-muted { color: ${PALETTE.muted}; }
.mti-pill { display: inline-block; border: 1px solid ${PALETTE.border}; border-radius: 999px; padding: 0 7px; font-size: 10.5px; line-height: 16px;
  color: ${PALETTE.muted}; background: #FFFFFF; white-space: nowrap; }
.mti-pill[data-ok='true'] { color: #1F7A4D; border-color: #BFDCCB; background: #F1FAF5; }
.mti-pill[data-ok='false'] { color: ${PALETTE.failure}; border-color: #EAD3B3; background: #FDF6EA; }
.mti-pill[data-state='active'] { color: ${PALETTE.primary}; border-color: #C9D2FF; background: ${PALETTE.tint}; }
.mti-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 10px; color: ${PALETTE.muted}; font-size: 11.5px; flex-wrap: wrap; }
.mti-pager button { appearance: none; border: 1px solid ${PALETTE.border}; background: #FFFFFF; color: ${PALETTE.ink}; border-radius: 6px;
  font: inherit; font-size: 11.5px; padding: 3px 9px; cursor: pointer; }
.mti-pager button:disabled { color: ${PALETTE.muted}; opacity: 0.55; cursor: default; }
.mti-pager .mti-page-count { white-space: nowrap; }
.mti-empty { border: 1px dashed ${PALETTE.border}; border-radius: 10px; padding: 26px 18px; text-align: center; color: ${PALETTE.muted};
  background: ${PALETTE.surface}; font-size: 12.5px; }
.mti-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mti-btn { appearance: none; border: 1px solid ${PALETTE.border}; background: #FFFFFF; color: ${PALETTE.ink}; border-radius: 7px;
  font: inherit; font-size: 12px; line-height: 18px; padding: 5px 11px; cursor: pointer; }
.mti-btn:hover { border-color: ${PALETTE.primary}; color: ${PALETTE.primary}; }
.mti-btn-primary { background: ${PALETTE.primary}; border-color: ${PALETTE.primary}; color: #FFFFFF; }
.mti-btn-primary:hover { color: #FFFFFF; opacity: 0.92; }
.mti-filters { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.mti-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mti-field label { color: ${PALETTE.muted}; font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; }
.mti-input, .mti-select { height: 30px; border: 1px solid ${PALETTE.border}; border-radius: 7px; background: #FFFFFF; color: ${PALETTE.ink};
  font: inherit; font-size: 12px; padding: 0 9px; min-width: 140px; }
.mti-input { min-width: 220px; }
.mti-group-title { display: flex; align-items: center; gap: 8px; margin: 14px 0 6px; color: ${PALETTE.muted};
  font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
.mti-group-title::after { content: ''; flex: 1 1 auto; height: 1px; background: ${PALETTE.border}; }
.mti-detail { border: 1px solid ${PALETTE.border}; border-left: 3px solid ${PALETTE.primary}; background: ${PALETTE.surface};
  border-radius: 8px; padding: 11px 13px; margin: 10px 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 16px; }
.mti-detail dt { color: ${PALETTE.muted}; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
.mti-detail dd { margin: 1px 0 0; font-size: 12.5px; word-break: break-word; }
.mti-mono { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11.5px; }
.mti-subcall td { background: ${PALETTE.surface}; }
.mti-indent { padding-left: 22px; }
.mti-expand { appearance: none; border: 0; background: transparent; color: ${PALETTE.muted}; cursor: pointer; font: inherit; font-size: 11px;
  width: 16px; padding: 0; text-align: left; }
.mti-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.mti-kv { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 5px 12px; margin: 0; }
.mti-kv dt { color: ${PALETTE.muted}; font-size: 11.5px; }
.mti-kv dd { margin: 0; font-size: 12.5px; word-break: break-word; }
@media (max-width: 980px) { .mti-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .mti-grid, .mti-split { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .mti-page { padding: 12px 12px 36px; }
  .mti-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mti-title { font-size: 19px; }
  .mti-col-optional { display: none; }
  .mti-detail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.mti-create-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr); gap: 20px; align-items: start; }
.mti-create-heading { margin: 18px 0 10px; font-size: 13px; font-weight: 650; letter-spacing: 0.01em; }
.mti-create-heading:first-child { margin-top: 0; }
.mti-create-row { display: flex; gap: 10px; align-items: flex-end; }
.mti-create-checks { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0 4px; color: ${PALETTE.ink}; font-size: 12.5px; }
.mti-create-checks label { display: flex; align-items: center; gap: 6px; }
.mti-create-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.mti-create-list { border: 1px solid ${PALETTE.border}; border-radius: 9px; overflow: hidden; }
.mti-create-list-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 12px; border-bottom: 1px solid ${PALETTE.border}; }
.mti-create-list-row:last-child { border-bottom: 0; }
.mti-create-list-title { font-size: 12.5px; font-weight: 600; color: ${PALETTE.ink}; }
.mti-create-list-actions { display: flex; gap: 6px; flex-shrink: 0; }
.mti-create-side { border-left: 1px solid ${PALETTE.border}; padding-left: 20px; }
.mti-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; min-width: 0; }
.mti-field-wide { width: 100%; }
.mti-field-grow { flex: 1 1 auto; }
.mti-field label { color: ${PALETTE.muted}; font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
.mti-input, .mti-select, .mti-textarea { box-sizing: border-box; width: 100%; border: 1px solid ${PALETTE.border}; border-radius: 7px;
  background: #FFFFFF; color: ${PALETTE.ink}; font: inherit; font-size: 12.5px; padding: 6px 9px; }
.mti-textarea { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11.5px; line-height: 1.45; resize: vertical; }
.mti-input:focus-visible, .mti-select:focus-visible, .mti-textarea:focus-visible { outline: 2px solid ${PALETTE.primary}; outline-offset: 1px; }
.mti-button { appearance: none; border: 1px solid ${PALETTE.border}; background: #FFFFFF; color: ${PALETTE.ink}; border-radius: 7px;
  font: inherit; font-size: 12px; padding: 5px 11px; cursor: pointer; }
.mti-button:hover:not(:disabled) { border-color: ${PALETTE.primary}; color: ${PALETTE.primary}; }
.mti-button:disabled { opacity: 0.55; cursor: default; }
.mti-button-primary { background: ${PALETTE.primary}; border-color: ${PALETTE.primary}; color: #FFFFFF; }
.mti-button-small { font-size: 11px; padding: 3px 8px; }
.mti-help { margin: 0 0 10px; color: ${PALETTE.muted}; font-size: 11.5px; line-height: 16px; }
.mti-note { margin: 10px 0; border-radius: 7px; padding: 8px 10px; font-size: 12px; line-height: 17px; }
.mti-note-ok { background: #F1FAF5; border: 1px solid #BFDCCB; color: #1F7A4D; }
.mti-note-error { background: #FDF6EA; border: 1px solid #EAD3B3; color: ${PALETTE.failure}; }
.mti-issues { margin: 8px 0; padding-left: 18px; color: ${PALETTE.failure}; font-size: 11.5px; line-height: 17px; }
.mti-pre { max-height: 220px; overflow: auto; margin: 10px 0; padding: 9px 10px; border: 1px solid ${PALETTE.border}; border-radius: 7px;
  background: ${PALETTE.surface}; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11px; line-height: 1.45; }
@media (max-width: 980px) { .mti-create-grid { grid-template-columns: minmax(0, 1fr); } .mti-create-side { border-left: 0; padding-left: 0; } }
@media (max-width: 720px) { .mti-create-row { flex-direction: column; align-items: stretch; } }
@media (prefers-reduced-motion: reduce) { .mti-page * { transition: none !important; } }
`

  /** A section card with a title row. */
  function Card(title, note, children) {
    return h('section', { className: 'mti-card' },
      h('div', { className: 'mti-card-head' },
        h('h3', { className: 'mti-card-title' }, title),
        note === null || note === undefined ? null : h('span', { className: 'mti-card-note' }, note)),
      children)
  }

  /** One KPI tile. */
  function Kpi(label, value, hint) {
    return h('div', { className: 'mti-kpi', key: label },
      h('div', { className: 'mti-kpi-label' }, label),
      h('div', { className: 'mti-kpi-value' }, value),
      hint === null || hint === undefined ? null : h('div', { className: 'mti-kpi-hint' }, hint))
  }

  /** A pager with a showing range and previous/next controls. */
  function Pager(info, onPage, label) {
    const name = typeof label === 'string' ? label : 'rows'
    return h('div', { className: 'mti-pager', role: 'navigation', 'aria-label': 'Pagination' },
      h('span', { className: 'mti-page-count' }, 'Showing ' + String(info.from) + '-' + String(info.to) + ' of ' + String(info.total) + ' ' + name),
      h('span', { className: 'mti-page-count' }, 'Page ' + String(info.page) + ' of ' + String(info.pages)),
      h('button', {
        type: 'button',
        disabled: info.page <= 1,
        onClick: () => onPage(info.page - 1),
        'aria-label': 'Previous page',
      }, 'Previous'),
      h('button', {
        type: 'button',
        disabled: info.page >= info.pages,
        onClick: () => onPage(info.page + 1),
        'aria-label': 'Next page',
      }, 'Next'))
  }

  /** The segmented range control. */
  function RangeControl(range, onSelectRange) {
    return h('div', { className: 'mti-range' },
      h('span', { className: 'mti-range-label', id: 'mti-range-label' }, 'Range'),
      h('div', { className: 'mti-seg', role: 'group', 'aria-labelledby': 'mti-range-label' },
        RANGES.map(id => h('button', {
          type: 'button',
          key: id,
          'data-active': id === range ? 'true' : 'false',
          'aria-pressed': id === range,
          onClick: () => onSelectRange(id),
        }, id === 'all' ? 'All' : id))))
  }

  /** The three-tab strip. */
  function TabBar(props) {
    const tab = readTabFromHash('#' + String(props.tab))
    return h('div', { className: 'mti-tabs', role: 'tablist', 'aria-label': 'Tool insights sections' },
      TABS.map(entry => h('button', {
        key: entry.id,
        type: 'button',
        role: 'tab',
        className: 'mti-tab',
        id: 'mti-tab-' + entry.id,
        'data-tab': entry.id,
        'data-active': entry.id === tab ? 'true' : 'false',
        'aria-selected': entry.id === tab,
        'aria-controls': 'mti-panel-' + entry.id,
        tabIndex: 0,
        onClick: () => props.onSelect(entry.id),
      }, entry.label)))
  }

  /** An explicit empty state. */
  function EmptyState(message) {
    return h('div', { className: 'mti-empty' }, message)
  }

  /** A degraded-mode banner. */
  function Banner(message, kind) {
    if (typeof message !== 'string' || message.length === 0) return null
    return h('div', { className: 'mti-banner', role: 'status', 'data-kind': kind === 'warn' ? 'warn' : 'info' }, message)
  }

  /** A status pill. */
  function Pill(label, props) {
    const extra = isObject(props) ? props : {}
    return h('span', { className: 'mti-pill', ...extra }, label)
  }

  /** Calls-per-day bars (success + errors). */
  function CallsPerDay(days) {
    const rows = Array.isArray(days) ? days.filter(day => isObject(day) && typeof day.day === 'string') : []
    if (rows.length === 0) return EmptyState('No calls recorded in this range.')
    const peak = Math.max(1, ...rows.map(day => count(day.calls)))
    return h('div', { className: 'mti-bars', role: 'img', 'aria-label': 'Calls per day, success versus errors' },
      rows.slice(-30).map(day => {
        const calls = count(day.calls)
        const errors = Math.min(count(day.errors), calls)
        const height = Math.max(2, Math.round((calls / peak) * 80))
        const errorHeight = calls === 0 ? 0 : Math.round((errors / calls) * height)
        return h('div', { className: 'mti-bar', key: day.day, title: day.day + ': ' + String(calls) + ' calls, ' + String(errors) + ' errors' },
          h('div', { className: 'mti-bar-stack', style: { height: String(height) + 'px' } },
            h('div', { className: 'mti-bar-ok', style: { height: String(Math.max(0, height - errorHeight)) + 'px' } }),
            errorHeight > 0 ? h('div', { className: 'mti-bar-err', style: { height: String(errorHeight) + 'px' } }) : null),
          h('div', { className: 'mti-bar-label' }, day.day.slice(5)))
      }))
  }

  /** The model leaderboard. */
  function ModelLeaderboard(models) {
    const rows = Array.isArray(models) ? models : []
    if (rows.length === 0) return EmptyState('No model attribution recorded in this range.')
    return h('table', { className: 'mti-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Model'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Calls'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Tools'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Success'),
        h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'p50'))),
      h('tbody', null, rows.slice(0, 8).map(row => h('tr', { key: row.model },
        h('td', null, h('span', { className: 'mti-name' }, row.model)),
        h('td', { className: 'mti-num' }, formatNumber(row.calls)),
        h('td', { className: 'mti-num' }, formatNumber(row.tools)),
        h('td', { className: 'mti-num' }, formatPercent(successRate(row.calls, row.errors))),
        h('td', { className: 'mti-num mti-col-optional' }, formatDuration(row.p50))))))
  }

  /** The per-tool performance table with pagination. */
  function ToolPerformanceTable(props) {
    const rows = Array.isArray(props.rows) ? props.rows : []
    const page = paginate(rows, props.page, props.pageSize)
    if (rows.length === 0) return EmptyState('No tool performance recorded in this range.')
    return h('div', null,
      h('table', { className: 'mti-table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Tool'),
          h('th', { scope: 'col', className: 'mti-col-optional' }, 'Owner'),
          h('th', { scope: 'col', className: 'mti-num' }, 'Calls'),
          h('th', { scope: 'col', className: 'mti-num' }, 'Success'),
          h('th', { scope: 'col', className: 'mti-num' }, 'p50'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'p95'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Max'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Total'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Code'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Last used'))),
        h('tbody', null, page.rows.map(row => h('tr', { key: row.name },
          h('td', null, h('button', {
            type: 'button', className: 'mti-tool-link', onClick: () => props.onSelectTool(row.name),
            title: 'Show this tool in the inventory',
          }, row.name)),
          h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, row.owner ?? '—')),
          h('td', { className: 'mti-num' }, formatNumber(row.calls)),
          h('td', { className: 'mti-num' }, formatPercent(toolSuccessRate(row))),
          h('td', { className: 'mti-num' }, formatDuration(row.p50)),
          h('td', { className: 'mti-num mti-col-optional' }, formatDuration(row.p95)),
          h('td', { className: 'mti-num mti-col-optional' }, formatDuration(row.maxMs)),
          h('td', { className: 'mti-num mti-col-optional' }, formatDuration(row.totalMs)),
          h('td', { className: 'mti-num mti-col-optional' }, row.codeCalls === null ? '—' : formatNumber(row.codeCalls)),
          h('td', { className: 'mti-num mti-col-optional' }, formatAgo(row.lastUsed, props.now)))))),
      Pager(page.info, props.onPage, 'tools'))
  }

  /** The All calls table with expandable Code Mode parents. */
  function AllCallsTable(props) {
    const rows = groupCallRows(props.calls)
    const page = paginate(rows, props.page, props.pageSize)
    if (rows.length === 0) return EmptyState('No tool calls in this range.')
    const expanded = isObject(props.expanded) ? props.expanded : {}
    return h('div', null,
      h('table', { className: 'mti-table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, ''),
          h('th', { scope: 'col' }, 'Time'),
          h('th', { scope: 'col' }, 'Tool'),
          h('th', { scope: 'col', className: 'mti-col-optional' }, 'Owner'),
          h('th', { scope: 'col', className: 'mti-col-optional' }, 'Session'),
          h('th', { scope: 'col', className: 'mti-num' }, 'ms'),
          h('th', { scope: 'col' }, 'Status'))),
        h('tbody', null, page.rows.flatMap(row => {
          const open = expanded[row.callId ?? row.name + String(row.time)] === true
          const expandable = row.children.length > 0
          const key = row.callId ?? row.name + String(row.time)
          const self = h('tr', { key },
            h('td', null, expandable
              ? h('button', {
                type: 'button', className: 'mti-expand', 'aria-expanded': open,
                onClick: () => props.onToggleCall(key),
                title: open ? 'Hide Code Mode sub-calls' : 'Show Code Mode sub-calls',
              }, open ? '▾' : '▸')
              : null),
            h('td', null, h('span', { className: 'mti-muted' }, formatAgo(row.time, props.now))),
            h('td', null, h('span', { className: 'mti-name' }, row.name), row.kind === 'code' ? ' ' : null,
              row.kind === 'code' && row.parentCallId === undefined ? Pill('CODE MODE') : null),
            h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, row.owner ?? '—')),
            h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted' }, row.sessionId ?? '—')),
            h('td', { className: 'mti-num' }, formatDuration(row.ms)),
            h('td', null, Pill(row.ok ? 'ok' : (row.errorCode ?? 'error'), { 'data-ok': row.ok ? 'true' : 'false' })))
          if (!expandable || !open) return [self]
          const children = row.children.map(child => h('tr', { key: child.callId ?? child.name, className: 'mti-subcall' },
            h('td', null),
            h('td', null, h('span', { className: 'mti-muted' }, formatAgo(child.time, props.now))),
            h('td', null, h('span', { className: 'mti-indent mti-name' }, child.name), ' ', Pill('sub-call')),
            h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, child.owner ?? '—')),
            h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted' }, child.sessionId ?? '—')),
            h('td', { className: 'mti-num' }, formatDuration(child.ms)),
            h('td', null, Pill(child.ok ? 'ok' : (child.errorCode ?? 'error'), { 'data-ok': child.ok ? 'true' : 'false' }))))
          return [self, ...children]
        }))),
      Pager(page.info, props.onPage, 'calls'))
  }

  /** The workbench (Tool Insights tab). */
  function InsightsView(props) {
    const model = isObject(props.model) ? props.model : deriveInsights({})
    const kpis = isObject(model.kpis) ? model.kpis : {}
    const hasCalls = count(kpis.calls) > 0
    return h('div', { role: 'tabpanel', id: 'mti-panel-insights', 'aria-labelledby': 'mti-tab-insights' },
      h('div', { className: 'mti-head' },
        h('div', null,
          h('h2', { className: 'mti-title' }, 'Tool Insights'),
          h('p', { className: 'mti-sub' },
            'What the agent actually did with tools: volume, health, latency, Code Mode nesting and model attribution. '
            + 'Figures are host-reported; nothing on this page is estimated.')),
        RangeControl(props.range, props.onSelectRange)),
      Banner(model.banner, 'warn'),
      h('div', { className: 'mti-kpis' },
        Kpi('Calls', formatNumber(kpis.calls), model.range === 'all' ? 'all time' : 'in ' + String(model.range)),
        Kpi('Tools used', formatNumber(kpis.toolsUsed) + (finite(kpis.toolsAvailable) === null ? '' : ' / ' + formatNumber(kpis.toolsAvailable)),
          'distinct tools with activity'),
        Kpi('Success', formatPercent(kpis.successRate), formatNumber(kpis.errors) + ' failed calls'),
        Kpi('Tool time', formatDuration(kpis.toolMs), 'sum of settled calls'),
        Kpi('Sessions', formatNumber(kpis.sessions), 'sessions carrying usage'),
        Kpi('Calls / session', finite(kpis.callsPerSession) === null ? '—' : (kpis.callsPerSession).toFixed(1), 'mean across sessions'),
        Kpi('p50 latency', formatDuration(kpis.p50), finite(kpis.p95) === null ? '' : 'p95 ' + formatDuration(kpis.p95)),
        Kpi('Code Mode', formatPercent(kpis.codeModeShare), 'share of sub-calls')),
      h('div', { className: 'mti-grid' },
        Card('Calls per day', 'success versus errors, host-local days',
          CallsPerDay(model.days)),
        Card('Model leaderboard', 'who used tools most',
          ModelLeaderboard(model.models))),
      Card('Tool performance', 'settled calls; percentiles from the host histogram',
        ToolPerformanceTable({
          rows: model.tools, page: props.toolPage, pageSize: props.toolPageSize, now: props.now,
          onPage: props.onToolPage, onSelectTool: props.onSelectTool,
        })),
      Card('All calls', 'newest first; Code Mode parents expand into their sub-calls',
        h('div', null,
          h('div', { className: 'mti-actions', style: { marginBottom: '8px' } },
            h('button', { type: 'button', className: 'mti-btn', onClick: () => props.onOpenInventory() }, 'Inventory →')),
          hasCalls
            ? AllCallsTable({
              calls: model.calls, page: props.callPage, pageSize: props.callPageSize, now: props.now,
              expanded: props.expanded, onToggleCall: props.onToggleCall, onPage: props.onCallPage,
            })
            : EmptyState('No tool calls in this range.'))))
  }

  /** One inventory row's inline detail. */
  function ToolDetail(row, onClose) {
    return h('dl', { className: 'mti-detail' },
      h('div', null, h('dt', null, 'Owner'), h('dd', { className: 'mti-mono' }, row.owner ?? '—')),
      h('div', null, h('dt', null, 'Kind'), h('dd', null, row.kind)),
      h('div', null, h('dt', null, 'State'), h('dd', null, Pill(row.state, { 'data-state': row.state }))),
      h('div', null, h('dt', null, 'Calls'), h('dd', null, row.calls === null ? 'never called' : formatNumber(row.calls))),
      h('div', null, h('dt', null, 'Success'), h('dd', null, formatPercent(inventorySuccessRate(row)))),
      h('div', null, h('dt', null, 'Last used'), h('dd', null, formatAgo(row.lastUsed))),
      h('div', null, h('dt', null, 'Extension'), h('dd', { className: 'mti-mono' }, row.extension ?? '—')),
      h('div', null, h('dt', null, 'Version'), h('dd', null, row.extensionVersion ?? row.contractVersion ?? '—')),
      h('div', null, h('dt', null, 'Arguments'), h('dd', null, row.argumentCount === null ? '—' : String(row.argumentCount))),
      h('div', null, h('dt', null, 'MCP'), h('dd', null, row.mcpExposed === false ? 'withheld from MCP' : row.mcpExposed === true ? 'exposed' : '—')),
      h('div', { style: { gridColumn: '1 / -1' } },
        typeof row.description === 'string' && row.description.length > 0
          ? h('dd', { className: 'mti-muted' }, row.description) : h('dd', { className: 'mti-muted' }, 'No description reported.' )),
      h('div', { style: { gridColumn: '1 / -1' } },
        h('button', { type: 'button', className: 'mti-btn', onClick: onClose }, 'Close detail')))
  }

  /** The Tool Inventory tab. */
  function InventoryView(props) {
    const model = isObject(props.model) ? props.model : filterAndGroupInventory([], {})
    const filters = isObject(props.filters) ? props.filters : {}
    const rows = Array.isArray(model.filtered) ? model.filtered : []
    return h('div', { role: 'tabpanel', id: 'mti-panel-inventory', 'aria-labelledby': 'mti-tab-inventory' },
      h('div', { className: 'mti-head' },
        h('div', null,
          h('h2', { className: 'mti-title' }, 'Tool Inventory'),
          h('p', { className: 'mti-sub' },
            'Every registered tool, grouped by origin. State and provenance come from the host; usage columns join the '
            + 'same report as the workbench. A tool with no calls is kept and labelled.')),
        h('div', { className: 'mti-actions' },
          h('button', { type: 'button', className: 'mti-btn', onClick: () => props.onBack() }, 'Back to workbench'))),
      model.available === false ? Banner(model.banner, 'warn') : null,
      h('div', { className: 'mti-filters' },
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-inv-search' }, 'Search'),
          h('input', {
            id: 'mti-inv-search', className: 'mti-input', type: 'search', value: filters.query ?? '',
            placeholder: 'Tool, owner or description',
            onChange: event => props.onFilter({ query: event.target.value }),
          })),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-inv-origin' }, 'Origin'),
          h('select', {
            id: 'mti-inv-origin', className: 'mti-select', value: filters.origin ?? 'all',
            onChange: event => props.onFilter({ origin: event.target.value }),
          }, h('option', { value: 'all' }, 'All origins'), h('option', { value: 'core' }, 'DSH core'),
          h('option', { value: 'tool-mode' }, 'Tool Mode'), h('option', { value: 'custom' }, 'Custom tools'), h('option', { value: 'other' }, 'Other plugins'))),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-inv-state' }, 'State'),
          h('select', {
            id: 'mti-inv-state', className: 'mti-select', value: filters.state ?? 'all',
            onChange: event => props.onFilter({ state: event.target.value }),
          }, h('option', { value: 'all' }, 'All states'), h('option', { value: 'active' }, 'active'),
          h('option', { value: 'prepared-cold' }, 'prepared-cold'), h('option', { value: 'failed' }, 'failed'))),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-inv-size' }, 'Per page'),
          h('select', {
            id: 'mti-inv-size', className: 'mti-select', value: String(props.pageSize ?? 25),
            onChange: event => props.onPageSize(Number(event.target.value)),
          }, TOOL_PAGE_SIZES.map(size => h('option', { key: size, value: String(size) }, String(size)))))),
      rows.length === 0
        ? EmptyState('No tools match these filters.')
        : h('div', null,
          model.groups.map(group => h('div', { key: group.origin },
            h('div', { className: 'mti-group-title' }, group.label + ' · ' + String(group.rows.length)),
            h('table', { className: 'mti-table' },
              h('thead', null, h('tr', null,
                h('th', { scope: 'col' }, 'Tool'),
                h('th', { scope: 'col', className: 'mti-col-optional' }, 'Owner'),
                h('th', { scope: 'col' }, 'Kind'),
                h('th', { scope: 'col' }, 'State'),
                h('th', { scope: 'col', className: 'mti-num' }, 'Calls'),
                h('th', { scope: 'col', className: 'mti-num' }, 'Success'),
                h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Last used'),
                h('th', { scope: 'col' }, 'MCP'))),
              h('tbody', null, group.rows.map(row => h('tr', { key: row.name },
                h('td', null, h('button', {
                  type: 'button', className: 'mti-tool-link', onClick: () => props.onSelect(row.name),
                }, row.name)),
                h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, row.owner ?? '—')),
                h('td', null, row.kind),
                h('td', null, Pill(row.state, { 'data-state': row.state })),
                h('td', { className: 'mti-num' }, row.calls === null ? h('span', { className: 'mti-muted' }, 'never called') : formatNumber(row.calls)),
                h('td', { className: 'mti-num' }, formatPercent(inventorySuccessRate(row))),
                h('td', { className: 'mti-num mti-col-optional' }, formatAgo(row.lastUsed)),
                h('td', null, row.mcpExposed === false
                  ? Pill('withheld from MCP', { 'data-ok': 'false' })
                  : row.mcpExposed === true ? Pill('exposed', { 'data-ok': 'true' }) : h('span', { className: 'mti-muted' }, '—')))))))),
          Pager(model.info, props.onPage, 'tools')),
      props.selected === null || props.selected === undefined
        ? null
        : (() => {
          const row = rows.find(candidate => candidate.name === props.selected)
          return row === undefined ? null : h('div', null, ToolDetail(row, () => props.onSelect(null)))
        })())
  }

  /** Dedicated Model as Tool configuration tab. */
  function SettingsView(props) {
    return h('div', { role: 'tabpanel', id: 'mti-panel-settings', 'aria-labelledby': 'mti-tab-settings' },
      typeof props.settings === 'function'
        ? props.settings()
        : h('p', { className: 'mti-sub' }, 'Model as Tool configuration is not available on this host.'))
  }

  /** The MCP tab. */
  function McpView(props) {
    const model = isObject(props.model) ? props.model : mcpView(null, null, {})
    const clients = Array.isArray(model.clients) ? model.clients : []
    const withheld = Array.isArray(model.withheld) ? model.withheld : []
    const exposed = Array.isArray(model.exposed) ? model.exposed : []
    const header = h('div', { className: 'mti-head' },
      h('div', null,
        h('h2', { className: 'mti-title' }, 'MCP'),
        h('p', { className: 'mti-sub' },
          'The external MCP surface: the configured endpoint, the clients that actually hold a grant, which tools are '
          + 'exposed, and the persisted external call log. Tokens, arguments and results are never shown.')),
      h('div', { className: 'mti-actions' },
        h('button', { type: 'button', className: 'mti-btn', onClick: () => props.onBack() }, 'Back to workbench')))
    const endpointCard = Card('Endpoint', model.enabled ? null : 'disabled',
      model.enabled === false
        ? EmptyState('MCP endpoint is disabled on this host.')
        : h('dl', { className: 'mti-kv' },
          h('dt', null, 'Endpoint'), h('dd', { className: 'mti-mono' }, model.endpoint ?? '—'),
          h('dt', null, 'Transport'), h('dd', null, model.transport ?? '—'),
          h('dt', null, 'Auth'), h('dd', null, model.scheme ?? '—'),
          h('dt', null, 'Token file'), h('dd', { className: 'mti-mono' }, model.tokenFile ?? 'configured outside this page'),
          h('dt', null, 'Uptime'), h('dd', null, formatDuration(model.uptimeMs))))
    const exposureCard = Card('Exposure', 'model_tools is host-local and withheld by design',
      h('dl', { className: 'mti-kv' },
        h('dt', null, 'Exposed'),
        h('dd', null, 'Exposed ' + String(model.exposedCount) + ' of ' + String(model.exposedCount + model.withheldCount) + ' tools'),
        h('dt', null, 'Withheld'),
        h('dd', null, withheld.length === 0
          ? h('span', { className: 'mti-muted' }, 'None reported')
          : withheld.map(name => Pill(name, { 'data-ok': 'false', key: name }))),
        h('dt', null, 'Tools'),
        h('dd', { className: 'mti-muted mti-mono' }, exposed.length === 0 ? '—' : exposed.slice(0, 12).join(', '))))
    const clientsTable = h('table', { className: 'mti-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Client'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Calls'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Success'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Last seen'))),
      h('tbody', null, clients.map(client => h('tr', { key: client.id },
        h('td', null, h('span', { className: 'mti-name mti-mono' }, client.id)),
        h('td', { className: 'mti-num' }, formatNumber(client.calls)),
        h('td', { className: 'mti-num' }, formatPercent(successRate(client.calls, client.errors))),
        h('td', { className: 'mti-num' }, formatAgo(client.lastSeen))))))
    const clientsCard = Card('Clients', 'identities come from grants, never invented',
      clients.length === 0 ? EmptyState('No MCP client has called this host yet.') : clientsTable)
    const callsTable = h('table', { className: 'mti-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Time'),
        h('th', { scope: 'col' }, 'Tool'),
        h('th', { scope: 'col' }, 'Client'),
        h('th', { scope: 'col', className: 'mti-num' }, 'ms'),
        h('th', { scope: 'col' }, 'Status'),
        h('th', { scope: 'col', className: 'mti-col-optional' }, 'Receipt'))),
      h('tbody', null, model.calls.map((call, index) => h('tr', { key: (call.receiptId ?? call.tool) + String(index) },
        h('td', null, h('span', { className: 'mti-muted' }, formatAgo(call.time, props.now))),
        h('td', null, h('span', { className: 'mti-name' }, call.tool)),
        h('td', null, h('span', { className: 'mti-muted mti-mono' }, call.clientId)),
        h('td', { className: 'mti-num' }, formatDuration(call.totalMs)),
        h('td', null, call.failureClass === undefined
          ? Pill('ok', { 'data-ok': 'true' })
          : Pill(call.failureClass, { 'data-ok': 'false' })),
        h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, call.receiptId ?? '—'))))))
    const logCard = Card('External call log', 'persisted ledger; no payloads',
      h('div', null,
        (Array.isArray(model.calls) ? model.calls : []).length === 0
          ? EmptyState('No external MCP calls recorded yet.')
          : callsTable,
        Pager(model.callsInfo, props.onPage, 'calls')))
    return h('div', { role: 'tabpanel', id: 'mti-panel-mcp', 'aria-labelledby': 'mti-tab-mcp' },
      header,
      model.available === false ? Banner(model.banner, 'warn') : null,
      h('div', { className: 'mti-split' }, endpointCard, exposureCard),
      clientsCard,
      logCard)
  }

  /** The sidebar icon for the Tool Insights entry. */
  function ToolInsightsIcon() {
    return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('path', { d: 'M2 13V7M6 13V3M10 13V9M14 13V5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      h('path', { d: 'M2 13h12', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.55 }))
  }

  /** Read one injected Remote answer into a page state. */
  function remoteState(result) {
    if (result === null || result === undefined) return { status: 'unavailable', value: null }
    if (isObject(result) && typeof result.ok === 'boolean') {
      return result.ok === true
        ? { status: 'ready', value: result.value }
        : { status: 'error', value: null, text: typeof result.error === 'object' && result.error !== null && typeof result.error.message === 'string' ? result.error.message : 'The host refused the request.' }
    }
    return { status: 'ready', value: result }
  }

  /**
   * Page-lifetime caches. Opening the page again reconstructs the component,
   * so component state alone would refetch every tab; these survive the
   * remount and make Inventory/MCP instant until their TTL expires.
   */
  const REPORT_TTL_MS = 30_000
  const INVENTORY_TTL_MS = 5 * 60_000
  const MCP_TTL_MS = 30_000
  const reportCache = new Map()
  const inventoryCache = { value: null, at: 0 }
  const mcpCache = { value: null, calls: null, at: 0 }

  /**
   * The page. Root props come from the host (`useSessions`, `useWorkspaces`);
   * the injected `call`, `openSession` and `now` come from the registration.
   */
  function ToolInsightsPage(props) {
    const options = isObject(props) ? props : {}
    const sessionState = typeof options.useSessions === 'function' ? options.useSessions(state => state) : null
    const rows = isObject(sessionState) && Array.isArray(sessionState.ids)
      ? sessionState.ids.map(id => (isObject(sessionState.byId) ? sessionState.byId[id] : undefined)).filter(row => isObject(row))
      : []

    const initialHash = typeof location !== 'undefined' && location !== null ? location.hash : ''
    const [tab, setTab] = React.useState(() => readTabFromHash(initialHash))
    const [range, setRange] = React.useState('7d')
    const cachedReport = reportCache.get('7d')
    const [report, setReport] = React.useState(() => cachedReport === undefined
      ? { status: 'loading', value: null }
      : { status: 'ready', value: cachedReport.value })
    const [inventory, setInventory] = React.useState(() => inventoryCache.at === 0
      ? { status: 'loading', value: null }
      : { status: 'ready', value: inventoryCache.value })
    const [mcp, setMcp] = React.useState(() => mcpCache.at === 0
      ? { status: 'loading', value: null, calls: null }
      : { status: 'ready', value: mcpCache.value, calls: mcpCache.calls })
    const [toolPage, setToolPage] = React.useState(1)
    const [toolPageSize, setToolPageSize] = React.useState(7)
    const [callPage, setCallPage] = React.useState(1)
    const [callPageSize, setCallPageSize] = React.useState(10)
    const [inventoryPage, setInventoryPage] = React.useState(1)
    const [inventoryPageSize, setInventoryPageSize] = React.useState(25)
    const [inventoryFilters, setInventoryFilters] = React.useState({ query: '', origin: 'all', state: 'all' })
    const [mcpPage, setMcpPage] = React.useState(1)
    const [expanded, setExpanded] = React.useState({})
    const [selectedTool, setSelectedTool] = React.useState(null)
    const reportRequest = React.useRef(0)

    const call = typeof options.call === 'function' ? options.call : null
    const now = typeof options.now === 'function' ? options.now() : Date.now()

    /**
     * Load the report for one range DIRECTLY from the range control as well as
     * from the mount effect. The gateway is not the only place this can fail:
     * an effect that updates its dependency array without executing leaves the
     * previous range's report on screen under the new label. A request counter
     * makes a slow answer for the old range unable to overwrite the new one.
     */
    const loadReport = nextRange => {
      const request = ++reportRequest.current
      if (call === null) {
        setReport({ status: 'unavailable', value: null })
        return
      }
      setReport({ status: 'loading', value: null })
      Promise.resolve(requestUsageReport(call, nextRange, now)).then(result => {
        if (request !== reportRequest.current) return
        const state = remoteState(result)
        if (state.status === 'ready') reportCache.set(nextRange, { value: state.value, at: Date.now() })
        setReport(state)
      }, error => {
        if (request === reportRequest.current) {
          setReport({ status: 'error', value: null, text: String((error && error.message) || error) })
        }
      })
    }

    const selectTab = next => {
      const id = readTabFromHash('#' + String(next))
      setTab(id)
      try {
        if (typeof location !== 'undefined' && location !== null && typeof history !== 'undefined' && history !== null
          && typeof history.replaceState === 'function') history.replaceState(null, '', tabHash(id))
      } catch (error) {
        // A host without history keeps the local tab state; the hash is a convenience.
      }
    }

    React.useEffect(() => {
      const onHash = () => setTab(readTabFromHash(typeof location !== 'undefined' && location !== null ? location.hash : ''))
      if (typeof window !== 'undefined' && window !== null && typeof window.addEventListener === 'function') {
        window.addEventListener('hashchange', onHash)
        return () => window.removeEventListener('hashchange', onHash)
      }
      return undefined
    }, [])

    React.useEffect(() => {
      if (call === null) {
        setReport({ status: 'unavailable', value: null })
        return
      }
      const cached = reportCache.get(range)
      if (cached !== undefined && Date.now() - cached.at < REPORT_TTL_MS) {
        setReport({ status: 'ready', value: cached.value })
        return
      }
      loadReport(range)
    }, [call, range])

    React.useEffect(() => {
      if (tab !== 'inventory') return
      if (call === null) {
        setInventory({ status: 'unavailable', value: null })
        return
      }
      if (inventoryCache.at !== 0 && Date.now() - inventoryCache.at < INVENTORY_TTL_MS) {
        setInventory({ status: 'ready', value: inventoryCache.value })
        return
      }
      let alive = true
      setInventory({ status: 'loading', value: null })
      Promise.resolve(call('toolInventory')).then(result => {
        const state = remoteState(result)
        if (!alive) return
        if (state.status === 'ready') {
          inventoryCache.value = state.value
          inventoryCache.at = Date.now()
        }
        setInventory(state)
      }, error => {
        if (alive) setInventory({ status: 'error', value: null, text: String((error && error.message) || error) })
      })
      return () => { alive = false }
    }, [call, tab])

    React.useEffect(() => {
      if (tab !== 'mcp') return
      if (call === null) {
        setMcp({ status: 'unavailable', value: null, calls: null })
        return
      }
      if (mcpCache.at !== 0 && Date.now() - mcpCache.at < MCP_TTL_MS) {
        setMcp({ status: 'ready', value: mcpCache.value, calls: mcpCache.calls })
        return
      }
      let alive = true
      setMcp({ status: 'loading', value: null, calls: null })
      Promise.resolve(call('mcpStatus')).then(result => {
        const state = remoteState(result)
        if (!alive) return
        if (state.status !== 'ready') {
          setMcp(state.status === 'unavailable'
            ? { status: 'unavailable', value: null, calls: null }
            : { status: 'error', value: null, calls: null, text: state.text })
          return
        }
        setMcp({ status: 'ready', value: state.value, calls: null })
        Promise.resolve(requestMcpCalls(call, 1, 50)).then(calls => {
          if (!alive) return
          const callState = remoteState(calls)
          mcpCache.value = state.value
          mcpCache.calls = callState.value
          mcpCache.at = Date.now()
          setMcp({ status: 'ready', value: state.value, calls: callState.value })
        }, () => {
          if (!alive) return
          mcpCache.value = state.value
          mcpCache.calls = null
          mcpCache.at = Date.now()
          setMcp({ status: 'ready', value: state.value, calls: null })
        })
      }, error => {
        if (alive) setMcp({ status: 'error', value: null, calls: null, text: String((error && error.message) || error) })
      })
      return () => { alive = false }
    }, [call, tab])

    const projection = aggregateProjections(rows)
    const inventoryValue = inventory.status === 'ready' && isObject(inventory.value) ? inventory.value : null
    const inventoryTools = inventoryValue !== null && Array.isArray(inventoryValue.tools) ? inventoryValue.tools : []
    const toolsAvailable = inventoryTools.length > 0 ? inventoryTools.length : null
    const model = deriveInsights({
      projection,
      report: report.status === 'ready' ? report.value : null,
      range,
      now,
      toolsAvailable,
    })
    const inventoryModel = filterAndGroupInventory(inventoryTools, {
      ...inventoryFilters,
      page: inventoryPage,
      pageSize: inventoryPageSize,
    })
    const mcpModel = mcpView(mcp.value, mcp.calls, { page: mcpPage, pageSize: 10 })

    let body
    if (tab === 'inventory') {
      body = InventoryView({
        model: inventory.status === 'ready' ? inventoryModel : {
          available: false,
          banner: inventory.status === 'loading'
            ? 'Reading the tool inventory from the host…'
            : inventory.status === 'error'
              ? (inventory.text || 'The host refused the tool inventory request.')
              : 'The tool inventory is not available on this host build (the toolInventory remote method is absent).',
          groups: [], filtered: [], total: 0, info: pageInfo(0, inventoryPageSize, 1),
        },
        filters: inventoryFilters,
        page: inventoryPage,
        pageSize: inventoryPageSize,
        selected: selectedTool,
        onFilter: patch => {
          setInventoryFilters(previous => ({ ...previous, ...patch }))
          setInventoryPage(1)
        },
        onPage: page => setInventoryPage(page),
        onPageSize: size => { setInventoryPageSize(size); setInventoryPage(1) },
        onSelect: name => setSelectedTool(name ?? null),
        onBack: () => selectTab('insights'),
      })
    } else if (tab === 'mcp') {
      body = McpView({ model: mcpModel, page: mcpPage, onPage: page => setMcpPage(page), onBack: () => selectTab('insights') })
    } else if (tab === 'create') {
      body = typeof CreateToolView === 'function'
        ? CreateToolView({ call: options.call })
        : Banner('The Create tool editor is unavailable in this build.', 'mti-banner mti-banner-warn')
    } else if (tab === 'settings') {
      body = SettingsView({ settings: options.settings })
    } else {
      body = InsightsView({
        model,
        range,
        now,
        toolPage,
        toolPageSize,
        callPage,
        callPageSize,
        expanded,
        onSelectRange: next => { setRange(next); setToolPage(1); setCallPage(1); loadReport(next) },
        onOpenInventory: () => selectTab('inventory'),
        onToolPage: page => setToolPage(page),
        onCallPage: page => setCallPage(page),
        onToggleCall: key => setExpanded(previous => ({ ...previous, [key]: previous[key] !== true })),
        onSelectTool: name => { setSelectedTool(name); selectTab('inventory') },
        onCallPageSize: size => { setCallPageSize(size); setCallPage(1) },
      })
    }

    return h('div', { className: 'mti-page', 'data-page': 'tool-insights' },
      h('style', null, CSS),
      TabBar({ tab, onSelect: selectTab }),
      body)
  }

  return {
    // pure helpers (tests and the registration both use them)
    PALETTE,
    TABS,
    RANGES,
    TOOL_PAGE_SIZES,
    readTabFromHash,
    tabHash,
    formatNumber,
    formatPercent,
    formatDuration,
    formatBytes,
    formatAgo,
    pageInfo,
    paginate,
    normalizeProjection,
    aggregateProjections,
    normalizeReport,
    deriveInsights,
    rangeWindow,
    reportQuery,
    requestUsageReport,
    requestMcpCalls,
    groupCallRows,
    filterAndGroupInventory,
    inventorySuccessRate,
    originOf,
    normalizeMcpStatus,
    mcpView,
    // components
    Card,
    Kpi,
    Pager,
    TabBar,
    Banner,
    EmptyState,
    CallsPerDay,
    ModelLeaderboard,
    ToolPerformanceTable,
    AllCallsTable,
    InsightsView,
    InventoryView,
    McpView,
    SettingsView,
    ...(typeof CreateToolView === 'function' ? { CreateToolView } : {}),
    ToolInsightsPage,
    ToolInsightsIcon,
  }
}

    const toolInsights = createToolInsights(h, React)

    /**
     * The catalog, embedded at build time by scripts/gen-client-catalog.mjs.
     *
     * Each entry: { id, name, summary, package, capability, sizeMB, license,
     * runnable, reason }. `runnable` is this host's capability verdict, so the
     * page can only offer toggles for models that can actually run and can say
     * why the rest cannot.
     */
    const CATALOG = /*__CATALOG_JSON__*/
    [
      {
        "id": "align",
        "name": "Align",
        "summary": "Word-timestamp refinement for any transcript, on device, from 0.7MB.",
        "package": "@desert-ant-labs/align",
        "extension": null,
        "capability": "audio.word-alignment",
        "sizeMB": 0.7,
        "license": "source-available",
        "runnable": false,
        "reason": "Align has no prebuilt native build for win32-x64: @desert-ant-labs/align/native supports linux-x64, linux-arm64 and darwin-arm64 only."
      },
      {
        "id": "clear",
        "name": "Clear",
        "summary": "On-device speech enhancement: denoise, dereverb and loudness-normalize to 48 kHz.",
        "package": "@desert-ant-labs/clear",
        "extension": "@try-works/extension-clear-recipe",
        "capability": "audio.speech-enhancement",
        "sizeMB": null,
        "license": "source-available",
        "runnable": true
      },
      {
        "id": "clips",
        "name": "Clips",
        "summary": "Clip selection that turns a long recording into ranked shorts and highlights from a transcript.",
        "package": null,
        "extension": null,
        "capability": "video.clip-selection",
        "sizeMB": null,
        "license": "source-available",
        "runnable": false,
        "reason": "Clips has no npm package; run it through the Desert Ant CLI (macOS/Linux) with `cli.enabled`, or through a bridge with `remote.endpoint`."
      },
      {
        "id": "ear",
        "name": "Ear",
        "summary": "On-device spoken language identification across 102 languages from a short audio stretch.",
        "package": "@desert-ant-labs/ear",
        "extension": "@try-works/extension-ear-recipe",
        "capability": "audio.spoken-language-identification",
        "sizeMB": null,
        "license": "source-available",
        "runnable": true
      },
      {
        "id": "emo",
        "name": "Emo",
        "summary": "Type a task or message and get the emoji that fit, in 22 languages, on the device.",
        "package": "@desert-ant-labs/emo",
        "extension": "@try-works/extension-emo-recipe",
        "capability": "text.emoji-suggestion",
        "sizeMB": 10.2,
        "license": "source-available",
        "runnable": true
      },
      {
        "id": "eye",
        "name": "Eye",
        "summary": "On-device frame scoring that tells you which shot to keep, what is in it, and which shots repeat.",
        "package": null,
        "extension": null,
        "capability": "image.frame-scoring",
        "sizeMB": null,
        "license": "source-available",
        "runnable": false,
        "reason": "Eye is in closed beta: the weights are published at https://huggingface.co/desert-ant-labs/eye but no SDK ships them yet, so it cannot be installed as a tool."
      },
      {
        "id": "face",
        "name": "Face",
        "summary": "On-device face matching that finds the same person across a photo library or through a video.",
        "package": null,
        "extension": null,
        "capability": "image.face-matching",
        "sizeMB": null,
        "license": "source-available",
        "runnable": false,
        "reason": "Face is in closed beta: the weights are published at https://huggingface.co/desert-ant-labs/face but no SDK ships them yet, so it cannot be installed as a tool."
      },
      {
        "id": "gist",
        "name": "Gist",
        "summary": "On-device topic tagging across a 36-topic taxonomy, in 101 languages, with no server call.",
        "package": "@desert-ant-labs/gist",
        "extension": null,
        "capability": "text.topic-tagging",
        "sizeMB": null,
        "license": "source-available",
        "runnable": false,
        "reason": "Gist has no prebuilt native build for win32-x64: @desert-ant-labs/gist/native supports linux-x64, linux-arm64 and darwin-arm64 only."
      },
      {
        "id": "moderator",
        "name": "Moderator",
        "summary": "On-device NSFW detection that flags nudity before upload, trained only on licensed and synthetic data.",
        "package": "@desert-ant-labs/moderator",
        "extension": "@try-works/extension-moderator-recipe",
        "capability": "image.nsfw-detection",
        "sizeMB": 9.2,
        "license": "source-available",
        "runnable": true
      },
      {
        "id": "redact",
        "name": "Redact",
        "summary": "On-device redaction that strips personal data as you type, in 27 languages, with restore support.",
        "package": "@desert-ant-labs/redact",
        "extension": "@try-works/extension-redact",
        "capability": "text.pii-redaction",
        "sizeMB": null,
        "license": "source-available",
        "runnable": true
      },
      {
        "id": "schemer",
        "name": "Schemer",
        "summary": "Extract typed fields from any text against your own schema, on device, with empty fields left empty.",
        "package": null,
        "extension": null,
        "capability": "text.structured-extraction",
        "sizeMB": null,
        "license": "source-available",
        "runnable": false,
        "reason": "Schemer is in closed beta: the weights are published at https://huggingface.co/desert-ant-labs/schemer but no SDK ships them yet, so it cannot be installed as a tool."
      },
      {
        "id": "shapes",
        "name": "Shapes",
        "summary": "On-device shape recognition that turns one hand-drawn stroke into a rectangle, ellipse, triangle, star or line in under 10ms.",
        "package": "@desert-ant-labs/shapes",
        "extension": "@try-works/extension-shapes-recipe",
        "capability": "stroke.shape-recognition",
        "sizeMB": null,
        "license": "source-available",
        "runnable": true
      },
      {
        "id": "title",
        "name": "Title",
        "summary": "On-device titles and descriptions: a short factual title and a one- or two-sentence description for any passage.",
        "package": null,
        "extension": null,
        "capability": "text.title-generation",
        "sizeMB": null,
        "license": "source-available",
        "runnable": false,
        "reason": "Title is Apple-only (Core ML/MLX through the Swift package); there is no JavaScript SDK, so it cannot run in a Node process. Point `remote.endpoint` at a bridge on an Apple machine to reach it."
      },
      {
        "id": "tongue",
        "name": "Tongue",
        "summary": "On-device language identification for short text across 84 languages, from just a few words.",
        "package": "@desert-ant-labs/tongue",
        "extension": "@try-works/extension-desert-ant-tongue",
        "capability": "text.language-identification",
        "sizeMB": 2,
        "license": "source-available",
        "runnable": true
      },
      {
        "id": "toxic",
        "name": "Toxic",
        "summary": "On-device moderation that flags hateful, abusive and threatening text in 23 European languages.",
        "package": null,
        "extension": null,
        "capability": "text.toxicity-detection",
        "sizeMB": null,
        "license": "source-available",
        "runnable": false,
        "reason": "Toxic is in closed beta: the weights are published at https://huggingface.co/desert-ant-labs/toxic but no SDK ships them yet, so it cannot be installed as a tool."
      },
      {
        "id": "uhm",
        "name": "Uhm",
        "summary": "On-device filler detection that marks every um, uh and hmm to within 20ms, an hour of audio in 12s.",
        "package": null,
        "extension": "@try-works/extension-uhm-recipe",
        "capability": "audio.filler-detection",
        "sizeMB": null,
        "license": "source-available",
        "runnable": true
      },
      {
        "id": "voz",
        "name": "Voz",
        "summary": "Transcribe 10 minutes of audio in 2s on an iPhone, 14x faster than Whisper, with word timestamps.",
        "package": "@desert-ant-labs/voz",
        "extension": "@try-works/extension-desert-ant-voz",
        "capability": "audio.speech-recognition",
        "sizeMB": 349,
        "license": "source-available",
        "runnable": true
      },
      {
        "id": "who",
        "name": "Who",
        "summary": "On-device speaker labeling that turns a recording into per-person turns with face boxes and timestamps.",
        "package": null,
        "extension": null,
        "capability": "audio.speaker-labeling",
        "sizeMB": null,
        "license": "source-available",
        "runnable": false,
        "reason": "Who is in closed beta: the weights are published at https://huggingface.co/desert-ant-labs/who but no SDK ships them yet, so it cannot be installed as a tool."
      }
    ]

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
    const EXTENSIONS = /*__EXTENSIONS_JSON__*/
    [
      {
        "id": "@try-works/extension-clear-recipe",
        "name": "clear recipe",
        "package": "@try-works/extension-clear-recipe",
        "version": "0.1.0",
        "license": "Apache-2.0",
        "summary": "Ships NO CODE.",
        "models": [
          "clear"
        ],
        "tools": [
          "enhance_speech"
        ],
        "contracts": [
          "@try-works/extension-clear-recipe/enhance_speech"
        ]
      },
      {
        "id": "@try-works/extension-declarative-recipes",
        "name": "declarative recipes",
        "package": "@try-works/extension-declarative-recipes",
        "version": "0.1.0",
        "license": "MIT",
        "summary": "Ships NO CODE.",
        "models": [],
        "tools": [],
        "contracts": [
          "text.title",
          "image.describe"
        ]
      },
      {
        "id": "@try-works/extension-desert-ant-tongue",
        "name": "desert ant tongue",
        "package": "@try-works/extension-desert-ant-tongue",
        "version": "0.1.3",
        "license": "MIT",
        "summary": "Language identification over the Desert Ant Labs Tongue model, exposed as the standard tool-mode/lang_detect contract.",
        "models": [
          "tongue"
        ],
        "tools": [
          "lang_detect"
        ],
        "contracts": [
          "tool-mode/lang_detect"
        ]
      },
      {
        "id": "@try-works/extension-desert-ant-voz",
        "name": "desert ant voz",
        "package": "@try-works/extension-desert-ant-voz",
        "version": "0.1.5",
        "license": "MIT",
        "summary": "On-device speech recognition over the Desert Ant Labs Voz model, exposed as the standard tool-mode/stt_transcribe contract.",
        "models": [
          "voz"
        ],
        "tools": [
          "stt_transcribe"
        ],
        "contracts": [
          "tool-mode/stt_transcribe"
        ]
      },
      {
        "id": "@try-works/extension-ear-recipe",
        "name": "ear recipe",
        "package": "@try-works/extension-ear-recipe",
        "version": "0.1.0",
        "license": "Apache-2.0",
        "summary": "Ships NO CODE.",
        "models": [
          "ear"
        ],
        "tools": [
          "identify_language"
        ],
        "contracts": [
          "@try-works/extension-ear-recipe/identify_language"
        ]
      },
      {
        "id": "@try-works/extension-embeddinggemma",
        "name": "EmbeddingGemma 2",
        "package": "@try-works/extension-embeddinggemma",
        "version": "0.1.2",
        "license": "MIT",
        "summary": "Multimodal embedding and retrieval tools over EmbeddingGemma 2 (google/embeddinggemma-2 through a pinned ONNX conversion): multimodal_embed produces 768-, 51…",
        "models": [
          "embeddinggemma-2"
        ],
        "tools": [
          "multimodal_embed",
          "semantic_similarity",
          "semantic_rank",
          "semantic_classify",
          "semantic_deduplicate",
          "dedupe_and_rank",
          "media_find_moments"
        ],
        "contracts": [
          "@try-works/extension-embeddinggemma/multimodal_embed",
          "@try-works/extension-embeddinggemma/semantic_similarity",
          "@try-works/extension-embeddinggemma/semantic_rank",
          "@try-works/extension-embeddinggemma/semantic_classify",
          "@try-works/extension-embeddinggemma/semantic_deduplicate",
          "@try-works/extension-embeddinggemma/dedupe_and_rank",
          "@try-works/extension-embeddinggemma/media_find_moments"
        ]
      },
      {
        "id": "@try-works/extension-emo-recipe",
        "name": "emo recipe",
        "package": "@try-works/extension-emo-recipe",
        "version": "0.1.0",
        "license": "Apache-2.0",
        "summary": "Ships NO CODE.",
        "models": [
          "emo"
        ],
        "tools": [
          "suggest_emojis"
        ],
        "contracts": [
          "@try-works/extension-emo-recipe/suggest_emojis"
        ]
      },
      {
        "id": "@try-works/extension-laya",
        "name": "Laya",
        "package": "@try-works/extension-laya",
        "version": "1.0.4",
        "license": "Apache-2.0",
        "summary": "The Laya decision family (H5): decision_choose (a choice over the caller's options), decision_test (yes/no) and decision_score (an ordinal level) over the pi…",
        "models": [
          "laya"
        ],
        "tools": [
          "decision_choose_local",
          "decision_choose",
          "decision_test",
          "decision_score",
          "decision_test_typed",
          "decision_score_typed"
        ],
        "contracts": [
          "@try-works/extension-laya/decision_choose_local",
          "decision.choose",
          "@try-works/extension-laya/decision_test",
          "@try-works/extension-laya/decision_score",
          "@try-works/extension-laya/decision_test_typed",
          "@try-works/extension-laya/decision_score_typed"
        ]
      },
      {
        "id": "@try-works/extension-minilm-rerank",
        "name": "MiniLM Rerank",
        "package": "@try-works/extension-minilm-rerank",
        "version": "1.0.0",
        "license": "Apache-2.0",
        "summary": "The ms-marco MiniLM-L-6 cross-encoder reranking extension (TOOL-05): query/document pairs cross-encoded to ranking logits, returned with the caller's own ids…",
        "models": [
          "minilm-rerank"
        ],
        "tools": [],
        "contracts": [
          "text.rerank"
        ]
      },
      {
        "id": "@try-works/extension-minilm-embed",
        "name": "MiniLM-L6",
        "package": "@try-works/extension-minilm-embed",
        "version": "1.0.0",
        "license": "Apache-2.0",
        "summary": "The legacy 384-dimensional MiniLM-L6 text embedding space (TOOL-04, BASE-12): mean pooling, L2 normalization, input order preserved.",
        "models": [
          "minilm-l6"
        ],
        "tools": [],
        "contracts": [
          "text.embed"
        ]
      },
      {
        "id": "@try-works/extension-mirage",
        "name": "mirage",
        "package": "@try-works/extension-mirage",
        "version": "0.1.2",
        "license": "Apache-2.0",
        "summary": "Mirage is a 51.3M-parameter, 2-bit Cactus vision model (about 21.6 MB) that describes scenes, finds objects, reads text, produces masks and fills constrained…",
        "models": [
          "mirage"
        ],
        "tools": [
          "mirage_describe",
          "mirage_detect",
          "mirage_ocr",
          "mirage_extract"
        ],
        "contracts": [
          "@try-works/extension-mirage/mirage_describe",
          "@try-works/extension-mirage/mirage_detect",
          "@try-works/extension-mirage/mirage_ocr",
          "@try-works/extension-mirage/mirage_extract"
        ]
      },
      {
        "id": "@try-works/extension-moderator-recipe",
        "name": "moderator recipe",
        "package": "@try-works/extension-moderator-recipe",
        "version": "0.1.0",
        "license": "Apache-2.0",
        "summary": "Ships NO CODE.",
        "models": [
          "moderator"
        ],
        "tools": [
          "classify_nsfw"
        ],
        "contracts": [
          "@try-works/extension-moderator-recipe/classify_nsfw"
        ]
      },
      {
        "id": "@try-works/extension-needle",
        "name": "Needle 3",
        "package": "@try-works/extension-needle",
        "version": "0.1.3",
        "license": "MIT",
        "summary": "Tool proposal, structured extraction, record validation and one repair retry over the pinned Cactus Needle 3 native engine (Cactus-Compute/needle3, windows-x…",
        "models": [
          "needle3"
        ],
        "tools": [
          "tools_plan",
          "structured_extract",
          "validate_record",
          "extract_with_repair"
        ],
        "contracts": [
          "@try-works/extension-needle/tools_plan",
          "@try-works/extension-needle/structured_extract",
          "@try-works/extension-needle/validate_record",
          "@try-works/extension-needle/extract_with_repair"
        ]
      },
      {
        "id": "@try-works/extension-redact",
        "name": "redact",
        "package": "@try-works/extension-redact",
        "version": "0.1.0",
        "license": "Apache-2.0",
        "summary": "PII and secret redaction over the Desert Ant Labs Redact LiteRT artifact, exposed as the redact_text tool.",
        "models": [
          "redact"
        ],
        "tools": [
          "redact_text"
        ],
        "contracts": [
          "@try-works/extension-redact/redact_text"
        ]
      },
      {
        "id": "@try-works/extension-shapes-recipe",
        "name": "shapes recipe",
        "package": "@try-works/extension-shapes-recipe",
        "version": "0.1.0",
        "license": "Apache-2.0",
        "summary": "Ships NO CODE.",
        "models": [
          "shapes"
        ],
        "tools": [
          "shape_recognize"
        ],
        "contracts": [
          "@try-works/extension-shapes-recipe/shape_recognize"
        ]
      },
      {
        "id": "@try-works/extension-uhm-recipe",
        "name": "uhm recipe",
        "package": "@try-works/extension-uhm-recipe",
        "version": "0.1.0",
        "license": "Apache-2.0",
        "summary": "Ships NO CODE.",
        "models": [
          "uhm"
        ],
        "tools": [
          "detect_fillers"
        ],
        "contracts": [
          "@try-works/extension-uhm-recipe/detect_fillers"
        ]
      }
    ]

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
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  position: relative;
  cursor: pointer;
  padding: 0;
  flex: 0 0 auto;
}
.mtt-toggle[data-on='true'] { background: var(--dsw-alias-button-primary-fill); border-color: transparent; }
.mtt-toggle:disabled {
  cursor: not-allowed;
  /* A disabled control must still READ as a control on every host theme.
     The theme mask variable resolved transparent here; explicit neutral
     greys keep the switch visible when the model is unavailable. */
  opacity: 1;
  background: #E5E7EB;
  border-color: #C9CEDA;
}
.mtt-toggle:disabled .mtt-knob {
  background: #8B93A1;
  opacity: 1;
}
.mtt-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-inverted);
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

    /** How long a normalized describe() snapshot is reused before a real host read. */
    const REMOTE_SNAPSHOT_TTL_MS = 5000

    /**
     * Per-namespace read state: one in-flight promise, the last snapshot and when
     * it was taken. A WeakMap because the namespace object is the mounted Remote;
     * entries disappear with it.
     */
    const extensionReads = new WeakMap()

    /** The read state for one namespace, created on first use. */
    function extensionReadState(namespace) {
      let state = extensionReads.get(namespace)
      if (state === undefined) {
        state = { inFlight: null, snapshot: null, at: 0, generation: 0 }
        extensionReads.set(namespace, state)
      }
      return state
    }

    /**
     * Read one extension state snapshot, coalesced per namespace.
     *
     * The page reads from four places (mount, Recheck, the post-action re-read and
     * its follow-up); each would otherwise pay the host's describe, which can take
     * minutes on a large store. Concurrent callers share one in-flight promise, a
     * caller within REMOTE_SNAPSHOT_TTL_MS of the last answer gets that snapshot,
     * and a rejection is never cached, so a retry reaches the host again.
     */
    function describeExtensions(namespace) {
      const state = extensionReadState(namespace)
      if (state.inFlight !== null) return state.inFlight
      if (state.snapshot !== null && Date.now() - state.at < REMOTE_SNAPSHOT_TTL_MS) {
        return Promise.resolve(state.snapshot)
      }
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
        h('div', { className: 'mtt-card' }, FIELDS.map(field => fieldRow(field, value, draft, edit, disabled))),
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
