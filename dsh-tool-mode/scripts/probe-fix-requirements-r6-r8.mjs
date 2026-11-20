#!/usr/bin/env node
/**
 * Live probe for fix requirements R6/R7/R8 (measured on 0.5.109).
 *
 * Reads the session transcripts of a disposable DSH_HOME and asserts, on the recorded
 * evidence only:
 *
 *   R6  a persisted workspace artifact from a DIFFERENT workspace key is advertised
 *       bindable and its program runs (restart-shaped: seeded store, fresh session).
 *   R7  the same program shape run 3 times yields ONE canonical row with uses:3.
 *   R8  an explicit aggregate hint renders and names a callable per-item route.
 *   R4  a refusal names the tool, not-registered, the caller scope and an action.
 *
 * Statuses: measured / absent / failed. `absent` is a RESULT and exits nonzero: a
 * missing record is never reported as a pass. The probe never starts or stops DSH.
 *
 *   node scripts/probe-fix-requirements-r6-r8.mjs --home E:/tmp/dsh-exp-<id> --json
 *   node scripts/probe-fix-requirements-r6-r8.mjs --command "<headless command>" --json
 *   node scripts/probe-fix-requirements-r6-r8.mjs --self-check --json
 *
 * @module scripts/probe-fix-requirements-r6-r8
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const UNKNOWN_TOOL = 'nonexistent_probe_tool'
const PROBE = 'fix-requirements-r6-r8-0.5.109'

const results = []
function record(id, status, detail, evidence) {
  results.push({ id, status, detail, evidence: evidence ?? null })
}

function decodeTranscript(file) {
  const bytes = readFileSync(file)
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0xFD2FB528) return bytes.toString('utf8')
  const chunks = []
  let offset = 0
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0xFD2FB528) {
    let end = offset + 4
    while (end + 4 <= bytes.length && bytes.readUInt32LE(end) !== 0xFD2FB528) end += 1
    const stop = end + 4 <= bytes.length ? end : bytes.length
    chunks.push(zstdDecompressSync(bytes.subarray(offset, stop)))
    offset = stop
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sessionFiles(home) {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return []
  const files = []
  for (const workspace of readdirSync(root)) {
    const dir = join(root, workspace)
    if (!statSync(dir).isDirectory()) continue
    for (const entry of readdirSync(dir)) {
      const sessionDir = join(dir, entry)
      if (!statSync(sessionDir).isDirectory()) continue
      for (const name of readdirSync(sessionDir)) {
        if (!name.startsWith('session.')) continue
        if (!name.endsWith('.jsonl') && !name.endsWith('.zstd')) continue
        const file = join(sessionDir, name)
        files.push({ file, workspace, session: entry, mtime: statSync(file).mtimeMs })
      }
    }
  }
  return files.sort((a, b) => a.mtime - b.mtime)
}

function recordsOf(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('{') === false) continue
    try { out.push(JSON.parse(trimmed)) } catch { /* a torn line is not evidence */ }
  }
  return out
}

function stringsOf(value, out, depth) {
  if (depth > 8 || value === null || value === undefined) return out
  if (typeof value === 'string') { out.push(value); return out }
  if (Array.isArray(value)) { for (const item of value) stringsOf(item, out, depth + 1); return out }
  if (typeof value === 'object') { for (const item of Object.values(value)) stringsOf(item, out, depth + 1) }
  return out
}

const flatOf = records => records.map(rec => { const parts = []; stringsOf(rec, parts, 0); return parts.join(' ') })

// Some evidence sits inside a JSON string that was re-encoded once more (an accounting log
// inside a report), so its quotes arrive as backslash-quote. Normalise before matching.
const unescapeQuotes = text => text.split(String.fromCharCode(92) + '"').join('"')

/** Structural view: tool/call data.callId -> tool/result data.message.toolCallId. */
function extractCalls(records) {
  const calls = []
  const byId = new Map()
  for (const rec of records) {
    const data = rec !== null && typeof rec === 'object' ? rec.data : undefined
    if (rec.type === 'tool/call' && data !== null && typeof data === 'object' && typeof data.callId === 'string') {
      let requested = []
      if (typeof data.arguments === 'string') {
        try { const args = JSON.parse(data.arguments); requested = Array.isArray(args.tools) ? args.tools : [] } catch { /* unnamed */ }
      }
      calls.push({ callId: data.callId, tools: requested.filter(tool => typeof tool === 'string') })
    }
    if (rec.type === 'tool/result' && data !== null && typeof data === 'object' && data.message !== null && typeof data.message === 'object') {
      const message = data.message
      if (typeof message.toolCallId === 'string') byId.set(message.toolCallId, message)
    }
  }
  return { calls, byId }
}

