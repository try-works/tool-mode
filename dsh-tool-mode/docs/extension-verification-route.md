# Extension verification route for the live Web GUI at `http://127.0.0.1:3080`

Status: **read + browser evidence gathered 2026-10-19 (host restarted; state re-read).** No product
code was modified. `pwsh` is still broken (`SetNamedSecurityInfoW failed (Win32 5)`), so nothing
below depends on a shell. Every claim is anchored to a file, and the exact request/response shapes
are quoted from the source that serves them.

**Headline:**

| Question | Answer |
| --- | --- |
| Can the shared browser authenticate to `:3080` from files alone? | **No.** The launch token is `randomBytes(32)` in process memory only (`packages/client/connection/src/browser-auth.ts:61-67`) and is printed only to stdout (`packages/bundle/web-app/src/index.ts:218-239`). No token file, header, env file, or pid/log file exists. **One user-supplied secret is required** (token URL or an existing `dsh-auth-*` cookie). |
| Is there an HTTP/JSON API for install/prepare/activate? | **Yes:** `POST /api/modelTools/<method>` with the gateway envelope, cookie-authenticated. Exact map in §2. |
| Is there an API to invoke a tool directly? | **No.** Extension tools become DSH tools; the only invocation surface is an agent chat turn. `modelTools` exposes no invoke method (`remote/spec.mjs:286-386`), and DSH registers no tool-invoke Remote endpoint. |
| Does `:3080` run current workspace source? | **No.** It loads `try-works-dsh-tool-mode-0.3.6.tgz`; the workspace is `0.4.7`. Store extensions are also older (`embeddinggemma 0.1.0` vs workspace `0.1.1`; client catalog says Laya `1.0.0` vs workspace `1.0.1`). |
| Can Laya be installed + prepared + activated? | **Install yes; prepare/activate NO.** Laya's asset lock has no fetchable URLs (`docs/PLUGIN.md:214-226`, `packages/extension-laya/models.lock.json:33,40-57`). Prepare fails in-band, activation is then refused by the assets requirement. |
| Can EmbeddingGemma tools return results? | **Not on the current host.** The extension runs, but `@huggingface/transformers` does not resolve from its install tree (`runtimeGaps()` in the installed `lib/index.js:106-119`); `load()` refuses (`:739-748`). The package exists only in `D:\DEV\dsh-tool-mode\node_modules` (3.8.1), not anywhere `C:\Users\erikb\.dsh\profiles\web\node_modules`. |

> **Correction to an earlier Lead fact:** `packages/dsh-tool-mode/lib/index.js`,
> `packages/extension-laya/lib/index.js` and `packages/extension-laya/vendor/laya-ts/index.js`
> **do exist** (read directly). The workspace is built; a directory install copies working JS.
> What does *not* exist is an npm-installed/copied 0.4.7 inside the web profile.

---

## 1. Auth: the only working way to get an authenticated browser session

### Why files cannot produce it

* `BrowserAuth` creates the launch token per process: `processLaunchToken()` →
  `encodeBase64Url(randomBytes(32))`, cached in a `WeakMap` keyed by the process root
  (`packages/client/connection/src/browser-auth.ts:61-67, 207-216`). It is **never persisted**.
* The only publication is the stdout line `dsh web: ${authenticatedUrl}` and the optional
  default-browser handoff (`packages/bundle/web-app/src/index.ts:228-239`,
  `authenticatedUrl()` at `browser-auth.ts:244-248`).
* `/?token=…` mints a signed, `HttpOnly; SameSite=Strict`, 30-day cookie and 303-redirects to `./`
  (`browser-auth.ts:263-289`). `/connect?token=…` mints an API-operator cookie and redirects to
  `./api/remote.mux` (`:314-348`). There is no other accepted credential: `admit()` checks the
  browser cookie first, then an API cookie, else **401** (`packages/client/connection/src/rpc-host.ts:129-137`).
  That is exactly what the shared Chrome gets today.

Observed now (shared browser, both authorities):

