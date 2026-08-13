# Browser extension edition

## Scope

`apps/extension` builds two model-delivery products for each desktop target:

| Artifact | Browsers | Minimum | Model delivery |
| --- | --- | --- | --- |
| Chromium MV3 | Chrome and Edge | Chromium 116 | `remote` or `packaged` |
| Firefox MV3 | Firefox Desktop | Firefox 142 | `remote` or `packaged` |

Safari, mobile browsers, Manifest V2, store signing, listing assets and publication are outside this build. The userscript remains independently buildable. Do not enable both editions in one browser profile: they observe the same captcha DOM and could submit the same form.

## Build modes

The mode is a build-time choice, never runtime detection or fallback:

| Mode | Command | Model source | Key |
| --- | --- | --- | --- |
| `remote` (default) | `pnpm --filter @hv-pony-solver/extension build` | `https://models.ngnl.host/yolo26n-640.ort` | Required for the real model |
| `packaged` | `pnpm --filter @hv-pony-solver/extension build:packaged` | private `model/yolo26n-640.ort` | Not used |

The direct CLI form is `node scripts/build-extension.mjs --model-mode remote|packaged`. Production packaged builds accept no model-path or integrity override. Before replacing `apps/extension/dist`, the builder requires the fixed input to be a regular non-symlink file with exactly 9,914,448 bytes and the canonical SHA-256 from `@hv-pony-solver/shared/ort-model`.

## Runtime architecture

The page-facing content script is identical in both modes. It owns bounded DOM observation, same-origin image loading, status/history rendering, answer clicks and the native submit-button click.

```text
Hentaiverse content script
  |  bounded JSON-safe Base64 captcha request
  v
named runtime Port -> sender-validating broker
  | Chromium                          | Firefox
  v                                   v
MV3 service worker              MV3 background script
  v                                   |
Offscreen Document                   |
  +---------------- Host <------------+
                       |
                       | one transferred model ArrayBuffer
                       v
              inference-worker.js + packaged ORT glue/WASM
```

The Base64 representation is retained only for captcha images crossing WebExtension JSON messaging. Firefox isolated worlds may reject `Blob.arrayBuffer()`, so the content script uses `FileReader.readAsDataURL()` and extracts the payload. Images are allowlisted by MIME type and bounded to 2 MiB.

Model bytes do not use Base64 or chunks. The privileged Host verifies one binary model and `OnnxWorkerClient` transfers its `ArrayBuffer` once in the Worker `init` message. The Worker creates a WASM Execution Provider session and serializes inference.

The broker validates extension ID, Hentaiverse/options origins, exact protocol shape, and request IDs. A content Port may retain at most two detect requests and the broker accepts at most six globally. Chromium's service worker stays stateless and creates one Offscreen Host. Firefox owns the same mode-specific Host directly; its MV3 manifest deliberately omits the unsupported `background.persistent` field.

## Model and runtime ownership

Every artifact contains:

- `inference-worker.js`;
- tracked ONNX Runtime Web 1.27.0 minimal JavaScript glue;
- `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm`.

Build-time and runtime checks pin the glue/WASM identities. Dynamic imports and remote executable `.js`, `.mjs`, or `.wasm` references fail the package audit.

Remote mode constructs model download, model IndexedDB cache, secret IndexedDB and Key-verification capabilities. It sends a Key only as `Authorization: Bearer`, enforces the existing timeout/quota/length/SHA-256 rules and caches only verified bytes.

Packaged mode constructs none of those remote capabilities. It fetches the private extension URL `model/yolo26n-640.ort` with `cache: force-cache` and `redirect: error`, then validates HTTP status, decimal safe `Content-Length`, bounded streamed length, exact final length and SHA-256. The model is not a Web Accessible Resource, and corrupt package data never falls back to the model service.

## Storage and options

| Data | Remote mode | Packaged mode | Visible to content |
| --- | --- | --- | --- |
| Model bytes | model IndexedDB | private package asset | No |
| Model access Key | secret IndexedDB | not read or changed | No |
| Ordinary settings/history | `storage.local` | `storage.local` | Through an in-memory mirror |