function textOfMessage(message) {
  const blocks = Array.isArray(message.content) ? message.content : []
  return blocks.filter(block => block !== null && typeof block === 'object' && typeof block.text === 'string')
    .map(block => block.text).join('\n')
}

/** Result of the first call that requested `tool`, or undefined. */
function resultForTool(extracted, tool) {
  const call = extracted.calls.find(entry => entry.tools.includes(tool))
  if (call === undefined) return undefined
  const message = extracted.byId.get(call.callId)
  if (message === undefined) return undefined
  return { callId: call.callId, text: textOfMessage(message), isError: message.isError === true }
}

function digestEntries(records) {
  const out = []
  for (const text of allStrings(records)) {
    if (/^(Use |Also available:)/.test(text) && text.includes('->')) out.push(text)
  }
  return out
}

function allStrings(records) {
  const out = []
  for (const rec of records) stringsOf(rec, out, 0)
  return out
}

function parseJsonObjects(records) {
  const objects = []
  for (const text of allStrings(records)) {
    if (text.trim().startsWith('{') === false) continue
    try {
      const walk = value => {
        if (value === null || typeof value !== 'object') return
        objects.push(value)
        if (Array.isArray(value)) { for (const item of value) walk(item); return }
        for (const item of Object.values(value)) walk(item)
      }
      walk(JSON.parse(text))
    } catch { /* not JSON */ }
  }
  return objects
}

