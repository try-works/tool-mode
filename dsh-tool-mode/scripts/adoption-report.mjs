#!/usr/bin/env node
/**
 * Adoption experiment report (D/G/O).
 *
 * Reads the session ledger and the durable artifact usage file, then prints one
 * row per arm. It performs no model calls and reads no tool arguments.
 *
 * Usage:
 *   node scripts/adoption-report.mjs --session-ledger <file> [--usage <file>]
 */
import { readFileSync } from 'node:fs'

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Summarise one ledger document.
 * @param {{ sessions?: Record<string, { arm?: string | null, authored?: number, reused?: number, saveOffers?: number, called?: Record<string, number> }> }} document
 * @param {{ rows?: readonly unknown[] } | undefined} usage
 */
export function summarize(document, usage) {
  const arms = new Map()
  for (const [sessionId, row] of Object.entries(document.sessions ?? {})) {
    const arm = row.arm ?? 'unassigned'
    const bucket = arms.get(arm) ?? {
      arm, sessions: 0, calls: 0, reusedCalls: 0, sessionsWithReuse: 0,
      authored: 0, saveOffers: 0,
    }
    const calls = Object.values(row.called ?? {}).reduce((sum, count) => sum + count, 0)
    bucket.sessions += 1
    bucket.calls += calls
    bucket.reusedCalls += row.reused ?? 0
    bucket.sessionsWithReuse += (row.reused ?? 0) > 0 ? 1 : 0
    bucket.authored += row.authored ?? 0
    bucket.saveOffers += row.saveOffers ?? 0
    arms.set(arm, bucket)
  }
  return [...arms.values()]
    .map(row => ({
      ...row,
      reuseRate: row.sessions === 0 ? 0 : row.sessionsWithReuse / row.sessions,
    }))
    .sort((left, right) => left.arm.localeCompare(right.arm))
}

function main() {
  const args = process.argv.slice(2)
  const valueOf = name => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const ledgerPath = valueOf('--session-ledger')
  if (ledgerPath === undefined) {
    console.error('usage: node scripts/adoption-report.mjs --session-ledger <file> [--usage <file>]')
    process.exitCode = 2
    return
  }
  const document = readJson(ledgerPath)
  if (document === undefined) {
    console.error('could not read ' + ledgerPath)
    process.exitCode = 1
    return
  }
  const usagePath = valueOf('--usage')
  const usage = usagePath === undefined ? undefined : readJson(usagePath)
  const rows = summarize(document, usage)
  console.log('arm	sessions	calls	reusedCalls	sessionsWithReuse	reuseRate	authored	saveOffers')
  for (const row of rows) {
    console.log([
      row.arm, row.sessions, row.calls, row.reusedCalls, row.sessionsWithReuse,
      row.reuseRate.toFixed(3), row.authored, row.saveOffers,
    ].join('\t'))
  }
  if (usage?.rows !== undefined) console.log('artifacts\t' + usage.rows.length)
}

if (process.argv[1]?.endsWith('adoption-report.mjs') === true) main()
