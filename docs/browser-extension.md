# Browser extension edition

## Scope

The current extension release version is `0.1.1`, sourced only from `apps/extension/package.json`. Both manifests, `build-manifest.json`, artifact metadata, ZIP names and the optional GitHub Release tag are derived from that value; root and internal workspace versions are unrelated.

`apps/extension` builds two model-delivery products for Chromium and Firefox:

| Artifact     | Browsers            | Minimum             | Model delivery         | Automated gate                                |
| ------------ | ------------------- | ------------------- | ---------------------- | --------------------------------------------- |
| Chromium MV3 | Chrome and Edge     | Chromium 116        | `remote` or `packaged` | Exact Chromium 116 desktop execution          |
| Firefox MV3  | Firefox Desktop     | Firefox 140         | `remote` or `packaged` | Exact Firefox 140 desktop execution           |
| Firefox MV3  | Firefox for Android | Firefox Android 142 | `remote` or `packaged` | External Android evidence required at release |

Safari, other mobile browsers, Manifest V2, store signing and listing assets are outside this build. Current GitHub-hosted runners do **not** automate Firefox Android: a current desktop Firefox result, even one newer than 142, is not Android coverage. Publication therefore fails closed unless external Firefox Android 142 evidence for the exact Firefox ZIP is supplied. The userscript remains independently buildable. Do not enable both editions in one browser profile: they observe the same captcha DOM and could submit the same form.

## Build modes

The mode is a build-time choice, never runtime detection or fallback:

| Mode               | Command                                                  | Model source                               | Key                         |
| ------------------ | -------------------------------------------------------- | ------------------------------------------ | --------------------------- |
| `remote` (default) | `pnpm --filter @hv-pony-solver/extension build`          | `https://models.ngnl.host/yolo26n-640.ort` | Required for the real model |
| `packaged`         | `pnpm --filter @hv-pony-solver/extension build:packaged` | bundled `model/yolo26n-640.ort`            | Not used                    |

The direct CLI form is `node scripts/build-extension.mjs --model-mode remote|packaged`. Production packaged builds accept no model-path or integrity override. Before replacing `apps/extension/dist`, the builder requires the fixed input to be a regular non-symlink file with exactly 9,914,448 bytes and the canonical SHA-256 from `@hv-pony-solver/shared/ort-model`. The archive provides integrity checks, not encryption or confidentiality; installed package contents can be inspected.

## Runtime architecture

The page-facing content script is identical in both modes. It owns bounded DOM observation, same-origin image loading, status/history rendering, answer clicks and the native submit-button click. Once answer history exists, it also prefetches the inference session at page load, so the first captcha of a browsing session does not pay the cold-start cost; fresh installs stay lazy and never spend a monthly download slot before their first captcha.

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

The broker validates extension ID, Hentaiverse/options origins, exact protocol shape, and request IDs. A content Port may retain at most two detect and two concurrent prepare requests; the broker accepts at most six detect and four prepare requests globally. These global counters live in the background context, so an MV3 service-worker restart resets them — they bound load per background generation, not per browser session. A content client can also send a request-scoped `cancel`, which aborts exactly one queued or running request and frees its capacity without disturbing sibling requests on the same Port. The Host pushes one-way `status` notifications (model and session stages) through the broker to every connected content Port — relayed from the Offscreen document through the service worker on Chromium — while the content client keeps inference-row reporting with full round-trip timing. Chromium's service worker stays stateless and creates one Offscreen Host; every service-worker start schedules an idle reconciliation, so a restart that abandoned an in-flight retention lease cannot strand the Offscreen document and its warm session. Firefox owns the same mode-specific Host directly; its MV3 manifest deliberately omits the unsupported `background.persistent` field.

## Model and runtime ownership

Every artifact contains:

- `inference-worker.js`;
- tracked ONNX Runtime Web 1.27.0 minimal JavaScript glue;
- `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm`.

