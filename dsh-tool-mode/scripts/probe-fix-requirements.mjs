#!/usr/bin/env node
/**
 * Live probe for the fix-requirements build (R1-R5); measured on 0.5.108.
 *
 * Reads a session transcript produced by a HEADLESS run against a disposable DSH_HOME and
 * asserts the requirements on the RECORDED evidence. It never prints a result it did not
 * observe: every check reports measured / absent / failed, so a missing record cannot be
 * mistaken for a pass.
 *
 *   measured - a record carried the evidence and the assertion held.
 *   absent   - the record was searched for and NOT found. This is a RESULT, and it fails.
 *   failed   - the check could not run (no transcript, unreadable file). Fails.
 *
 * It never starts, stops, packs or installs DSH, and never writes outside its own home.
 *
 * USAGE
 *   node scripts/probe-fix-requirements.mjs --command "<headless command>" --json
 *   node scripts/probe-fix-requirements.mjs --home E:/tmp/dsh-exp-abc --json
 *   node scripts/probe-fix-requirements.mjs --self-check     # prove the harness itself
 *
 * @module scripts/probe-fix-requirements
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

// The stored value quotes the word and, for the sixth, embeds it in prose
// ("a 'Por favor' in the pt block->st"), so a pair is word -> code with a short gap allowed.
const WORD_CODE_PAIRS = [
  { word: "'Tere'", code: 'da' },
  { word: "'Terve'", code: 'hu' },
  { word: "'Dobry'", code: 'sk' },
  { word: "'Hej'", code: 'pl' },
  { word: "'Labas'", code: 'lv' },
  { word: "'Por favor'", code: 'st' },
]

function pairPresent(text, pair) {
  const escaped = pair.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped + '[^\\n]{0,60}->' + pair.code).test(text)
}
const CLOSING_INSTRUCTION = 'Check those items yourself; other labels agree.'

const R1_CALLS = [
  { id: 'authored-tool', tool: 'agent_from_draft_051ab807' },
  { id: 'stored-workflow', tool: 'g1_lang_counts' },
  { id: 'workflow-spelling', tool: 'workflow_g1_lang_counts' },
]
const UNKNOWN_TOOL = 'nonexistent_probe_tool'

const results = []
function record(id, status, detail, evidence) {
  results.push({ id, status, detail, evidence: evidence ?? null })
}

function decodeTranscript(file) {
  const bytes = readFileSync(file)
  if (bytes.readUInt32LE(0) !== 0xFD2FB528) return bytes.toString('utf8')
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
      const candidate = join(dir, entry)
      if (!statSync(candidate).isDirectory()) continue
      for (const name of readdirSync(candidate)) {
        if (!name.startsWith('session.')) continue
        if (!name.endsWith('.jsonl') && !name.endsWith('.zstd')) continue
        const file = join(candidate, name)
        files.push({ file, mtime: statSync(file).mtimeMs })
      }
    }
  }
  return files.sort((a, b) => a.mtime - b.mtime)
}

function recordsOf(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || !trimmed.startsWith('{')) continue
    try { out.push(JSON.parse(trimmed)) } catch { /* a torn final line is not evidence */ }
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

function allStrings(records) {
  const out = []
  for (const rec of records) stringsOf(rec, out, 0)
  return out
}

function checkDigest(records) {
  // A digest ENTRY starts with 'Use ' (a call) or 'Also available:' (a supporting row).
  // Anything else that merely mentions a pair - the 4.4k system prompt does - is not the
  // advertised digest and must not be judged as one.
  const candidates = allStrings(records).filter(text => /^(Use |Also available:)/.test(text) && text.includes('->'))
  const digestText = candidates.find(text => text.includes('Mislabels')) ?? candidates[0]
  if (digestText === undefined) {
    record('R3-digest-pairs', 'absent', 'no digest entry (a string starting Use / Also available: with pairs) appeared in the transcript')
    return
  }
  const missingPairs = WORD_CODE_PAIRS.filter(pair => pairPresent(digestText, pair) === false).map(pair => pair.word + '->' + pair.code)
  const midToken = /->[a-z]\u2026/.test(digestText)
  const hasClosing = digestText.includes(CLOSING_INSTRUCTION)
  const ok = missingPairs.length === 0 && midToken === false && hasClosing
  const detail = missingPairs.length > 0
    ? 'missing pairs: ' + missingPairs.join(', ')
    : midToken
      ? 'rendered value is cut mid-token'
      : hasClosing ? 'all six pairs and the closing instruction are present' : 'closing instruction missing'
  record('R3-digest-pairs', ok ? 'measured' : 'absent', detail, {
    length: digestText.length,
    midToken,
    hasClosing,
    missingPairs,
    // The excerpt the assertion actually read, so the claim can be checked by eye.
    excerpt: digestText.slice(0, 420),
  })
}

