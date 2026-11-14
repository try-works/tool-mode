/**
 * Fetch the pinned redact assets into .assets/redact (gitignored).
 *
 * Pinned revision: b368a62f5088802addcdb3d320b27306b6530bd3 (desert-ant-labs/redact).
 * The .tflite is LFS and its sha256 is asserted; the small files are hashed and printed
 * so models.lock.json can be filled from real bytes, never from a guess.
 *
 * Usage: node scripts/fetch-redact-assets.mjs [--force]
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.assets', 'redact')
const REVISION = 'b368a62f5088802addcdb3d320b27306b6530bd3'
const BASE = 'https://huggingface.co/desert-ant-labs/redact/resolve/' + REVISION + '/'
const FILES = [
  { name: 'redact.tflite', bytes: 23929696, sha256: '2b6237e3a08ee12966929af477fb3723018bacdb74a22f78992b8c0f6b5d545d' },
  { name: 'tokenizer.json', bytes: 2306637 },
  { name: 'tokenizer_config.json', bytes: 312 },
  { name: 'config.json', bytes: 4925 },
  { name: 'labels.json', bytes: 3842 },
  { name: 'redact_meta.json', bytes: 752 },
]
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const force = process.argv.includes('--force')

mkdirSync(OUT, { recursive: true })
let failed = false
for (const file of FILES) {
  const target = join(OUT, file.name)
  let bytes
  if (!force && existsSync(target)) {
    bytes = readFileSync(target)
    if (bytes.length !== file.bytes) { console.log('size mismatch, refetching ' + file.name); bytes = undefined }
  }
  if (bytes === undefined) {
    const response = await fetch(BASE + file.name)
    if (!response.ok) { console.error('HTTP ' + response.status + ' for ' + file.name); failed = true; continue }
    bytes = Buffer.from(await response.arrayBuffer())
    writeFileSync(target, bytes)
  }
  const digest = sha256(bytes)
  const sizeOk = bytes.length === file.bytes
  const digestOk = file.sha256 === undefined || digest === file.sha256
  if (!sizeOk || !digestOk) failed = true
  console.log([file.name, String(bytes.length), 'sha256=' + digest, sizeOk ? 'size-ok' : 'SIZE-BAD', digestOk ? 'digest-ok' : 'DIGEST-BAD'].join('  '))
}
if (failed) { console.error('one or more assets failed verification'); process.exit(1) }
console.log('redact assets ready at ' + OUT)