```
GET  http://127.0.0.1:3080/                     -> 401
GET  http://localhost:3080/                     -> 401
POST http://localhost:3080/api/modelTools/describe
     credentials: include, cookie header         -> 401 "unauthorized"
document.cookie                                  -> []          (nothing script-visible)
```

### The one-time exchange the Lead must perform

Ask the user for **exactly one** of these:

**Preferred — the URL line.** In the terminal/console that runs the host (for the web profile it is
started by `dsh web`, see `D:\deepseek-harness\package.json:211`), copy the line that starts with
`dsh web: http://127.0.0.1:3080/?token=`. It is printed once per process; after a restart it is a
**new** token. The Lead then runs:

```
browser_goto  <that exact URL>        # -> 303 to ./ ; Set-Cookie dsh-auth-<hash>=v1....
browser_goto  http://127.0.0.1:3080/  # -> 200, the GUI
```

**Fallback — the cookie.** On a browser tab that already works, DevTools → Application → Cookies →
`http://127.0.0.1:3080` → copy `dsh-auth-<hash>` name **and** value. The Lead runs on the 401 page:

```js
document.cookie = "dsh-auth-<hash>=<value>; path=/; SameSite=Strict"
location.reload()
```

JS cannot set `HttpOnly`, which is fine: the server only reads the value, and the signature is what
authenticates it (`browser-auth.ts:146-180, 356-383`).

**Good news:** the cookie survives host restarts. The HMAC signing secret is a durable credential
record (`browser-auth.ts:182-199`, `AUTH_RECORD_KEY = client-connection/browser-session`), so once
the browser is authenticated, later restarts do not require a new token. Only the *token* changes.

**Definitive:** without one of those two user-provided secrets, an authenticated `:3080` session is
**impossible** from this session — no file on disk contains it.

---

## 2. API map (exact method + path + body)

Transport: `POST {origin}/api/<namespace>/<method>`, `content-type: application/json`, **cookie**
`dsh-auth-*` (the browser sends it automatically with `credentials: "include"`). Body is the
Connection envelope; the gateway requires `payload` to be exactly `{ args: {…} }` with named
arguments (`packages/api/gateway/src/index.ts:1246-1265`), and the `method` must equal the URL
endpoint (`packages/client/connection/src/rpc-host.ts:333-339`).

```json
{
  "type": "client-request",
  "rpcId": "<any unique string>",
  "method": "modelTools/<method>",
  "payload": { "args": { } }
}
```

Response: `{ "type": "server-response", "rpcId": "...", "result": { "ok": true, "value": … } }`
or `{ "ok": false, "error": { "code", "message", "details" } }`.

| Action | HTTP | `method` field | `payload.args` | Success `value` (plugin 0.3.6) |
| --- | --- | --- | --- | --- |
| Read state | `POST /api/modelTools/describe` | `modelTools/describe` | `{}` | `{ store, writable, sourceDir, extensions: ExtensionState[] }` (`lib/extensions-api.d.ts` / `extensions-service.js:832-943`) |
| Install Laya | `POST /api/modelTools/installExtension` | `modelTools/installExtension` | `{ "id": "@try-works/extension-laya", "source": "D:/DEV/dsh-tool-mode/packages/extension-laya" }` (omit `source` to use `extensionSourceDir + "extension-laya"` — `extensions-service.js:1021-1029`) | `{ "id": "@try-works/extension-laya", "version": "1.0.1", "active": false }` |
| Prepare asset | `POST /api/modelTools/prepare` | `modelTools/prepare` | `{ "id": "@try-works/extension-embeddinggemma" }` (or `…-laya`) | `{ id, prepared, reason, plan, readiness, groups, activationReady }` (`extensions-api.ts:177-197`) |
| Activate | `POST /api/modelTools/enable` | `modelTools/enable` | `{ "id": "@try-works/extension-embeddinggemma" }` | `{ "id": …, "active": true, "disabled": false }` |
| Deactivate | `POST /api/modelTools/disable` | `modelTools/disable` | `{ "id": … }` | `{ id, active: false, disabled: true }` |