function checkR1(records) {
  const flatOf = records.map(rec => { const parts = []; stringsOf(rec, parts, 0); return parts.join(' ') })
  // Structural pairing, exactly as the transcript stores it: a tool/call carries
  // data.callId, and its tool/result carries data.message.toolCallId equal to it. Pairing
  // on those fields is what stops one result being credited to every call.
  const calls = []
  const results = new Map()
  for (let index = 0; index < records.length; index += 1) {
    const rec = records[index]
    const data = rec !== null && typeof rec === 'object' ? rec.data : undefined
    if (rec.type === 'tool/call' && data !== null && typeof data === 'object' && typeof data.callId === 'string') {
      let requested = []
      if (typeof data.arguments === 'string') {
        try {
          const args = JSON.parse(data.arguments)
          requested = Array.isArray(args.tools) ? args.tools : []
        } catch { /* a malformed call cannot name a tool */ }
      }
      calls.push({ callId: data.callId, tools: requested.filter(tool => typeof tool === 'string') })
    }
    if (rec.type === 'tool/result' && data !== null && typeof data === 'object' && data.message !== null && typeof data.message === 'object') {
      const message = data.message
      if (typeof message.toolCallId === 'string') results.set(message.toolCallId, message)
    }
  }
  const textOfMessage = message => {
    const blocks = Array.isArray(message.content) ? message.content : []
    return blocks.filter(block => block !== null && typeof block === 'object' && typeof block.text === 'string')
      .map(block => block.text).join('\n')
  }
  for (const call of R1_CALLS) {
    const requested = calls.find(entry => entry.tools.includes(call.tool))
    if (requested === undefined) {
      record('R1-' + call.id, 'absent', 'no tool_mode_run call requested ' + call.tool)
      continue
    }
    const message = results.get(requested.callId)
    if (message === undefined) {
      record('R1-' + call.id, 'absent', 'no tool/result paired to ' + requested.callId, { callId: requested.callId })
      continue
    }
    const text = textOfMessage(message)
    if (message.isError === true) {
      record('R1-' + call.id, 'absent', 'the paired result was an error for ' + call.tool, { excerpt: text.slice(0, 300) })
      continue
    }
    // The content is a JSON document whose counts live under `result`; a regex fallback
    // covers the escaped form produced when the text is re-encoded.
    let countsOk = false
    try {
      const parsed = JSON.parse(text)
      const counts = parsed !== null && typeof parsed === 'object' && parsed.result !== null && typeof parsed.result === 'object'
        ? parsed.result.counts
        : undefined
      countsOk = counts !== null && typeof counts === 'object' && counts.pl === 1 && counts.fi === 1
    } catch {
      countsOk = /\\"pl\\"\s*:\s*1/.test(text) && /\\"fi\\"\s*:\s*1/.test(text)
    }
    record('R1-' + call.id, countsOk ? 'measured' : 'absent',
      countsOk ? 'the paired result produced pl:1 and fi:1 for ' + call.tool : 'the paired result did not carry pl:1 and fi:1',
      { callId: requested.callId, excerpt: text.slice(0, 220) })
  }
}

function checkR4(records) {
  const flatOf = records.map(rec => { const parts = []; stringsOf(rec, parts, 0); return parts.join(' ') })
  // The refusal is the tool RESULT that names the tool and says it is not registered. The
  // task prompt also names the tool, so a bare name search would credit the prompt.
  let refusal
  for (let index = 0; index < records.length; index += 1) {
    if (String(records[index].type) !== 'tool/result') continue
    const text = flatOf[index]
    if (text.includes(UNKNOWN_TOOL) === false) continue
    if (text.includes('not-registered') === false && text.includes('cannot bind') === false) continue
    refusal = text
    break
  }
  record('R4-unknown-name', refusal === undefined ? 'absent' : 'measured',
    refusal === undefined ? 'no refusal result named ' + UNKNOWN_TOOL : 'the refusal result names the unknown tool',
    refusal === undefined ? null : { excerpt: refusal.slice(0, 300) })
  // Show the field in context, not the head of a long payload.
  const listText = flatOf.find(text => text.includes('"bindable"'))
  const at = listText === undefined ? -1 : listText.indexOf('"bindable"')
  record('R4-list-bindable', listText === undefined ? 'absent' : 'measured',
    listText === undefined ? 'no tool_mode_list payload carried bindable' : 'list rows expose bindable',
    listText === undefined ? null : { excerpt: listText.slice(Math.max(0, at - 140), at + 160) })
}

