/** Fetch the pinned emo assets into .assets/emo (gitignored). */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.assets', 'emo')
const REVISION = '7c2e137cb0300ecf8e31b7deab4c4e9734d06b74'
const FILES = [
  { name: 'emo.tflite', bytes: 10222736, sha256: '2c382e8da94bab64172c0694b0350abb96829bf89eb623008ed0085128621de2' },
  { name: 'emo_tokenizer.bin', bytes: 733197, sha256: 'f54462a7a2344f15c9430ed4e399c49444f890dd6094c745a0c5391690bf019d' },
  { name: 'emo_meta.json', bytes: 6280 },
]
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
mkdirSync(OUT, { recursive: true })
let failed = false
for (const file of FILES) {
  const target = join(OUT, file.name)
  let bytes = existsSync(target) ? readFileSync(target) : undefined
  if (bytes === undefined || bytes.length !== file.bytes || (file.sha256 !== undefined && sha256(bytes) !== file.sha256)) {
    const response = await fetch('https://huggingface.co/desert-ant-labs/emo/resolve/' + REVISION + '/' + file.name)
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