Method specs: `remote/spec.mjs:286-386` (`INSTALL_WIRE_METHOD = 'installExtension'` — **not**
`install`; `id` is the package identity, the row id equals it).

Token→cookie exchange (for a script/HTTP client, **not** needed for the browser once `?token=`
worked):

```
GET {origin}/connect?token=<token>&interactions=none
 -> 302, location ./api/remote.mux, Set-Cookie: dsh-auth-<hash>=v2.<payload>.<sig>; HttpOnly; SameSite=Strict
```

`ExtensionState` row (`packages/dsh-tool-mode/src/extensions-api.ts:57-83`):
`id, package, version, installed, active, disabled, integrity, tools[], reason,
requirements[{kind,satisfied,reason,action}], blocked`.
`store` is `null` unless `config.extensionStore` is set — it **is** set here, so Install is enabled.

---

## 3. Step-by-step verification script (browser tools only)

All steps assume §1 succeeded (page loads 200). `origin = http://127.0.0.1:3080`.

### Step 0 — prove the session

```
browser_goto      http://127.0.0.1:3080/
browser_a11y      (expect the app shell; a "Settings" control in the sidebar)
browser_evaluate  (async () => {
  const r = await fetch('/api/modelTools/describe', {method:'POST', credentials:'include',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({type:'client-request', rpcId:'d1', method:'modelTools/describe', payload:{args:{}}})});
  return { status: r.status, body: await r.text() };
})()
```

**Expected observable:** status `200`; `body` parses to
`{"type":"server-response","rpcId":"d1","result":{"ok":true,"value":{…}}}` with
`value.store = "C:/Users/erikb/.dsh/profiles/web/extensions"`,
`value.writable = true`, `value.sourceDir = "D:/DEV/dsh-tool-mode/packages"`.
If it is `401 "unauthorized"`, §1 was not actually completed — stop.

### Step 1 — install Laya from the first-party package dir

UI route (click): sidebar **Settings** → section **"Model as Tool"** (registered id `model-tools`,
label exact, `client/index.js:1638-1644`, title `Model as Tool` `:1589`) → Laya row →
button with text **Install** (`:1204-1215`). While working it reads `Installing…`.

API route (exact, no 30 s risk because install is short):

```js
await fetch('/api/modelTools/installExtension', {method:'POST', credentials:'include',
  headers:{'content-type':'application/json'},
  body: JSON.stringify({type:'client-request', rpcId:'i1', method:'modelTools/installExtension',
    payload:{args:{ id:'@try-works/extension-laya',
                    source:'D:/DEV/dsh-tool-mode/packages/extension-laya' }}})}).then(r=>r.json())
```

**Expected observable:** `result.value = { id:"@try-works/extension-laya", version:"1.0.1", active:false }`.
Then `describe` shows the row `installed:true, active:false, version:"1.0.1", tools:[decision_choose,
decision_test, decision_score], blocked:true`, with an unmet `assets` requirement whose action is
`prepare` and whose reason contains `laya needs its model assets prepared`.

If it refuses instead, the exact codes are `extension-source-missing`, `extension-source-invalid`,
`extension-source-mismatch`, `extension-source-directories-not-allowed`,
`extension-dependency-unsatisfied`, `extension-install-failed`
(`extensions-service.js:1017-1087`). `dependencies` include `onnxruntime-node`, materialized from
`preinstalledDependenciesRoot`, so install can take ~1 min.

### Step 2 — attempt Laya prepare (expected honest refusal) and activation refusal

```js
await fetch('/api/modelTools/prepare', {method:'POST', credentials:'include',
  headers:{'content-type':'application/json'},
  body: JSON.stringify({type:'client-request', rpcId:'p1', method:'modelTools/prepare',
    payload:{args:{ id:'@try-works/extension-laya' }}})}).then(r=>r.json())
```

**Expected observable (prepared:false, in-band — this is the correct result, not a bug):**