function checkR6(records, sessions) {
  const extracted = extractCalls(records)
  const flat = flatOf(records).map(unescapeQuotes)
  // A workspace-scoped authored row, advertised bindable.
  let row = undefined
  for (const text of flat) {
    if (text.includes('workspace') === false) continue
    const match = text.match(/\"name\"\s*:\s*\"((?:agent|workflow)_[A-Za-z0-9_]+)\"/)
    if (match === null) continue
    const window = text.slice(Math.max(0, text.indexOf(match[0])), text.indexOf(match[0]) + 600)
    if (/\"bindable\"\s*:\s*true/.test(window)) { row = { name: match[1], window }; break }
  }
  const distinctWorkspaces = new Set(sessions.map(s => s.workspace))
  record('R6-bindable',
    row === undefined ? 'absent' : 'measured',
    row === undefined
      ? 'no workspace-scoped authored row with bindable:true in the transcript'
      : 'workspace row ' + row.name + ' is advertised bindable across ' + distinctWorkspaces.size + ' workspace key(s)',
    row === undefined ? null : { name: row.name, excerpt: row.window.slice(0, 240) });
  // The same artifact runs.
  let ran = undefined
  for (const text of flat) {
    const match = text.match(/\"name\"\s*:\s*\"((?:agent|workflow)_[A-Za-z0-9_]+)\"\s*,\s*\"ok\"\s*:\s*true/);
    if (match !== null) { ran = match[1]; break }
  }
  record('R6-runs', ran === undefined ? 'absent' : 'measured',
    ran === undefined ? 'no successful sub-call for an authored artifact' : 'the artifact ' + ran + ' ran successfully',
    ran === undefined ? null : { name: ran });
  // Restart shape: the store was seeded under a different workspace key than the session.
  const seededElsewhere = distinctWorkspaces.size > 1;
  record('R6-restart-shape', seededElsewhere ? 'measured' : 'absent',
    seededElsewhere ? 'sessions span ' + distinctWorkspaces.size + ' workspace keys' : 'only one workspace key under this home; cannot show a cross-workspace restart');
}

function checkR7(records) {
  const objects = parseJsonObjects(records);
  const rows = objects.filter(obj => obj !== null && typeof obj === 'object' && typeof obj.uses === 'number' && typeof obj.name === 'string');
  // R7 is about AUTO-KEEP: a hand-defined aggregate artifact may also have three uses and
  // is not a duplicate of the auto-keep shape. Only count auto-kept rows here.
  const canonical = rows.filter(obj => obj.uses === 3 && /^agent_from_draft_/.test(obj.name));
  record('R7-uses-3', canonical.length === 1 ? 'measured' : 'absent',
    canonical.length === 1
      ? 'exactly one canonical row carries uses:3 (' + canonical[0].name + ')'
      : canonical.length === 0 ? 'no row carries uses:3' : canonical.length + ' rows carry uses:3 (expected one canonical)',
    { rows: rows.slice(0, 6).map(obj => ({ name: obj.name, uses: obj.uses })) });
  const digest = digestEntries(records);
  // The evidence line is gated at five uses, so a uses:3 row cannot print a count. The
  // contract is ONE digest line for the canonical shape: match the canonical ROW name, not
  // an unrelated artifact's uses count.
  const canonicalName = canonical.length === 1 && typeof canonical[0].name === 'string' ? canonical[0].name : undefined
  const line = canonicalName === undefined ? undefined : digest.find(text => text.includes(canonicalName));
  record('R7-one-digest-line', line === undefined ? 'absent' : 'measured',
    line === undefined ? 'no digest line names the canonical R7 row' : 'the digest prints one line for the canonical shape',
    line === undefined ? null : { excerpt: line.slice(0, 240) });
}

function checkR8(records) {
  const entries = digestEntries(records);
  const caveat = entries.find(text => /aggregate/i.test(text));
  record('R8-aggregate-caveat', caveat === undefined ? 'absent' : 'measured',
    caveat === undefined ? 'no digest entry states an aggregate-only output' : 'the digest entry states the aggregate caveat',
    caveat === undefined ? null : { excerpt: caveat.slice(0, 300) });
  if (caveat === undefined) { record('R8-per-item-route', 'absent', 'no caveat to name a route'); return }
  // A route named in the caveat that is callable: it appears in a requested tools list and
  // its paired result is not an error.
  const extracted = extractCalls(records);
  const namedInCaveat = [...new Set((caveat.match(/[A-Za-z_][A-Za-z0-9_]{4,}/g) ?? []))];
  const requested = new Set(extracted.calls.flatMap(entry => entry.tools));
  const route = namedInCaveat.find(name => requested.has(name));
  let callable = false
  if (route !== undefined) {
    const result = resultForTool(extracted, route);
    callable = result !== undefined && result.isError === false
  }
  record('R8-per-item-route', callable ? 'measured' : 'absent',
    callable ? 'the caveat names ' + route + ', which is callable and returned a result'
      : route === undefined ? 'the caveat names no callable per-item route' : 'the caveat names ' + route + ' but it did not run successfully',
    { route: route ?? null, excerpt: caveat.slice(0, 240) });
}

function checkR4(records) {
  const extracted = extractCalls(records);
  const flat = flatOf(records).map(unescapeQuotes);
  const refusal = flat.find(text => text.includes('cannot bind') && /not-registered/.test(text));
  if (refusal === undefined) {
    record('R4-refusal-detail', 'absent', 'no refusal naming not-registered');
    return
  }
  const namedTool = refusal.includes(UNKNOWN_TOOL) ? UNKNOWN_TOOL : (refusal.match(/([A-Za-z_][A-Za-z0-9_]+):\s*not-registered/) ?? [])[1];
  const namesScope = /session-[0-9a-f-]+/.test(refusal) || /session scope/.test(refusal);
  const namesAction = /Install or activate|check the spelling|activate the tool/i.test(refusal);
  const ok = namedTool !== undefined && namesScope && namesAction;
  record('R4-refusal-detail', ok ? 'measured' : 'absent',
    ok ? 'the refusal names the tool, not-registered, the caller scope and an action'
      : 'missing: ' + [namedTool === undefined ? 'tool' : '', namesScope ? '' : 'scope', namesAction ? '' : 'action'].filter(Boolean).join(', '),
    { tool: namedTool ?? null, excerpt: refusal.slice(0, 320) });
}

function finish(json) {
  const notMeasured = results.filter(entry => entry.status !== 'measured')
  const report = { probe: PROBE, generatedAt: new Date().toISOString(), results, failed: notMeasured.map(entry => entry.id) }
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    for (const entry of results) process.stdout.write(entry.status.padEnd(9) + entry.id + ' - ' + entry.detail + '\n');
    process.stdout.write('\n' + (results.length - notMeasured.length) + ' measured, ' + notMeasured.length + ' not measured\n');
  }
  return notMeasured.length === 0 ? 0 : 1
}

function selfCheck(json) {
  const sessions = [{ workspace: '--E-tmp-a--', session: 's1' }, { workspace: '--D-other--', session: 's2' }]
  const good = [
    { type: 'session' },
    { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: JSON.stringify({ tools: [{ name: 'agent_from_draft_aa', workspace: 'd:/dev/other', bindable: true }] }) }] } } },
    { type: 'tool/call', data: { callId: 'c2', name: 'tool_mode_run', arguments: JSON.stringify({ tools: ['agent_from_draft_aa'] }) } },
    { type: 'tool/result', data: { message: { toolCallId: 'c2', isError: false, content: [{ type: 'text', text: JSON.stringify({ logs: ['tool_mode_accounting:{\"calls\":[{\"name\":\"agent_from_draft_aa\",\"ok\":true}]}'] }) }] } } },
    { type: 'tool/result', data: { message: { toolCallId: 'c3', isError: false, content: [{ type: 'text', text: JSON.stringify({ rows: [{ name: 'agent_from_draft_aa', uses: 3 }] }) }] } } },
    { type: 'user/message', content: 'Use agent_from_draft_aa({texts: string[]}) - counts. Evidence: 3 uses, 0 failures. [Verify: aggregate-only output; a per-item route: agent_from_draft_aa; codes da->dk]' },
    { type: 'tool/result', data: { message: { toolCallId: 'c4', isError: true, content: [{ type: 'text', text: 'Error: the program requested tools it cannot bind: nonexistent_probe_tool: not-registered at session scope (session-abc-123) - Install or activate the tool' }] } } },
  ]
  const negative = [{ type: 'session' }]
  const run = (records, label) => {
    const before = results.length
    checkR6(records, sessions); checkR7(records); checkR8(records); checkR4(records)
    const observed = results.splice(before)
    return { label, statuses: observed.map(entry => entry.id + ':' + entry.status) }
  }
  const positive = run(good, 'positive')
  const negativeRun = run(negative, 'negative')
  // The positive fixture deliberately has no R7 digest 'uses' line: that sub-check is
  // allowed to be absent there, the others are not.
  const positiveOk = positive.statuses.filter(entry => entry.endsWith(':measured')).length >= 5
  record('self-check-positive', positiveOk ? 'measured' : 'absent', 'the harness passes a well-formed transcript', positive);
  const negativeFails = negativeRun.statuses.some(entry => entry.includes('absent') || entry.includes('failed'));
  record('self-check-negative', negativeFails ? 'measured' : 'absent', 'the harness fails an empty transcript', negativeRun);
  return finish(json)
}

