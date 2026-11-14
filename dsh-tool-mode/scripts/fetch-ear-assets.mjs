/** Fetch the pinned ear assets into .assets/ear (gitignored). */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.assets', 'ear')
const REVISION = '1e2148c0cc46130174ecf564c406e44931fca386'
const FILES = [
  { name: 'ear.tflite', bytes: 10671552, sha256: 'a19b43892abe53afba50122a861b10fd76f312a5027a5c659b0738081135feeb' },
  { name: 'ear_meta.json', bytes: 2190 },
  { name: 'languages.json', bytes: 628 },
  { name: 'mel_filters.f32', bytes: 64328 },
]
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
mkdirSync(OUT, { recursive: true })
let failed = false
for (const file of FILES) {
  const target = join(OUT, file.name)
  let bytes = existsSync(target) ? readFileSync(target) : undefined
  if (bytes === undefined || bytes.length !== file.bytes || (file.sha256 !== undefined && sha256(bytes) !== file.sha256)) {
    const response = await fetch('https://huggingface.co/desert-ant-labs/ear/resolve/' + REVISION + '/' + file.name)
    if (!response.ok) { console.error('HTTP ' + response.status + ' ' + file.name); failed = true; continue }
    bytes = Buffer.from(await response.arrayBuffer())
    writeFileSync(target, bytes)
  }
  const digest = sha256(bytes)
  const ok = bytes.length === file.bytes && (file.sha256 === undefined || digest === file.sha256)
  if (!ok) failed = true
  console.log([file.name, String(bytes.length), 'sha256=' + digest, ok ? 'verified' : 'MISMATCH'].join('  '))
}
if (failed) process.exit(1)
