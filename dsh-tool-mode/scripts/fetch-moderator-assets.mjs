/** Fetch pinned moderator.tflite into .assets/moderator (gitignored). */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.assets', 'moderator')
const REVISION = '263b727eedee2c439b4f35b4491ee80802ea8a6e'
const FILE = { name: 'moderator.tflite', bytes: 9618016, sha256: '925d11966ea9086acbfeaf4d00c1dd30c738c531695f2004b68880d3f121cd89' }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
mkdirSync(OUT, { recursive: true })
const target = join(OUT, FILE.name)
let bytes = existsSync(target) ? readFileSync(target) : undefined
if (bytes === undefined || bytes.length !== FILE.bytes || sha256(bytes) !== FILE.sha256) {
  const response = await fetch('https://huggingface.co/desert-ant-labs/moderator/resolve/' + REVISION + '/' + FILE.name)
  if (!response.ok) { console.error('HTTP ' + response.status); process.exit(1) }
  bytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(target, bytes)
}
const digest = sha256(bytes)
const ok = bytes.length === FILE.bytes && digest === FILE.sha256
console.log([FILE.name, String(bytes.length), 'sha256=' + digest, ok ? 'verified' : 'MISMATCH'].join('  '))
if (!ok) process.exit(1)