Build-time and runtime checks pin the glue/WASM identities. Dynamic imports and remote executable `.js`, `.mjs`, or `.wasm` references fail the package audit.

Remote mode constructs model download, model IndexedDB cache, secret IndexedDB and Key-verification capabilities. It sends a Key only as `Authorization: Bearer`, enforces the existing timeout/quota/length/SHA-256 rules and caches only verified bytes.

Packaged mode constructs none of those remote capabilities. It fetches the extension-internal URL `model/yolo26n-640.ort` with `cache: force-cache` and `redirect: error`, then validates HTTP status, decimal safe `Content-Length`, bounded streamed length, exact final length and SHA-256. The model is not a Web Accessible Resource, but it remains inspectable in the installed archive; corrupt package data never falls back to the model service.

## Storage and options

| Data                      | Remote mode      | Packaged mode         | Visible to content          |
| ------------------------- | ---------------- | --------------------- | --------------------------- |
| Model bytes               | model IndexedDB  | bundled package asset | No                          |
| Model access Key          | secret IndexedDB | not read or changed   | No                          |
| Ordinary settings/history | `storage.local`  | `storage.local`       | Through an in-memory mirror |

The remote options page enables the initially disabled Key fieldset after its handlers exist. It never echoes the stored Key. “Verify and save” settles Key validity with an unmetered HEAD probe and persists the Key without spending a monthly download. “Query download count” reads the saved Key's current monthly status without spending a download; when enforcement is disabled it reports `无次数限制（模型下载次数限制未开启）`. “Download model” uses the saved Key to download, verify and cache the model; if a valid local cache already exists, it reports the cache hit without spending another download. A real-model GET only reserves a ten-minute receipt. The Host confirms that receipt with `POST /quota` after byte-length/SHA-256 verification and a completed model IndexedDB transaction, so an interrupted or uncached response is not counted. A hanging Key, quota, or model operation can be cancelled from the page, which aborts the in-flight request on both sides.

The options transport preserves user-diagnostic errors from the Host instead of replacing every failure with a generic disconnect. A quota query alone retries one transient background Port disconnect after a bounded delay; if the second attempt fails, the actual browser/Host message is shown. Key verification and model download are not automatically replayed because doing so could duplicate a state-changing operation.

The packaged entry does not open Key storage or a Key Port. Its Key controls remain disabled and it shows exactly:

```text
当前版本已内置模型，无需配置模型 Key。
```

Ordinary settings remain editable. An existing remote-build Key is neither read nor deleted.

## Answer selection and panel behavior

`auto` is the default answer mode. It checks answers and clicks the page's native submit control after the configured delays. `manual` still runs inference and records the detected answers, but it neither changes checkboxes nor submits. Random selection after an empty detection is enabled by default and can be disabled.

“Preserve checked answers” is enabled by default. User and automatic checkbox changes are tracked separately:

- a manual checkbox is never unchecked by the extension;
- previous automatic selections may be merged with the new detection;
- when the combined count is at most four, no trimming occurs;
- when it exceeds four, only automatic selections are removed from lowest confidence upward, targeting at most three total answers;
- if manual answers alone exceed that target, they all remain;
- disabling preservation clears the current checked state before the automatic result is applied.

Before and between clicks, the content script revalidates the exact form, six checkboxes, submit control, DOM connection and disabled state captured for the current captcha. Initial failures are reported distinctly: an unexpected checkbox count, a missing submit control, unusable answer controls, or a disabled final submit control. If the page replaces the captcha or any captured control while delays are running, the stale task is cancelled without clicking the replacement. Failures for the same unchanged captcha target are suppressed for 30 seconds, so rapid MutationObserver activity does not add another record during the cooldown; a changed target, credential recovery or expiry of that cooldown permits a fresh attempt. Persisted history is independently capped at 50 records.

