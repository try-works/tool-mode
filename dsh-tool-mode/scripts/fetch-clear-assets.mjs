/** Fetch pinned clear-studio.onnx into .assets/clear (gitignored). */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.assets', 'clear')
const REVISION = 'b98f790c8a16d572f47bfdebd39964a0cbc987dc'
const FILE = { name: 'clear-studio.onnx', bytes: 24801006, sha256: '4176990296374e972f0c347ddcc7988d216829cafc58e4d54a98dccd715107d9' }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
mkdirSync(OUT, { recursive: true })
const target = join(OUT, FILE.name)
let bytes = existsSync(target) ? readFileSync(target) : undefined
if (bytes === undefined || bytes.length !== FILE.bytes || sha256(bytes) !== FILE.sha256) {
  const response = await fetch('https://huggingface.co/desert-ant-labs/clear/resolve/' + REVISION + '/' + FILE.name)
  if (!response.ok) { console.error('HTTP ' + response.status); process.exit(1) }
  bytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(target, bytes)
}
const digest = sha256(bytes)
const ok = bytes.length === FILE.bytes && digest === FILE.sha256
console.log([FILE.name, String(bytes.length), 'sha256=' + digest, ok ? 'verified' : 'MISMATCH'].join('  '))
if (!ok) process.exit(1)