function finish(json) {
  const failed = results.filter(r => r.status !== 'measured')
  const report = { probe: 'fix-requirements-0.5.108', generatedAt: new Date().toISOString(), results, failed: failed.map(r => r.id) }
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else {
    for (const r of results) process.stdout.write(r.status.padEnd(9) + r.id + ' - ' + r.detail + '\n')
    process.stdout.write('\n' + (results.length - failed.length) + ' measured, ' + failed.length + ' not measured\n')
  }
  return failed.length === 0 ? 0 : 1
}

function selfCheck(json) {
  const good = [
    { type: 'user/message', content: 'Use workflow_g1_lang_counts({texts: string[]}) (stored g1_lang_counts) - Count languages. '
      + '[Verify: Mislabels short one-word items: ' + WORD_CODE_PAIRS.map(pair => pair.word + '->' + pair.code).join(', ')
      + '. ' + CLOSING_INSTRUCTION + ']' },
    // Structural shape, as the transcript stores it: data.callId on the call and
    // data.message.toolCallId on the result, with the report JSON in a text block.
    { type: 'tool/call', data: { callId: 'call_a1', name: 'tool_mode_run', arguments: '{"tools":["agent_from_draft_051ab807"]}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'call_a1', isError: false, content: [{ type: 'text', text: '{"result":{"counts":{"pl":1,"fi":1},"total":2}}' }] } } },
    { type: 'tool/call', data: { callId: 'call_a2', name: 'tool_mode_run', arguments: '{"tools":["g1_lang_counts"]}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'call_a2', isError: false, content: [{ type: 'text', text: '{"result":{"counts":{"pl":1,"fi":1},"total":2}}' }] } } },
    { type: 'tool/call', data: { callId: 'call_a3', name: 'tool_mode_run', arguments: '{"tools":["workflow_g1_lang_counts"]}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'call_a3', isError: false, content: [{ type: 'text', text: '{"result":{"counts":{"pl":1,"fi":1},"total":2}}' }] } } },
    { type: 'tool/result', data: { message: { toolCallId: 'call_au', isError: true, content: [{ type: 'text', text: 'Error: the program requested tools it cannot bind:\n  nonexistent_probe_tool: not-registered at session scope' }] } } },
    { type: 'list', content: '{"tools":[{"name":"g1_lang_counts","bindable":true}]}' },
  ]
  const bad = [{ type: 'message', content: 'agent_from_draft_051ab807 [Verify: Mislabels: Tere->h...]' }]
  // The fixture runs must not pollute the report: their results are REMOVED from the shared
  // accumulator once inspected, so only the two verdicts below are reported.
  const run = (records, label) => {
    const before = results.length
    checkDigest(records)
    checkR1(records)
    checkR4(records)
    const observed = results.splice(before)
    return { label, statuses: observed.map(r => r.id + ':' + r.status) }
  }
  const positive = run(good, 'positive')
  const negative = run(bad, 'negative')
  const positiveOk = positive.statuses.filter(s => s.endsWith(':measured')).length >= 4
  const negativeFails = negative.statuses.some(s => s.includes('absent') || s.includes('failed'))
  record('self-check-positive', positiveOk ? 'measured' : 'absent', 'the harness passes a well-formed transcript', positive)
  record('self-check-negative', negativeFails ? 'measured' : 'absent', 'the harness fails a truncated digest', negative)
  return finish(json)
}

function main(argv) {
  const arg = name => {
    const index = argv.indexOf(name)
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined
  }
  const json = argv.includes('--json')
  if (argv.includes('--self-check')) return selfCheck(json)

  const command = arg('--command')
  const explicitHome = arg('--home')
  const home = explicitHome ?? join('E:/tmp', 'dsh-exp-' + createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 16))
  const timeoutMs = Number(arg('--timeout') ?? '600000')

  if (command !== undefined) {
    mkdirSync(home, { recursive: true })
    try {
      execFileSync(command, { shell: true, cwd: process.cwd(), timeout: timeoutMs, encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, stdio: 'pipe' })
      record('headless-run', 'measured', 'the headless command exited 0', { home })
    } catch (error) {
      record('headless-run', 'failed', 'the headless command failed: ' + (error instanceof Error ? error.message : String(error)), { home })
      return finish(json)
    }
  }

  const files = sessionFiles(home)
  if (files.length === 0) {
    record('session-transcript', 'failed', 'no session transcript under ' + home + '; pass --command or point --home at a recorded run')
    return finish(json)
  }
  const newest = files[files.length - 1]
  record('session-transcript', 'measured', 'read the newest session transcript', { file: newest.file })
  const records = recordsOf(decodeTranscript(newest.file))
  record('records', records.length > 0 ? 'measured' : 'failed', records.length + ' record(s) parsed')
  if (records.length > 0) { checkDigest(records); checkR1(records); checkR4(records) }
  return finish(json)
}

process.exitCode = main(process.argv.slice(2))