The default panel position is `top=155, left=1240`. By default the panel is visible only while a `div#csp` exists; this requirement can be disabled. Hiding the panel does not stop observation or inference. The default visible history count is five and the accepted range is 1–50.

## Permission matrix

| Target/mode       | API permissions        | Host permissions         | Firefox data collection |
| ----------------- | ---------------------- | ------------------------ | ----------------------- |
| Chromium remote   | `storage`, `offscreen` | Hentaiverse + model host | N/A                     |
| Chromium packaged | `storage`, `offscreen` | Hentaiverse only         | N/A                     |
| Firefox remote    | `storage`              | Hentaiverse + model host | `authenticationInfo`    |
| Firefox packaged  | `storage`              | Hentaiverse only         | `none`                  |

No mode requests `<all_urls>`, tabs, scripting, cookies, debugger or unlimited storage. No mode exposes the model through `web_accessible_resources`. Extension pages use `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'`, external script files only, and no remote executable resources.

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

For the current release these placeholders resolve to `hv-pony-solver-chromium-0.1.1.zip`, `hv-pony-solver-firefox-0.1.1.zip`, `hv-pony-solver-chromium-packaged-0.1.1.zip` and `hv-pony-solver-firefox-packaged-0.1.1.zip`.

Every unpacked target contains a `build-manifest.json` with `modelDelivery` and per-file identities. Packaged metadata additionally records the canonical model identity. The deterministic test fixture records its committed `expected.classId` and `expected.confidence` oracle in both build and artifact metadata; smoke evidence must match that oracle. ZIP ordering and timestamps are deterministic. Generated `dist` files and the local model source are ignored and must not be staged.

Load `apps/extension/dist/chromium` through Chrome's `chrome://extensions` or Edge's `edge://extensions` developer mode. For Firefox, use `about:debugging#/runtime/this-firefox` and select `apps/extension/dist/firefox/manifest.json`. The toolbar action opens `options.html`; it is not a popup.

## Validation and release evidence

```bash
pnpm --filter @hv-pony-solver/extension typecheck
pnpm --filter @hv-pony-solver/extension test
pnpm --filter @hv-pony-solver/extension build
pnpm --filter @hv-pony-solver/extension build:packaged
pnpm --filter @hv-pony-solver/extension test:e2e:content
pnpm --filter @hv-pony-solver/extension test:e2e:chromium:load-only
KvKey='<protected secret>' pnpm --filter @hv-pony-solver/extension test:e2e:chromium:authenticated
pnpm --filter @hv-pony-solver/extension test:e2e:firefox:load-only
pnpm --filter @hv-pony-solver/extension test:e2e:packaged
```

| Check                             | Establishes                                                                                                                                                                      | Does not establish                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Unit/build tests                  | Protocol, policy, lifecycle, asset integrity, graph isolation, permission matrix and deterministic artifacts                                                                     | A browser executed the extension                      |
| `test:e2e:content`                | Deterministic Chromium page behavior and one native submit                                                                                                                       | Real model or ORT session                             |
| `test:e2e:chromium:load-only`     | Production remote extension loads and ordinary settings persist                                                                                                                  | Authenticated model download, `prepare`, or inference |
| `test:e2e:chromium:authenticated` | A protected Key downloads and verifies the production model and then executes at least one `detect` with random fallback disabled                                                | Packaged model or store publication                   |
| `test:e2e:firefox:load-only`      | Production remote ZIP installs and exposes the current Key/download/quota and ordinary settings controls                                                                         | Authenticated model download or inference             |
| `test:e2e:packaged:chromium`      | The actual release ZIP is hashed, checked against artifact/build metadata, extracted to a temporary tree, loaded, and successfully inferred twice without Key or random fallback | Edge/store acceptance                                 |
| `test:e2e:packaged:firefox`       | The verified release ZIP installs through standard WebDriver and successfully infers in two fresh sessions without Key or random fallback                                        | AMO signing or Firefox Android execution              |

