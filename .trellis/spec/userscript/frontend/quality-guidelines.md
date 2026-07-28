# Quality Guidelines

## Required Baseline

Userscript变更必须保持：

- ESLint / strict TypeScript / Prettier；
- Vitest/jsdom unit tests与 node:test script tests；
- coverage thresholds：lines 90%、functions 90%、branches 80%、statements 90%；
- docs drift、architecture boundary、browser sink与bundle budget guards；
- default build；涉及启动/DOM/build artifact时运行 Playwright local fixture E2E。

最小 package gate：

```bash
corepack pnpm check:userscript
```

完整 gate：

```bash
corepack pnpm check
```

## Security / Integrity Boundaries

### Model download

- 使用标准 `fetch` 与 `Authorization: Bearer <key>`；query string Key不授权。
- 不使用 `GM_xmlhttpRequest` / `GM.xmlHttpRequest` 绕过 CORS。
- Candidate Key通过 override验证后才保存；失败不能覆盖现有配置。
- Download/cache read都验证 canonical byteLength与 SHA-256；错误 bytes不能进入 cache或 ONNX session。
- Key不进入 URL、log、DOM/history、fixture、task artifact或聊天。

真实实现/测试：`model-downloader.ts`、`model-integrity.ts`、`model-cache.ts` 及对应 `test/model/`。

### ONNX Runtime assets

- `onnx-runtime-assets.ts` 是 CDN script/WASM URL、byteLength、SHA-256 的 canonical source。
- Default build不内置 JS runtime；bundled-runtime build先验证本地 installed asset再内置 JS，WASM仍从 canonical path加载。
- Worker init message不携带 script URL；remote `importScripts` 只读 canonical config。
- `verify-onnx-runtime-assets` 是默认可离线 release guard；`verify-onnx-runtime-cdn` 会联网，只手动用于 release，不接默认 CI。
- 禁止关闭 asset integrity或允许 caller提供任意 HTTPS script URL。

### Browser sinks

`scripts/check-browser-sinks.mjs` 审计 Userscript source：

- `innerHTML` 只允许 status panel controller的一个 sink，dynamic values先 `escapeHtml`。
- `new Function` / `importScripts` 只允许 audited Worker entry paths。
- 新 sink不得仅通过增加 allowlist计数放行；先证明 trust/data-flow、补测试，再更新 guard。

```bash
corepack pnpm browser-sinks:check
```

### Answer mode interaction boundary

- `hvPonySolverAnswerMode` 只接受 `auto` / `manual`；缺失、非法或读取失败默认 `auto`。
- `manual` 继续图片获取和 ONNX 推理，但 solver必须从结构上绕过 `AnswerSubmitter`，不得修改 checkbox 或点击 submit。
- `manual` 成功结果以 typed history record显示“待手动提交”，并按 captcha key去重；动态答案继续经过 renderer HTML转义。
- 修改模式策略时同时测试配置持久化、自动模式回归、手动模式零 click、abort和同 captcha去重。

## Unit / Script Test Strategy

- DOM/controller/storage/network behavior：Vitest + jsdom + injected adapters/mocks。
- Pure inference：直接测试 preprocess/layout/YOLO parser的数值与边界。
- Worker client/entry：mock Worker globals，覆盖 remote/bundled init、message shape、timeouts、abort、stale worker、transferables、load/session failures。
- Build/asset/model verification scripts：Node `node:test` + temp dirs/injected fetch；默认 tests不访问公网。
- 所有 async lifecycle change覆盖 success、base、failure、destroy/abort/retry/cleanup。

不要只测试 happy path；至少包含 empty/missing/invalid/boundary与 owner teardown。

## Architecture Guard

`scripts/check-architecture-boundaries.mjs` 保持：

- inference layer不依赖 status panel implementation；通过 status ports通信。
- status panel不依赖 inference。
- inference不直接导入 GM storage bridge。
- Userscript与Model Worker不相互 import；Shared不反向 import apps。

当前 guard跳过 type-only import，review仍要人工检查 type dependency leak。

```bash
corepack pnpm architecture:check
```

## Bundle Budget Contract

### Profiles