```json
{"ok":true,"value":{"id":"@try-works/extension-laya","prepared":false,
 "reason":"text-backbone/laya-encoder-onnx: Failed to parse URL from the split export of the pinned checkpoint",
 "plan":{"modelId":"laya","totalBytes":1324777402,"requiresExecutableApproval":false,…},
 "readiness":{"laya":"needs-preparation"},"groups":[],"activationReady":false}}
```

Cause: `models.lock.json` sources are prose descriptions, not URLs (`:33,40-57`); the HTTP source
passes `asset.source` straight to `fetch` (`lib/http-acquisition.js:31-43`) and
`prepare` returns the acquisition failure verbatim (`lib/prepared-assets.js:250-252`;
`lib/extensions-service.js:1267-1277`). `docs/PLUGIN.md:214-226` documents this as a known,
deliberate blocker ("a Settings-page Prepare for Laya refuses at the transport rather than
pretending to download").

Consequence: the row's toggle is disabled (`enableBlocked`, `client/index.js:1017,1196`). Calling
`enable` anyway returns `{ok:false,error:{code:"extension-preparation-required", message:"…"}}`
(`extensions-service.js:1135-1140`). **Laya can be installed but not activated or called on this
host.** Do not record this as a product failure; record it as an external-artifact block.

### Step 3 — prepare EmbeddingGemma (long; use click or fire-and-poll)

Disclosure first: the plan is ~**2.96 GB** total across 3 groups (text 1,116,768,801 B; vision
671,149,217 B; audio 1,172,955,985 B — sum of `packages/extension-embeddinggemma/models.lock.json`).
The cache already holds the text-backbone group and a partial vision file, so roughly **1.84 GB**
must still transfer. A `browser_evaluate` that `await`s the call will hit the tool's ~30 s timeout.
Use one of:

* **Click:** Settings → "Model as Tool" → EmbeddingGemma row → **Prepare** (`client/index.js:1240-1248`);
  the row shows `Preparing…` and an in-page note when it settles (`prepareResultNote`, `:1047-1074`).
* **Fire-and-poll:** start it without awaiting, then poll `window.__prep` every few minutes:

```js
window.__prep = null;
fetch('/api/modelTools/prepare', {method:'POST', credentials:'include',
  headers:{'content-type':'application/json'},
  body: JSON.stringify({type:'client-request', rpcId:'p2', method:'modelTools/prepare',
    payload:{args:{ id:'@try-works/extension-embeddinggemma' }}})})
  .then(r => r.json()).then(v => { window.__prep = v; });
'started'
```

Poll `window.__prep` (null = still running). **Expected success:** `prepared:true`,
`readiness:{"embeddinggemma-2":"prepared-cold"}`, `activationReady:true`, `groups:
["text-backbone","vision-encoder","audio-encoder"]`; the cache gains
`asset-cache/groups/@try-works__extension-embeddinggemma/embeddinggemma-2/{text-backbone,
vision-encoder,audio-encoder}/…` and the `.partial-*` file disappears. A cancel/network failure
leaves the partial and reports `prepared:false` with a retryable reason.

Then activate (no-op-safe if already active):

```js
await fetch('/api/modelTools/enable', {… method:'modelTools/enable', payload:{args:{id:'@try-works/extension-embeddinggemma'}}})
```

**Expected observable:** `{active:true, disabled:false}`, and `describe` readiness becomes
`prepared-cold` (or `ready` once loaded).

### Step 4 — invoke the tool (chat turn; that is the only surface)

Create a **new session** in the GUI (tools are registered at host boot; `state.json` shows the
extension already `active`, so its six tools are in the catalog). Send one message:

> Call the `semantic_similarity` tool with exactly these arguments and show me the raw result:
> `{"left":{"id":"l","parts":[{"kind":"text","text":"a cat sat on the mat"}]},"right":{"id":"r","parts":[{"kind":"text","text":"a feline rested on the rug"}]}}`

**Success signal:** a tool card in the chat whose result JSON is
`{"score": <number in [-1,1]>, "scoreKind":"cosine_similarity",
"embeddingSpaceId":"embeddinggemma-2/text/daa72c512439-9fd452bfc691",
"processing":[…]}`, matching the implementation at installed `lib/index.js:792-804`. The same call
appears in the session **Trajectory** tab under `data-kind="tool"` (that is the durable receipt).

**What will happen today instead (verified by source + filesystem, not yet by click):** the call
fails with a named refusal, not a result:

```
EmbeddingGemma 2 is not prepared: @huggingface/transformers does not resolve on this host.
The deployment reports needs-preparation rather than loading a partial route (MOD-02)
```

(exact `load()` text at installed `lib/index.js:739-748`; if prepare was also skipped the same
message additionally names `the "text-backbone" asset group was not prepared`).

`runtimeGaps()` resolves both optional runtimes from the extension module
(`…/extension-embeddinggemma/0.1.0/lib/index.js:106-119`); `load()` throws when any gap exists
(`:739-748`). Resolution ancestors are the store tree and `C:\Users\erikb\.dsh\profiles\web\node_modules`
(has `onnxruntime-node`, **no** `@huggingface/transformers`). The only 3.8.1 copy on this machine is
`D:\DEV\dsh-tool-mode\node_modules\@huggingface\transformers` (version 3.8.1), which Node will
not search from the store path.

**To make it pass (requires a shell — see §5):** install `@huggingface/transformers@3.8.1` and
`onnxruntime-node` into `C:\Users\erikb\.dsh\profiles\web` (or the extension's own `node_modules`),
restart the host, re-run Step 4. `docs/tool-mode/qualification/embeddinggemma.json` records the
qualified engine as exactly this pair.

---

## 4. How to prove "tools usable": the minimal call and where the result is visible

* **Tool ids:** EmbeddingGemma `multimodal_embed`, `semantic_similarity`, `semantic_rank`,
  `semantic_classify`, `semantic_deduplicate`, `media_find_moments`; Laya `decision_choose`,
  `decision_test`, `decision_score` (`EXTENSIONS` catalog in `client/index.js:263-326`).
* **Minimal call:** `semantic_similarity` with the two text items above — one tool, no file IO,
  no model downloading at call time, a single scalar in the result.
* **Where results are visible:** (1) the chat tool-result card (raw JSON expandable), (2) the
  session **Trajectory → tool row** with the recorded call/result, (3) the `model_tools` control
  tool's `receipts` action for invocation provenance (agent-side). There is **no** in-page tool
  playground: a search of `packages/client` for a tool invoker finds none, and the only Remote
  namespace this plugin adds is `modelTools` (`describe/installExtension/enable/disable/prepare`),
  which has no invoke member.
* **Registration (not callability) is visible by clicking:** the "Model as Tool" settings page lists
  each extension's models/tools and the host's `tools[]` from `describe`. That proves publication;
  only a chat call proves execution.

Which host serves which:

| Surface | What it is | What it proves |
| --- | --- | --- |
| `http://127.0.0.1:3080` | DSH Web GUI, profile `web`, plugin **0.3.6** | install/prepare/activate state, and (after the fixes above) real tool execution by the GUI agent |
| The agent session you are reading this in | separate harness (checkout `D:\deepseek-harness`, catalog revision 7) | **nothing about `:3080`** — e.g. calling `lang_detect` there is not evidence for this host |

---

## 5. Does `:3080` run current source? How to rebuild/restart without a shell

**No — the plugin is stale.** The profile pins a tarball, not the workspace:

* `C:\Users\erikb\.dsh\profiles\web\package.json:10` →
  `"@try-works/dsh-tool-mode": "file:C:/Users/erikb/.dsh/profiles/web/plugins/try-works-dsh-tool-mode-0.3.6.tgz"`
* Installed `…/profiles/web/node_modules/@try-works/dsh-tool-mode/package.json:3` → `"version": "0.3.6"`.
* Workspace `packages/dsh-tool-mode/package.json:3` → `"version": "0.4.7"`.
* The 0.3.6 client catalog embedded in the page says Laya `1.0.0` and EmbeddingGemma `0.1.0`
  (`client/index.js:280-326`); the workspace packages are `1.0.1` and `0.1.1`.
* The store's installed copies came from `D:\DEV\dsh-tool-mode\packages\…` on 2026-10-18
  (`extensions.lock.json`), but they are frozen bytes, not links: editing the workspace changes
  nothing the host loads.

The DSH **host** itself was measured earlier as source mode
(`node --import tsx/esm apps/cli/src/bin.ts "web"`, `docs/tool-mode/PTC-INTEGRATION-FINDINGS.md:531-541`);
that identity cannot be re-checked without `Get-CimInstance`, and it does not change the conclusion:
the *plugin* is the stale 0.3.6 bundle.

**Without a shell, rebuilding/redeploying is impossible.** The Lead can only read, click, and call
HTTP. The honest statement is: the current `:3080` process can be *used* to verify 0.3.6 behavior,
not 0.4.7 behavior. When a shell is available:

```powershell
cd D:\DEV\dsh-tool-mode
npm run build                       # tsc for every package (lib/ already exists, this refreshes it)
npm run plugin:pack                 # npm pack --workspace @try-works/dsh-tool-mode -> tgz
# copy the new tgz under C:\Users\erikb\.dsh\profiles\web\plugins\
# point profiles\web\package.json's @try-works/dsh-tool-mode at it, then:
cd C:\Users\erikb\.dsh\profiles\web ; pnpm install
# restart the host (new launch token; existing auth cookie remains valid):
cd D:\deepseek-harness ; pnpm start:web          # or: node --import tsx/esm apps/cli/src/bin.ts web
```

Restarting is itself a shell action; nobody can restart `:3080` from the browser. The user must do
it, and afterwards supply the new `?token=` line (or rely on the still-valid cookie).

---

## 6. Read-only evidence gathered now (paths + values)

**Profile / host wiring**

| File | Value |
| --- | --- |
| `C:\Users\erikb\.dsh\profiles\web\cordis.patch.yml:98-107` | `- id: model-tools` / `name: "@try-works/dsh-tool-mode"`; `extensionStore: "C:/Users/erikb/.dsh/profiles/web/extensions"`; `extensionSourceDir: "D:/DEV/dsh-tool-mode/packages"`; `allowPreinstalledDependencies: true`; `preinstalledDependenciesRoot: "D:/DEV/dsh-tool-mode"`; `allowExecutablePreparation: true`; `extensions.allowSourceDirectories: true` |
| `C:\Users\erikb\.dsh\profiles\web\package.json:10,23-44` | plugin from `…-0.3.6.tgz`; `dsh.profile.bundles` includes `@try-works/dsh-tool-mode` |
| `C:\Users\erikb\.dsh\profiles\web\node_modules\@try-works\dsh-tool-mode\package.json:3` | `0.3.6` |
| `D:\DEV\dsh-tool-mode\packages\dsh-tool-mode\package.json:3` | `0.4.7` |

**Extension store** (`C:\Users\erikb\.dsh\profiles\web\extensions\`)

| File | Value |
| --- | --- |
| `extensions.lock.json:20-35` | only `@try-works/extension-embeddinggemma@0.1.0` (digest `ccb7d8b1…`, source `D:\DEV\dsh-tool-mode\packages\extension-embeddinggemma`, installedAt `2026-10-18T10:29:08.971Z`) and `@try-works/extension-declarative-recipes@0.1.0` |
| `profiles\default\state.json:6-42` | EmbeddingGemma `installation:"installed"`, `desiredActivation:"active"`, `observedActivation:"active"`, `ownerPid:19664` (host restarted), six tools enabled, `readiness:{"embeddinggemma-2":"needs-preparation"}` |
| `profiles\default\state.json:43-52` | declarative-recipes active, `tools:[]` |
| same file | **no Laya row** anywhere — not installed |
| `extensions\@try-works\extension-embeddinggemma\0.1.0\.tool-mode-install.json` | runtime link to the plugin's bundled SDK only; **no** `@huggingface/transformers`, **no** `onnxruntime-node` in the extension tree |

**Prepared asset cache** (`C:\Users\erikb\.dsh\model-as-tool\asset-cache\groups\`)

| Path | State |
| --- | --- |
| `@try-works__extension-embeddinggemma\embeddinggemma-2\text-backbone\` | **complete**: `onnx/model.onnx`, `onnx/model.onnx_data`, `tokenizer.json`, `tokenizer_config.json`, `config.json` |
| `…\embeddinggemma-2\vision-encoder\onnx\vision_encoder.onnx` | encoder present; `vision_encoder.onnx_data` **missing**, only `.partial-ca8d28c9…` in the cache root |
| `audio-encoder` | **absent** |
| `@try-works__extension-laya\…` | **absent** (a glob for `laya` under the groups root returns nothing) |
| needle, minilm-embed, minilm-rerank | present (not part of this task) |

**Runtime resolution** (why the EmbeddingGemma call cannot work today)

| Path | Present? |
| --- | --- |
| `C:\Users\erikb\.dsh\profiles\web\node_modules\onnxruntime-node\package.json` | yes |
| `C:\Users\erikb\.dsh\profiles\web\node_modules\@huggingface\transformers\package.json` | **no** |
| `C:\Users\erikb\.dsh\profiles\node_modules\…`, `C:\Users\erikb\.dsh\node_modules\…` | **no** |
| `D:\DEV\dsh-tool-mode\node_modules\@huggingface\transformers\package.json` | yes, version **3.8.1** (not on the store path's resolution chain) |

**Workspace packages (source of any directory install)**

| Fact | Evidence |
| --- | --- |
| Laya is `1.0.1`, Apache-2.0, 3 tools, model `laya`, asset set `laya-decision-onnx`, platform win32/x64/cpu | `packages/extension-laya/package.json`, `tool-mode.extension.json` |
| Laya lib and vendored runtime are built | `packages/extension-laya/lib/index.js`, `lib/pure.js`, `vendor/laya-ts/index.js` read successfully |
| Laya prepare cannot download | `models.lock.json:33` says the sources "are descriptions … the host-driven acquisition step has NOT been exercised against them, so a Settings-page Prepare for Laya refuses at the transport"; `docs/PLUGIN.md:214-226` |
| EmbeddingGemma is `0.1.1`, optional deps `@huggingface/transformers ^3`, `onnxruntime-node ^1.20` | `packages/extension-embeddinggemma/package.json:34-37` |
| EmbeddingGemma asset plan = 3 groups, ~2.96 GB | `models.lock.json` (text 1,116,768,801 B; vision 671,149,217 B; audio 1,172,955,985 B) |
| Plugin declares no registry-install path in 0.3.6 | `extensions-service.js:1017-1087` accepts only a directory (or the configured source dir) |

---

## 7. Bottom line for the Lead

1. **Auth:** impossible from files. Get one user secret (token URL preferred, cookie fallback),
   then `browser_goto` it; the 30-day cookie survives later restarts.
2. **Install Laya:** expected to succeed via `installExtension` (or the Install button) and return
   `version 1.0.1`, `active:false`. This is the one complete step that can be verified end-to-end.
3. **Laya prepare/activate/call: blocked by design** — the asset lock has no URLs. Expected
   `prepared:false` with `Failed to parse URL from the split export of the pinned checkpoint`, then
   `extension-preparation-required` on enable. Report as an external-artifact block, not a bug.
4. **EmbeddingGemma prepare:** possible but ~1.84 GB still to download; use the Prepare button or
   fire-and-poll, never an awaited `browser_evaluate`. Success = readiness `prepared-cold`.
5. **EmbeddingGemma call: currently impossible** — `@huggingface/transformers` is missing from the
   host's resolution chain. Expected named refusal; a shell is required to install it. EmbeddingGemma
   publication/activation *is* verifiable; real results are not.
6. **`:3080` is stale (plugin 0.3.6 vs workspace 0.4.7).** Use it to verify 0.3.6 behavior only.
   Rebuild/redeploy/restart all require a shell (user action).