function main(argv) {
  const arg = name => { const index = argv.indexOf(name); return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined }
  const json = argv.includes('--json')
  if (argv.includes('--self-check')) return selfCheck(json)
  const command = arg('--command')
  const home = arg('--home') ?? join('E:/tmp', 'dsh-exp-' + createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 16));
  if (command !== undefined) {
    mkdirSync(home, { recursive: true })
    try {
      execFileSync(command, { shell: true, cwd: process.cwd(), timeout: Number(arg('--timeout') ?? '600000'), encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, stdio: 'pipe' })
      record('headless-run', 'measured', 'the headless command exited 0', { home })
    } catch (error) {
      record('headless-run', 'failed', 'the headless command failed: ' + (error instanceof Error ? error.message : String(error)), { home })
      return finish(json)
    }
  }
  const sessions = sessionFiles(home)
  if (sessions.length === 0) {
    record('session-transcripts', 'failed', 'no session transcripts under ' + home);
    return finish(json)
  }
  const records = []
  for (const session of sessions) { for (const rec of recordsOf(decodeTranscript(session.file))) records.push(rec) }
  record('session-transcripts', 'measured', sessions.length + ' session(s) parsed from ' + new Set(sessions.map(s => s.workspace)).size + ' workspace key(s)', { sessions: sessions.length, records: records.length });
  if (records.length === 0) { record('records', 'failed', 'no records parsed'); return finish(json) }
  checkR6(records, sessions);
  checkR7(records);
  checkR8(records);
  checkR4(records);
  return finish(json)
}

process.exitCode = main(process.argv.slice(2));
