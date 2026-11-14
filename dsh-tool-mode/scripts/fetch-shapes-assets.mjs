/**
 * Fetch the pinned shapes asset into .assets/shapes (gitignored).
 * Pinned revision: ee004d08b3e5ed734fdf656277ead56c0225f9c0 (desert-ant-labs/shapes).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.assets', 'shapes')
const REVISION = 'ee004d08b3e5ed734fdf656277ead56c0225f9c0'
const FILE = { name: 'shapes.tflite', bytes: 974896, sha256: '8274742f91341e54ae64df4c561a19e5fb4cf591d6b305290d129068f56ef6b9' }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
mkdirSync(OUT, { recursive: true })
const target = join(OUT, FILE.name)
let bytes = existsSync(target) ? readFileSync(target) : undefined
if (bytes === undefined || bytes.length !== FILE.bytes || sha256(bytes) !== FILE.sha256) {
  const response = await fetch('https://huggingface.co/desert-ant-labs/shapes/resolve/' + REVISION + '/' + FILE.name)
  if (!response.ok) { console.error('HTTP ' + response.status); process.exit(1) }
  bytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(target, bytes)
}
const digest = sha256(bytes)
const ok = bytes.length === FILE.bytes && digest === FILE.sha256
console.log([FILE.name, String(bytes.length), 'sha256=' + digest, ok ? 'verified' : 'MISMATCH'].join('  '))
if (!ok) process.exit(1)