The remote options page enables the initially disabled Key fieldset after its handlers exist. It never echoes the stored Key. “Verify and save” downloads and validates a model before committing the Key and may consume a monthly allowance.

The packaged entry does not open Key storage or a Key Port. Its Key controls remain disabled and it shows exactly:

```text
当前版本已内置模型，无需配置模型 Key。
```

Ordinary settings remain editable. An existing remote-build Key is neither read nor deleted.

## Permission matrix

| Target/mode | API permissions | Host permissions | Firefox data collection |
| --- | --- | --- | --- |
| Chromium remote | `storage`, `offscreen` | Hentaiverse + model host | N/A |
| Chromium packaged | `storage`, `offscreen` | Hentaiverse only | N/A |
| Firefox remote | `storage` | Hentaiverse + model host | `authenticationInfo` |
| Firefox packaged | `storage` | Hentaiverse only | `none` |

No mode requests `<all_urls>`, tabs, scripting, cookies, debugger or unlimited storage. No mode exposes the model through `web_accessible_resources`. Extension pages use `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`, external script files only, and no remote executable resources.

## Build outputs and local loading

Remote names remain backward compatible; packaged names are distinct:

```text
apps/extension/dist/chromium/
apps/extension/dist/firefox/
hv-pony-solver-chromium-<version>.zip
hv-pony-solver-firefox-<version>.zip
hv-pony-solver-chromium-packaged-<version>.zip
hv-pony-solver-firefox-packaged-<version>.zip
*.zip.sha256
*.artifact.json
```

Every unpacked target contains a `build-manifest.json` with `modelDelivery` and per-file identities. Packaged metadata additionally records the canonical model identity. ZIP ordering and timestamps are deterministic. Generated `dist` files and the local model source are ignored and must not be staged.

Load `apps/extension/dist/chromium` through Chrome's `chrome://extensions` or Edge's `edge://extensions` developer mode. For Firefox, use `about:debugging#/runtime/this-firefox` and select `apps/extension/dist/firefox/manifest.json`. The toolbar action opens `options.html`; it is not a popup.

## Validation matrix

```bash
pnpm --filter @hv-pony-solver/extension typecheck
pnpm --filter @hv-pony-solver/extension test
pnpm --filter @hv-pony-solver/extension build
pnpm --filter @hv-pony-solver/extension build:packaged
pnpm --filter @hv-pony-solver/extension lint:firefox
pnpm --filter @hv-pony-solver/extension test:e2e:content
pnpm --filter @hv-pony-solver/extension test:e2e:chromium
pnpm --filter @hv-pony-solver/extension test:e2e:firefox
pnpm --filter @hv-pony-solver/extension test:e2e:packaged
```

| Check | Establishes | Does not establish |
| --- | --- | --- |
| Unit/build tests | Protocol, policy, lifecycle, asset integrity, graph isolation, permission matrix and deterministic artifacts | A browser executed the extension |
| `lint:firefox` | Generated Firefox remote or packaged directory passes current Mozilla static lint | Browser execution or AMO acceptance |
| `test:e2e:content` | Deterministic Chromium page behavior and one native submit | Real model or ORT session |
| `test:e2e:chromium` without/with `KvKey` | Production remote load/settings; with Key, authenticated model/cache/Offscreen/ORT initialization | Packaged model or store publication |
| `test:e2e:firefox` | Production remote directory installs and reloads | Authenticated inference |
| `test:e2e:packaged:chromium` | Unpacked packaged artifact loads private model/WASM, infers without Key, tears down and reinitializes | Edge/store acceptance |
| `test:e2e:packaged:firefox` | Actual packaged ZIP installs through standard WebDriver, infers without Key, ends the session and succeeds in a fresh session | AMO signing/publication |

The Firefox packaged gate requires `geckodriver` (or `GECKODRIVER_PATH`) and `openssl`; it creates and deletes its own temporary certificate, proxy and browser sessions. Live remote checks read `KvKey` only from the process environment. Never print it, pass it as a command-line argument, commit it, or include it in an artifact.

This architecture does not prove the separately investigated intermittent submit-time browser crash is fixed. Crash causality still requires reproduction and browser crash diagnostics.