| Profile   | Build contract                 |  Budget | Artifact                                      |
| --------- | ------------------------------ | ------: | --------------------------------------------- |
| `default` | 未压缩、不内置 ONNX Runtime JS |  96 KiB | `apps/userscript/dist/hv-pony-solver.user.js` |
| `bundled` | `--minify` + bundled-runtime   | 480 KiB | 同一 artifact path                            |

Commands：

```bash
pnpm bundle:check
pnpm bundle:check:default
pnpm bundle:check:bundled
node scripts/check-bundle-budget.mjs --profile <default|bundled> [--file <path>] [--repo-root <path>]
```

- `bundle:check` 显式构建 default后检查。
- `bundle:check:default` / `:bundled` 是 pure checker，不隐式 build。
- CI `coverage-build` 在 default build后用 default profile；`bundled-userscript` 在 minified bundled build后用 bundled profile。
- Success/failure输出 profile、actual、budget、delta、absolute file。
- Unknown profile（包括 `__proto__`）、缺 flag value、missing/non-file artifact、unsafe integers、over-budget全部非零失败。
- `actual === budget` 允许通过。

Forbidden：bundled artifact误用 default profile；default artifact只用宽松 bundled预算；pure checker偷偷 build；missing artifact静默 skip。

## E2E CI Contract

`apps/userscript/test/e2e/` 使用本地 fixture，不访问真实 Hentaiverse。

```bash
corepack pnpm test:e2e:userscript
```

`.github/workflows/verify-monorepo.yml#userscript-e2e`：

- `pull_request` 与 push to `main` 常态运行。
- `workflow_dispatch` 仅在 `run_userscript_e2e=true` 时运行。
- 严格解析 `playwright --version` 的单行 `Version <semver>`；无效 output直接失败。
- Cache path `~/.cache/ms-playwright`，key包含 runner OS、`chromium`、实际 Playwright version。
- Cache hit后仍运行 `playwright install --with-deps chromium`，保证 Ubuntu system dependencies。
- `bundled-userscript` 只在 dispatch：input=false接受 E2E skipped，input=true只接受 E2E success；failure不得发布 artifact。
- 不使用 `continue-on-error` 放过 E2E。

## Build / Release Gates

Default build：

```bash
corepack pnpm --filter @hv-pony-solver/userscript build
corepack pnpm bundle:check:default
```

Bundled release build：

```bash
corepack pnpm --filter @hv-pony-solver/userscript build:bundled-runtime -- --minify
corepack pnpm bundle:check:bundled
```

Model artifact发布前：

```bash
MODEL_FILE=/path/to/yolo26n-640.onnx \
corepack pnpm --filter @hv-pony-solver/userscript verify-model-integrity
corepack pnpm release:notes
```

`release:notes` 只读 repository manifest，不上传模型、不访问 Cloudflare，也不替代 artifact integrity verification。

## Forbidden / Common Mistakes

- 修改 source但只运行 typecheck，不跑 behavior/coverage/build guard。
- 默认 tests或E2E访问公网/真实 Hentaiverse/Cloudflare。
- 测试 fixture包含真实 Key、credential、生产 resource ID或 model body。
- 关闭 integrity、CORS或browser sink guard来让失败“通过”。
- 在 async test中遗漏 cleanup，留下 timer/observer/Worker/IndexedDB state。
- 硬编码当前 bundle实际字节数作为预算；预算是固定上限，actual会变化。
- 依赖 Playwright cache而不执行 browser/system dependency install。
- 修改 Worker protocol或runtime asset后只测 client或只测 entry。

## Code Review Checklist

- [ ] 变更位于正确 feature/lifecycle owner，dependency direction未破坏？
- [ ] External DOM/storage/network/Worker data均 runtime narrowed？
- [ ] Key/Bearer/CORS与 model/runtime integrity边界未削弱？
- [ ] Browser sink data flow受审计，未简单扩 allowlist？
- [ ] Success/base/failure/abort/destroy/cache-corrupt branches有测试？
- [ ] Coverage threshold、docs、architecture、browser sink、build与bundle gate通过？
- [ ] 涉及启动/DOM/build artifact时 E2E通过？
- [ ] 无 secret、generated dist、coverage、`.tmp` 或 model artifact进入提交？
