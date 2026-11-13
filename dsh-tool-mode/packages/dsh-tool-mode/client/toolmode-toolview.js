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
      // The plugin's own control tools.
      'tool_mode_list', 'tool_mode_describe', 'tool_mode_run',
      // embeddinggemma
      'multimodal_embed', 'semantic_similarity', 'semantic_rank', 'semantic_classify',
      'semantic_deduplicate', 'media_find_moments', 'dedupe_and_rank',
      // laya
      'decision_choose', 'decision_test', 'decision_score',
      // needle
      'tools_plan', 'structured_extract', 'validate_record', 'extract_with_repair',
      // tongue, voz, minilm, declarative recipes
      'lang_detect', 'stt_transcribe', 'text_embed', 'text_rerank', 'text_title', 'describe_image',
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
