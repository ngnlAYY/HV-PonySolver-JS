# Browser extension edition

## Scope

`apps/extension` builds a desktop WebExtension edition for:

| Artifact | Browsers | Minimum |
| --- | --- | --- |
| Chromium MV3 | Chrome and Edge | Chromium 116 |
| Firefox MV3 | Firefox Desktop | Firefox 142 |

Safari, mobile browsers, Manifest V2, store signing, listing assets and publication are outside this build. The userscript remains independently buildable and installable.

Do not enable the userscript and extension in the same browser profile. Both observe the same captcha DOM and may otherwise submit the same form.

## Runtime architecture

The content script owns only page-facing work:

- bounded captcha DOM observation;
- same-origin image loading with page credentials;
- status-panel DOM;
- settings/history mirror;
- answer checkbox clicks and the native submit-button click.

It sends a versioned request through a long-lived extension Port. Detect requests contain an allowlisted MIME type and at most 2 MiB of JSON-safe base64 image data. Values are decoded from `unknown`; extra fields, arbitrary URLs, malformed IDs and unsupported image types are rejected.

```text
Chromium
content Port -> MV3 service-worker broker -> Offscreen Document
                                                -> packaged module Worker

Firefox
content Port -> nonpersistent background page -> packaged module Worker
```

The Chromium service worker is deliberately stateless. It validates senders, enforces queue ceilings, creates the single Offscreen Document and routes responses. The Offscreen Document holds the inference Host. Firefox's background page holds the same Host directly.

The Host composes the shared bounded model downloader, model IndexedDB cache and `OnnxWorkerClient`. Inference is serialized by that client. A content Port may retain at most two detect requests and the broker accepts at most six globally. A disconnect or client timeout rejects local pending work; a late result is discarded by request ID. Browser/background recreation opens the same cache and prepares a new Worker lazily.

## Packaged runtime

Each artifact contains:

- the dedicated `inference-worker.js` module Worker;
- the tracked ONNX Runtime Web 1.27.0 minimal JavaScript glue;
- `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm`.

The build verifies the glue and WASM SHA-256 values before bundling. The extension transformation disables the generic ORT glue's dynamic runtime-module loader because the extension fixes `numThreads = 1`, `proxy = false`, supplies `wasmBinary` directly and permits no runtime JavaScript fallback. Artifact audit rejects remaining dynamic imports or remote `.js`/`.mjs`/`.wasm` references. Firefox `web-ext lint --warnings-as-errors` must complete with zero warnings.

The `.ort` model remains remote data. The privileged Host fetches only `https://models.ngnl.host/yolo26n-640.ort`, sends the access key only as `Authorization: Bearer`, applies the existing timeout/quota/maximum-size/exact-length/SHA-256 rules, and caches only a verified model.

## Storage and credential boundary

| Data | Storage | Visible to content script |
| --- | --- | --- |
| Model bytes | extension-origin model IndexedDB | No |
| Model access key | separate extension-origin IndexedDB | No |
| Answer mode, fallback, timing and panel settings | `storage.local` | Yes, through an in-memory mirror |
| Per-world answer history | `storage.local` | Yes |

The access key is local browser data, not encryption at rest. It is protected from the page/content boundary but not from a compromised browser profile or malicious extension process. The options page never reads the key into an input or displays it. “Verify and save” downloads and verifies the real model before the Host commits the key; a failed verification does not replace the stored key. A verification may consume one monthly model-download allowance.

Firefox declares required `authenticationInfo` data transmission because the Bearer credential leaves the browser for the Model Worker. Captcha images and inference results are processed locally and are not transmitted to that service.

## Permissions

Both manifests request only:

- `storage`;
- page access to `https://hentaiverse.org/*` and `https://alt.hentaiverse.org/*`;
- model access to `https://models.ngnl.host/*`.

Chromium additionally requests `offscreen`. The content script preserves the userscript exclusions for `battle_stats`, `equip/*` and `isekai/equip/*`. The extension does not request `<all_urls>`, tabs, scripting, cookies, debugger or unlimited storage.

Extension pages use:

```text
script-src 'self' 'wasm-unsafe-eval'; object-src 'self'
```

Executable HTML is external-file-only. There are no inline scripts or remote executable resources.

## Build and inspect

```bash
pnpm --filter @hv-pony-solver/extension typecheck
pnpm --filter @hv-pony-solver/extension test
pnpm --filter @hv-pony-solver/extension build
pnpm --filter @hv-pony-solver/extension lint:firefox
```

The build recreates `apps/extension/dist` and emits:

```text
chromium/
firefox/
hv-pony-solver-chromium-<version>.zip
hv-pony-solver-firefox-<version>.zip
*.zip.sha256
*.artifact.json
```

`build-manifest.json` inside each unpacked directory records every payload file's byte length and SHA-256. The top-level artifact manifest also records the ZIP identity. ZIP entries use stable ordering and a fixed 1980 timestamp; build tests compare two clean outputs byte-for-byte.

Generated `dist` files are ignored and must not be staged as source.

## Local loading

Chrome:

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Choose “Load unpacked”.
4. Select `apps/extension/dist/chromium`.

Edge uses the same directory through `edge://extensions` and developer mode.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose “Load Temporary Add-on”.
3. Select `apps/extension/dist/firefox/manifest.json`.

The toolbar action opens `options.html`; it is not a popup. Save normal settings separately from “Verify and save key.” Refresh already-open game pages when a complete settings reload is desired.

## Validation matrix

| Check | What it establishes | What it does not establish |
| --- | --- | --- |
| `test` / `test:coverage` | Protocol validation, sender and privilege checks, queue bounds, timeout/disconnect/stale response handling, Host key ordering and deterministic artifacts | A browser accepted or executed the extension |
| `lint:firefox` | The generated Firefox package passes the current Mozilla static linter with warnings treated as errors | Firefox actually loaded the add-on |
| `test:e2e:content` | Chromium loads a temporary fixture build and exercises discovery, image transfer, automatic/manual results, one native submit click, history and excluded routes | Real model service, model bytes or ORT runtime |
| `test:e2e:chromium` without `KvKey` | The production Chromium build loads and persists settings | Authenticated model download or inference session |
| `test:e2e:chromium` with `KvKey` | Real authenticated model download, integrity, extension cache, Offscreen Host, packaged Worker and local WASM session initialization | Store signing/publication, Edge loading, Firefox loading, or correct detection on every real captcha |
| `test:e2e:firefox` | Mozilla `web-ext` temporarily installs the production artifact in Playwright Firefox and reloads the add-on | Page fixture behavior, authenticated model inference, signing/publication, or Edge loading |

The live check reads `KvKey` only from the process environment. Do not print it, put it in a command-line argument, commit it, or include it in an artifact. The smoke uses a temporary browser profile and deletes it on exit.

If Edge or Firefox executables are unavailable locally, report Chromium contract compatibility and Firefox lint separately from actual browser-load evidence. `test:e2e:firefox` uses `FIREFOX_EXECUTABLE_PATH` when set and otherwise the installed Playwright Firefox. Do not describe static manifest validation as a successful load.

This extension architecture is not evidence that the separately investigated intermittent submit-time browser crash is fixed. Crash causality still requires reproduction and browser crash diagnostics.
