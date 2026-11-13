/** P26-15 — the OAuth profile is selectable from host config without a static token. */
import assert from 'node:assert/strict'
import test from 'node:test'

import { selectHttpAuth } from '../src/mcp/auth-selection.ts'

test('static-token remains the default and requires a token', () => {
  const missing = selectHttpAuth({ token: '' })
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.match(missing.reason, /no bearer token/)
  const selected = selectHttpAuth({ token: 'secret' })
  assert.equal(selected.ok, true)
  if (selected.ok) assert.equal(selected.auth.scheme, 'static-token')
})

test('oauth-resource-server is selected from config and needs no static token', () => {
  const selected = selectHttpAuth({
    mode: 'oauth-resource-server',
    profile: { issuer: 'https://issuer.example', audience: 'https://host.example/mcp', requiredScope: ['mcp:call'] },
    token: '',
  })
  assert.equal(selected.ok, true)
  if (!selected.ok) return
  assert.equal(selected.auth.scheme, 'oauth-resource-server')
  if (selected.auth.scheme === 'oauth-resource-server') {
    assert.deepEqual(selected.auth.requiredScope, ['mcp:call'])
  }
})

test('oauth profile mistakes are named, never silently downgraded to static', () => {
  const missing = selectHttpAuth({ mode: 'oauth-resource-server', token: 'secret' })
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.match(missing.reason, /authorizationServerProfile/)
  const noAudience = selectHttpAuth({ mode: 'oauth-resource-server', profile: { issuer: 'x' }, token: 'secret' })
  assert.equal(noAudience.ok, false)
  if (!noAudience.ok) assert.match(noAudience.reason, /audience/)
  const badScope = selectHttpAuth({
    mode: 'oauth-resource-server',
    profile: { issuer: 'x', audience: 'y', requiredScope: [''] },
    token: 'secret',
  })
  assert.equal(badScope.ok, false)
})