Packaged fixture evidence is schema 2 and binds the exact archive name, length, SHA-256, verified tree hash, model identity, browser version, result type, checkbox index and displayed confidence. Both packaged smokes write only successful, confidence-bearing observations and reject `识别失败，随机选择`; fixture results must exactly match the committed oracle. Chromium never substitutes `dist/chromium` for the tested archive: it loads only the temporary tree extracted from that ZIP. Firefox continues to install the ZIP itself.

`REQUIRE_EXACT_MINIMUM_BROWSER=true` changes the packaged smoke from a normal “supported version or newer” check into an exact-major execution gate. CI obtains and executes Chromium 116 and Firefox Desktop 140 separately. A run on the current browser cannot satisfy this job. Chromium 116 uses its headed extension implementation under Xvfb (`PACKAGED_E2E_HEADLESS=false`); the variable accepts only `true` or `false`, so a misspelled setting fails closed. The Firefox packaged gate requires `geckodriver` (or `GECKODRIVER_PATH`) and `openssl`; it creates and deletes its own temporary certificate, proxy and browser sessions. CI pins geckodriver `0.37.1` and its archive SHA-256. Its installer uses one 60-second deadline and at most three attempts, retrying only network failures and HTTP `408`, `429`, or `5xx`; permanent HTTP, archive, hash, path and extracted-version failures remain fail-closed.

The ordinary production job is deliberately named **load-only**. It never reads `KvKey` and explicitly reports that remote inference was not tested. Its Firefox leg installs the generated ZIP, opens `options.html`, waits for storage initialization, and verifies the current remote-only and ordinary controls. The protected `production-model-smoke` CI environment supplies the `KV_KEY` secret to the authenticated job. Missing or blank secret material skips authenticated verification and keeps extension publication disabled; successful Key verification alone is insufficient because the job must settle a real `detect` request. When `PACKAGED_MODEL_URL` is absent, the canonical packaged-model gate is likewise skipped and packaged artifact publication remains disabled. Never print the Key, pass it as a command-line argument, commit it, or include it in evidence.

### Firefox Android 142 external release gate

GitHub-hosted runners currently provide no supported Firefox Android WebExtension automation, so CI does not claim that coverage. An independent Android harness must install the canonical Firefox ZIP in Firefox Android major 142, disable random fallback, execute at least one successful inference, and upload an artifact named `hv-pony-solver-firefox-android-142-evidence` containing `firefox-android-142-evidence.json`. The record uses `kind: "firefox-android-142-packaged-e2e"`, identifies the device and Android version, records browser version 142, canonical model identity, exact Firefox archive name/length/SHA-256, and successful inference observation(s).

For canonical packaged artifact publication, dispatch `Repository CI` with `publish_extension_artifact=true` and set `firefox_android_e2e_run_id` to the completed external run. The release gate downloads only a successful run's named evidence artifact and compares all archive identity fields with the freshly built Firefox release ZIP. Missing evidence, a newer desktop/Android version, random fallback, failed/non-success results, or any archive mismatch blocks publication. Desktop Chromium/Firefox evidence, exact-minimum desktop jobs, authenticated remote inference, and Android evidence are independent mandatory gates.

### GitHub desktop Release

Dispatch `Repository CI` from `main` with `publish_extension_release=true` to create `extension-v<version>`; for the current package this is `extension-v0.1.1`. The Release contains the remote-model Chromium and Firefox ZIPs, checksum sidecars and artifact metadata generated from the extension package version. The input defaults to false. The job refuses non-`main` refs and existing tags, validates both archives against their metadata, and has `contents: write` only in the final publication job. It requires the repository, extension, packaged-fixture, exact desktop minimum-version and protected authenticated remote-model gates to pass. This GitHub Release is a desktop sideload distribution; it is not Chrome Web Store/AMO publication and makes no Firefox Android execution claim. Normal pushes and pull requests never create this Release.
