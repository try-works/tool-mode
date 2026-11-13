/**
 * The package version, read from the shipped `package.json`.
 *
 * The host identity and the confinement evidence both need the REAL version. The host
 * previously carried a hard-coded `'0.1.1'` while the package shipped 0.5.x, so every
 * receipt and MCP `serverInfo` reported a version nobody could match to a release, and
 * evidence validation had no trustworthy version to bind to.
 *
 * The read is relative to this module, so it works from `src/` (tests, tsx) and from
 * `lib/` (the published package): both are one directory below `package.json`.
 */
import { readFileSync } from 'node:fs'

/** The version this build reports. */
export const PACKAGE_VERSION: string = (() => {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: unknown
    }
    return typeof manifest.version === 'string' && manifest.version.length > 0
      ? manifest.version
      : '0.0.0'
  } catch {
    // A build whose manifest cannot be read still runs; an unidentifiable version is
    // reported as such rather than guessed.
    return '0.0.0'
  }
})()
