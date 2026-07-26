# HV Pony Solver

<!-- AUTO-GENERATED:START -->

HV Pony Solver 是一个 pnpm + TypeScript monorepo，用于构建 HentaiVerse 小马验证码 userscript，以及给 userscript 分发 ONNX 模型文件的 Cloudflare Worker 服务。

当前仓库包含三部分：

- `apps/userscript`：浏览器 userscript，使用本地 ONNX Runtime Web 推理验证码图片，并自动选择/提交答案。
- `apps/model-worker`：Cloudflare Worker，从 R2 分发真实模型或 decoy 模型，并用 KV 中的授权 key 控制访问。
- `packages/shared`：跨 userscript 与 Worker 共享的稳定契约，包括答案编码、模型路径常量、访问决策类型和 token 校验。

## 技术栈

| 层级            | 技术                                                 |
| --------------- | ---------------------------------------------------- |
| Monorepo        | pnpm workspace                                       |
| 语言            | TypeScript, ESM                                      |
| 构建            | esbuild, TypeScript `tsc --noEmit`                   |
| 测试            | Vitest, jsdom, `@cloudflare/vitest-pool-workers`     |
| Lint / Format   | ESLint 10, typescript-eslint, Prettier               |
| Userscript 推理 | ONNX Runtime Web 1.26.0, Web Worker, OffscreenCanvas |
| 模型分发        | Cloudflare Workers, KV, R2, Wrangler                 |
| CI/CD           | GitHub Actions                                       |

## 仓库结构

```text
.
├── apps/
│   ├── userscript/          # 生成 hv-pony-solver.user.js 的浏览器脚本
│   └── model-worker/        # Cloudflare Worker 模型分发服务
├── packages/
│   └── shared/              # 跨应用共享的类型与常量
├── scripts/                 # 校验、构建辅助与 CI 检查脚本
├── .github/workflows/       # CI 与 Worker 部署 workflow
├── package.json             # 根命令、Node/pnpm 版本约束
├── pnpm-workspace.yaml      # workspace 包范围
├── tsconfig.base.json       # 共享 TypeScript strict 配置
└── vitest.workspace.ts      # Vitest workspace 配置
```

## 运行机制概览

### Userscript 自动答题流程

1. `apps/userscript/src/main.ts` 在 `DOMContentLoaded` 后创建 `App`，并在页面卸载时销毁资源。
2. `App` 创建状态面板、模型缓存、ONNX Worker 客户端、图片加载器、答案提交器和验证码求解器。
3. `App` 监听 body 变化并合并扫描；仅当 `#riddlemaster` 内存在可用表单和图片，且该图片尚未成功处理时，才懒加载 ONNX 并触发求解。
4. `CaptchaSolver` 使用 `CachedImageLoader` 从浏览器同源缓存读取验证码图片，调用 ONNX Worker 推理。
5. Worker 在后台线程解析 YOLO 输出，按置信度阈值、去重与最大种类数规则生成小马答案结果。
6. `AnswerSubmitter` 清空原有勾选，按随机顺序点击目标复选框，等待模拟延迟后点击提交按钮。
7. `StatusPanel` 展示模型、Session、推理状态，并把最近答题记录写入 `localStorage`。

### Model Worker 模型分发流程

1. Worker 只处理配置的 `PUBLIC_MODEL_PATH`，默认是 `/yolo26n-640.onnx`。
2. 允许 `GET`、`HEAD` 和 `OPTIONS`；其他路径返回 `404`，其他方法返回 `405` 并带 `Allow: GET, HEAD, OPTIONS`。
3. `Authorization: Bearer <token>` 中的 token 必须是 64 位十六进制字符串。
4. 通过 `MODEL_KEYS` KV 查询授权 token：命中则返回真实 R2 模型，否则按 `INVALID_KEY_MODE` 返回 decoy 或 `403`；query string 不授权真实模型。
5. 真实模型对象键默认 `real/yolo26n-640.onnx`，decoy 模型对象键默认 `decoy/yolo26n-640.onnx`。
6. 成功响应使用 `application/octet-stream`，`Content-Disposition: inline; filename="yolo26n-640.onnx"`，`Cache-Control: no-store`。模型响应当前保持 `Cache-Control: no-store`；缓存策略和未来 versioned URL 前置条件见 [docs/model-cache-strategy.md](docs/model-cache-strategy.md)。无 `Origin` 请求允许直接下载；Hentaiverse 白名单 Origin 会被回显；未知 Origin 不授予 CORS。

## 端到端数据流

```text
Hentaiverse 页面验证码
  ↓ DOM MutationObserver 检测 #riddlemaster
userscript App
  ↓ Authorization: Bearer <model access key>
Cloudflare model-worker
  ↓ KV 判断 token 是否授权
R2 real/decoy ONNX 模型
  ↓ IndexedDB 缓存 + SHA-256 校验
浏览器 Web Worker + ONNX Runtime Web
  ↓ YOLO 输出解析为 TS/RA/FS/RD/PP/AJ
AnswerSubmitter 勾选并延迟提交
  ↓
StatusPanel 记录结果、置信度与耗时
```

## 架构与图谱 guardrails

`.graphifyignore` 用于把生成索引、依赖目录和临时产物排除在 Graphify 语料之外；`graphify:check` 会校验这些排除规则，并可用 `node scripts/check-graphify-corpus.mjs --report` 校验重新生成的 `graphify-out/GRAPH_REPORT.md`。

`architecture:check` 固化当前最强的边界结论：推理层不应 import `StatusPanel`，`StatusPanel` 不应 import 推理层，`apps/userscript` 与 `apps/model-worker` 只能通过 `packages/shared` 共享稳定契约，`packages/shared` 不应反向 import 应用代码，推理层不应直接 import userscript storage bridge。`browser-sinks:check` 固化浏览器危险点审计范围：只允许 `StatusPanel` 的已审计 `innerHTML` 渲染点，以及 ONNX worker 入口中加载内置 runtime 所需的 `new Function` / `importScripts`。

推理配置已拆成聚焦导出：`imagePreprocessConfig` 负责输入尺寸，`yoloOutputConfig` 负责 YOLO 解析假设，`onnxRuntimeConfig` 负责运行时资源位置，`inferenceTimeoutConfig` 负责 worker、检测与模型下载超时。

`Model Worker Core` 不应仅因为图谱社区低内聚就拆分；只有源码职责已经自然分离为环境归一化、请求路由、模型访问选择和响应创建时，才应继续拆分。

## 环境要求

| 依赖            | 要求                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| Node.js         | `>=22`                                                                    |
| pnpm            | `10.0.0`，由 `packageManager` 固定                                        |
| Corepack        | 推荐启用，用于获得项目指定 pnpm                                           |
| Cloudflare 资源 | 部署 Worker 时需要 Cloudflare Account、API Token、KV namespace、R2 bucket |

首次安装：

```bash
corepack enable
pnpm install
```

协作流程、分包快速检查命令和 commit 风格见 [CONTRIBUTING.md](CONTRIBUTING.md)。

如果本机没有裸 `pnpm` 命令，也可以使用：

```bash
corepack pnpm install
```

## 命令参考

### 根目录命令

| 命令              | 说明                                                             |
| ----------------- | ---------------------------------------------------------------- |
| `pnpm install`    | 安装所有 workspace 依赖                                          |
| `pnpm lint`       | 对整个仓库运行 ESLint                                            |
| `pnpm typecheck`  | 对所有 workspace 运行 TypeScript 类型检查                        |
| `pnpm test`       | 运行所有 workspace 的 Vitest 测试与 node:test 脚本测试           |
| `pnpm build`      | 运行所有 workspace 的构建检查；userscript 会生成产物             |
| `pnpm docs:check` | 检查 README.md 与 source 关键事实是否发生 drift                 |
| `pnpm graphify:check` | 检查 Graphify 语料排除规则与可选图谱报告                    |
| `pnpm architecture:check` | 检查 userscript、model-worker 与 shared 的架构边界       |
| `pnpm browser-sinks:check` | 检查 userscript 中 `innerHTML`、`new Function` 与 `importScripts` 是否只出现在已审计位置 |
| `pnpm benchmark:inference` | 运行 userscript 推理纯函数本地 micro benchmark |
| `pnpm release:notes` | 根据 shared model manifest 生成模型发布说明 |
| `pnpm test:e2e:userscript` | 运行 userscript Playwright 本地 fixture smoke 测试       |
| `pnpm check:e2e` | 运行当前 E2E gate                                              |
| `pnpm check:userscript` | 依次运行 userscript 的 typecheck、test 与 build |
| `pnpm check:model-worker` | 依次运行 Model Worker 的 typecheck、test 与 build |
| `pnpm check:shared` | 依次运行 shared 包的 typecheck、test 与 build |
| `pnpm check:quick` | 依次运行 lint、typecheck、test、docs:check、graphify:check、architecture:check、browser-sinks:check |
| `pnpm check`      | 先运行 check:quick，再运行 test:coverage 与 build              |
| `pnpm format`     | 用 Prettier 格式化仓库文件                                       |

### Userscript 命令

| 命令                                                                                                   | 说明                                                                                   |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `corepack pnpm --filter @hv-pony-solver/userscript build`                                              | 用 esbuild 打包未压缩 userscript，并写入 `apps/userscript/dist/hv-pony-solver.user.js` |
| `corepack pnpm --filter @hv-pony-solver/userscript build -- --minify`                                  | 用 esbuild 打包压缩 userscript                                                         |
| `pnpm --filter @hv-pony-solver/userscript typecheck`                                                   | 类型检查 userscript 源码                                                               |
| `pnpm --filter @hv-pony-solver/userscript test`                                                        | 运行 userscript Vitest/jsdom 单元测试与 node:test 脚本测试                             |
| `MODEL_FILE=/path/to/yolo26n-640.onnx pnpm --filter @hv-pony-solver/userscript verify-model-integrity` | 校验待发布模型与 shared manifest 的 byteLength / SHA-256 一致性                        |
| `corepack pnpm --filter @hv-pony-solver/userscript verify-onnx-runtime-assets`                         | 校验本地 ONNX Runtime asset manifest 与已安装 `onnxruntime-web` JS runtime / WASM assets 一致性 |
| `corepack pnpm --filter @hv-pony-solver/userscript verify-onnx-runtime-cdn`                            | 发布前手动联网校验 CDN 上的 ONNX Runtime JS runtime / WASM assets 一致性                         |
| `corepack pnpm --filter @hv-pony-solver/userscript benchmark:inference`                               | 运行推理纯函数本地 micro benchmark，输出预处理与 YOLO parser 的 `ms/op`                         |

### Model Worker 命令

| 命令                                                                                                                     | 说明                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `MODEL_KEYS_KV_NAMESPACE_ID=<kv-id> MODEL_BUCKET_NAME=<bucket> pnpm --filter @hv-pony-solver/model-worker render-config` | 从 `wrangler.template.toml` 渲染本地 `wrangler.toml`                         |
| `pnpm --filter @hv-pony-solver/model-worker dev`                                                                         | 渲染 Wrangler 配置后启动 `wrangler dev`                                      |
| `pnpm --filter @hv-pony-solver/model-worker typecheck`                                                                   | 类型检查 Worker 源码                                                         |
| `pnpm --filter @hv-pony-solver/model-worker test`                                                                        | 使用 Cloudflare Vitest pool 运行 Worker 测试                                 |
| `pnpm --filter @hv-pony-solver/model-worker build`                                                                       | 运行 Worker TypeScript 构建检查                                              |
| `pnpm --filter @hv-pony-solver/model-worker run deploy`                                                                  | 渲染配置并部署 Worker；使用 `run deploy` 避免 pnpm 10 内置 `deploy` 命令冲突 |

### Shared 包命令

| 命令                                             | 说明               |
| ------------------------------------------------ | ------------------ |
| `pnpm --filter @hv-pony-solver/shared typecheck` | 类型检查共享契约   |
| `pnpm --filter @hv-pony-solver/shared test`      | 运行共享契约测试   |
| `pnpm --filter @hv-pony-solver/shared build`     | 运行共享包构建检查 |

## Userscript 详细说明

### 构建产物

构建命令：

```bash
corepack pnpm --filter @hv-pony-solver/userscript build
```

默认输出未压缩产物；需要压缩产物时使用 `--minify` 或 `--minify=true`，需要显式关闭时使用 `--minify=false`：

```bash
corepack pnpm --filter @hv-pony-solver/userscript build -- --minify
corepack pnpm --filter @hv-pony-solver/userscript build -- --minify=true
corepack pnpm --filter @hv-pony-solver/userscript build -- --minify=false
```

输出文件：

```text
apps/userscript/dist/hv-pony-solver.user.js
```

发布用构建可通过环境变量额外写出产物校验文件：

| 环境变量                                      | 输出内容                              |
| --------------------------------------------- | ------------------------------------- |
| `HV_PONY_SOLVER_ARTIFACT_SHA256_PATH`         | 最终 `.user.js` 产物的 SHA-256 文本   |
| `HV_PONY_SOLVER_ARTIFACT_MANIFEST_PATH`       | 产物路径、byteLength、SHA-256、压缩状态、runtime 打包状态和 metafile 路径 |
| `HV_PONY_SOLVER_METAFILE_PATH`                | esbuild main / worker metafile JSON   |

手动发布 userscript artifact 时，CI 会使用 `build:bundled-runtime -- --minify`，并同时上传 `.user.js`、`.sha256`、artifact manifest 与 esbuild metafile。

构建脚本会：

1. 以 `apps/userscript/src/main.ts` 为入口。
2. 使用 esbuild 打包为浏览器 IIFE。
3. 从 `src/userscript/metadata.ts` 读取 userscript metadata。
4. 校验 metadata 必须以 `// ==UserScript==` 开始、以 `// ==/UserScript==` 结束。
5. 将 metadata 拼接到 bundle 前面。

### Bundle budget

`apps/userscript/scripts/build-userscript.test.mjs` 会在生成 metafile 时检查 bundle 大小：main bundle 目标小于 80KB，worker bundle 目标小于 20KB。该检查用于防止 userscript 产物无意膨胀。

### ONNX Runtime asset manifest

`apps/userscript/src/inference/onnx-runtime-assets.ts` 中的 `ONNX_RUNTIME_ASSETS` 是 ONNX Runtime Web JS runtime 与 WASM assets 的唯一来源。当前 package 为 `onnxruntime-web@1.26.0`，本地校验目标是已安装依赖中的 `dist/ort.min.js` / `ort.min.js`，以及 `wasmAssets` 中记录的 `dist/ort-wasm-simd-threaded.asyncify.wasm`、`dist/ort-wasm-simd-threaded.jsep.wasm`、`dist/ort-wasm-simd-threaded.jspi.wasm` 和 `dist/ort-wasm-simd-threaded.wasm`；manifest 记录 `scriptAsset.byteLength`、`scriptAsset.sha256`、`scriptAsset.maxByteLength`、`wasmAssets.byteLength` 和 `wasmAssets.sha256`，并通过 `cdn.scriptUrl`、`cdn.wasmPath` 派生 `onnxRuntimeConfig` 的远程资源位置。

发布前可运行本地 asset 校验：

```bash
corepack pnpm --filter @hv-pony-solver/userscript verify-onnx-runtime-assets
```

该命令校验本地安装的 `onnxruntime-web` JS runtime asset 与 WASM assets 是否与 manifest 中 byteLength / SHA-256 一致，不会联网校验 CDN。内置 JS runtime 构建仍通过 `ortWasmPath` 远程加载 WASM。

发布前如需确认 CDN 内容未漂移，可手动运行 release-only 联网校验：

```bash
corepack pnpm --filter @hv-pony-solver/userscript verify-onnx-runtime-cdn
```

`verify-onnx-runtime-cdn` 会联网校验 `cdn.scriptUrl` 指向的 JS runtime，以及由 `cdn.wasmPath` 与 `wasmAssets` 文件名组成的 WASM assets；该命令不接入默认 CI。

推理性能基准用于比较同一台机器上改动前后的纯函数耗时，不作为 CI gate。运行：

```bash
corepack pnpm benchmark:inference
```

输出包含 `copyRgbaToChwFloat32` 与 `parseYoloOutput` 的 `ms/op`；不同机器、负载和 Node.js 版本下的绝对数值不可直接比较。

### Userscript metadata

当前 metadata：

| 字段           | 值                                                                       |
| -------------- | ------------------------------------------------------------------------ |
| `@name`        | `HV-PonySolver-Local`                                                    |
| `@version`     | `3.0.0`                                                                  |
| `@description` | 使用浏览器本地 ONNX Runtime Web 自动识别并答题小马验证码                 |
| `@include`     | `https://hentaiverse.org/*`, `https://alt.hentaiverse.org/*`             |
| `@exclude`     | `battle_stats` 页面和 `equip` 页面                                       |
| `@grant`       | `GM_registerMenuCommand`, `GM_getValue`, `GM_setValue`, `GM_deleteValue` |
| `@run-at`      | `document-end`                                                           |
| `@connect`     | `cdn.jsdelivr.net`, `models.ngnl.host`                                   |

### DOM 选择器

| 用途       | Selector                       |
| ---------- | ------------------------------ |
| 验证码表单 | `form[name="riddleform"]`      |
| 验证码图片 | `#riddleimage img`             |
| 验证码容器 | `#riddlemaster`                |
| 提交按钮   | `#riddlesubmit`                |
| 答案复选框 | `input[name="riddleanswer[]"]` |

### 答案编码

共享包定义了六个答案编码，顺序会被模型 class id 直接索引：

| Class ID | AnswerCode |
| -------- | ---------- |
| `0`      | `TS`       |
| `1`      | `RA`       |
| `2`      | `FS`       |
| `3`      | `RD`       |
| `4`      | `PP`       |
| `5`      | `AJ`       |

### 推理配置

| 配置                                            | 当前值                                                                | 说明                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `imagePreprocessConfig.imageSize`               | `640`                                                                 | 输入图像会 letterbox 到 640x640                              |
| `yoloOutputConfig.confidenceThreshold`          | `0.30`                                                                | YOLO 行置信度阈值                                            |
| `yoloOutputConfig.maxDetections`                | `16`                                                                  | 最多读取 16 个候选框                                         |
| `yoloOutputConfig.maxKinds`                     | `3`                                                                   | 识别到 1 到 3 种不同小马才算成功                             |
| `yoloOutputConfig.rowSize`                      | `6`                                                                   | YOLO 输出每行 float 数                                       |
| `yoloOutputConfig.confidenceIndex`              | `4`                                                                   | YOLO 输出 confidence 列                                      |
| `yoloOutputConfig.classIndex`                   | `5`                                                                   | YOLO 输出 class id 列                                        |
| `onnxRuntimeConfig.ortScriptUrl`                | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js` | 默认构建下 Worker 动态加载 ONNX Runtime Web JS runtime       |
| `onnxRuntimeConfig.ortWasmPath`                 | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/`           | ONNX Runtime Web wasm 资源路径，内置 JS runtime 时仍远程加载 |
| `inferenceTimeoutConfig.workerInitTimeoutMs`    | `60000`                                                               | ONNX Worker 初始化请求超时                                   |
| `inferenceTimeoutConfig.workerDetectTimeoutMs`  | `30000`                                                               | ONNX Worker 单次检测请求超时                                 |
| `inferenceTimeoutConfig.modelDownloadTimeoutMs` | `30000`                                                               | 模型下载超时                                                 |

YOLO 输出解析规则：

- 输出格式假设集中在 `yoloOutputConfig`：每行按 6 个 float 读取，第 5 个值是 confidence，第 6 个值是 class id。
- 图片尺寸由 `imagePreprocessConfig.imageSize` 控制；ONNX runtime URL 由 `onnxRuntimeConfig` 控制；worker 和模型下载超时由 `inferenceTimeoutConfig` 控制。
- data 长度不是完整行倍数时忽略尾部不完整行。
- 忽略非有限 confidence 和无法映射到答案的 class id；浮点 class id 会先按 `Math.trunc()` 截断。
- 优先保留 confidence 大于等于 `0.30` 的行。
- 如果没有任何行过阈值，但存在有效输出行，则回退到最高 confidence 的一行。
- 重复 class 只保留最高 confidence。
- 返回所有去重后的命中答案；检测到超过 3 种时 `success=false`，但不会丢弃第 4 种及后续命中信息。

### 模型下载与缓存

| 配置        | 当前值                                      |
| ----------- | ------------------------------------------- |
| `urlBase`   | `https://models.ngnl.host/yolo26n-640.onnx` |
| `accessKey` | 空字符串                                    |
| `cacheName` | `pony-solver-local`                         |
| `cacheKey`  | `yolo26n-640.onnx`                          |
| `version`   | `yolo26n-640-2026-05-14`                    |

模型加载流程：

1. 先从 IndexedDB `pony-solver-local` 的 `models` object store 读取缓存。
2. 缓存记录必须匹配当前 `version`，且包含 `ArrayBuffer`。
3. 未命中或读取失败时，从 `urlBase` 下载；如果 `accessKey` 非空，下载请求会发送 `Authorization: Bearer <accessKey>`。
4. 下载成功后写回 IndexedDB；写入失败不会阻止本次使用已下载模型。

注意：当前源码默认 `accessKey` 为空。如果要访问真实模型，需要为构建产物提供授权 key。userscript 里的 key 对安装者可见，不应被视作真正保密的服务端密钥。

### 答题与历史记录

| 配置               | 当前值 / 存储键                                                |
| ------------------ | -------------------------------------------------------------- |
| `randomOnFail`     | `false`                                                        |
| 提交前等待时间     | 默认 `3000-5000` ms，可通过 `hvPonySolverSubmitDelay` 设置     |
| 多选点击间隔       | 默认 `1000-1500` ms，可通过 `hvPonySolverMultiClickDelay` 设置 |
| 历史记录 key       | `local_answer_history_v2`                                      |
| 每个世界保留记录数 | `5`                                                            |
| 世界识别           | URL 包含 `/isekai/` 时为异世界，否则为主世界                   |

状态面板显示：模型状态、ONNX Session 状态、推理状态、当前世界和最近答题记录。渲染历史记录时会转义 HTML 敏感字符。

### 默认打包范围

默认 userscript bundle 只包含验证码识别、模型下载/缓存、状态面板、答题记录和必要设置菜单。调试日志开关及其菜单动作不进入默认构建；运行时仍保留警告和错误输出，便于排障。

## Model Worker 详细说明

### Wrangler 配置来源

版本控制中的源文件是：

```text
apps/model-worker/wrangler.template.toml
```

本地生成文件是：

```text
apps/model-worker/wrangler.toml
```

`wrangler.toml` 由 `render-config` 生成，并被 `.gitignore` 忽略。`render-config` 在 `HV_PONY_SOLVER_RENDER_ENV=production` 或 `deploy` 时会拒绝 `test-kv` / `test-bucket` 占位值；未提供 `INVALID_KEY_MODE` 时默认渲染为 `decoy`，提供时只接受 `decoy` 或 `error`。`pnpm --filter @hv-pony-solver/model-worker run deploy` 会自动以 `deploy` 模式渲染配置，并在部署前校验生成的 `wrangler.toml` 不含测试占位值。

当前模板配置：

| 字段                     | 值                               |
| ------------------------ | -------------------------------- |
| Worker name              | `hv-pony-models`                 |
| Entry                    | `src/index.ts`                   |
| compatibility date       | `2026-05-18`                     |
| route                    | `models.ngnl.host` custom domain |
| `PUBLIC_MODEL_PATH`      | `/yolo26n-640.onnx`              |
| `REAL_MODEL_OBJECT_KEY`  | `real/yolo26n-640.onnx`          |
| `DECOY_MODEL_OBJECT_KEY` | `decoy/yolo26n-640.onnx`         |
| `INVALID_KEY_MODE`       | `decoy`                          |
| KV binding               | `MODEL_KEYS`                     |
| R2 binding               | `MODEL_BUCKET`                   |

### 渲染配置所需环境变量

| 变量                         | 必填 | 用途                        | 示例                               |
| ---------------------------- | ---- | --------------------------- | ---------------------------------- |
| `MODEL_KEYS_KV_NAMESPACE_ID` | 是   | 替换 Worker KV namespace id | `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `MODEL_BUCKET_NAME`          | 是   | 替换 Worker R2 bucket 名称  | `hv-pony-models`                   |
| `INVALID_KEY_MODE`           | 否   | 控制无效 token 响应；默认 `decoy`，可选 `decoy` / `error` | `decoy` |

示例：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=<kv-id> MODEL_BUCKET_NAME=<bucket-name> pnpm --filter @hv-pony-solver/model-worker render-config
```

如需临时把无效 token 改为直接返回 `403 Forbidden`，可显式设置：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=<kv-id> MODEL_BUCKET_NAME=<bucket-name> INVALID_KEY_MODE=error pnpm --filter @hv-pony-solver/model-worker render-config
```

### Worker 运行时绑定与变量

| 名称                     | 类型       | 必填 | 说明                                               |
| ------------------------ | ---------- | ---- | -------------------------------------------------- |
| `MODEL_KEYS`             | KV binding | 是   | 授权 token 存储；token 字符串作为 key，值非空即可  |
| `MODEL_BUCKET`           | R2 binding | 是   | 存放真实模型与 decoy 模型                          |
| `PUBLIC_MODEL_PATH`      | var        | 否   | 公开下载路径；缺省使用共享常量 `/yolo26n-640.onnx` |
| `REAL_MODEL_OBJECT_KEY`  | var        | 是   | 真实模型在 R2 中的 object key                      |
| `DECOY_MODEL_OBJECT_KEY` | var        | 是   | decoy 模型在 R2 中的 object key                    |
| `INVALID_KEY_MODE`       | var        | 否   | `decoy` 或 `error`；会归一化大小写与首尾空白，其他值触发配置错误 |

### HTTP 行为

| 场景                                                           | 响应                                         |
| -------------------------------------------------------------- | -------------------------------------------- |
| `GET /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中  | `200` 真实模型，模型响应使用 `Cache-Control: no-store` |
| `HEAD /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中 | `200` 无 body，保留模型 headers                       |
| `OPTIONS /yolo26n-640.onnx`                                    | `204` preflight，`Access-Control-Allow-Methods: GET, HEAD, OPTIONS`，`Access-Control-Allow-Headers: Authorization` |
| 缺少 Bearer token、token 格式错误、KV 未命中，且 `INVALID_KEY_MODE=decoy` | `200` decoy 模型                                      |
| 缺少 Bearer token、token 格式错误、KV 未命中，且 `INVALID_KEY_MODE=error` | `403 Forbidden`                                       |
| 只提供 query string key                                         | 不授权真实模型；按缺少 Bearer token 处理               |
| 非模型路径                                                     | `404 Not Found`                                       |
| 非 `GET` / `HEAD` / `OPTIONS` 方法                              | `405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS` |
| 选中的 R2 object 缺失                                          | `500 Internal Server Error`                           |
| 必填运行时变量缺失                                             | `500 Internal Server Error`                           |

### 授权 key 规则

授权 key 必须匹配：

```text
/^[0-9a-fA-F]{64}$/
```

Worker 通过 `Authorization: Bearer <token>` 读取请求 token，再用 `MODEL_KEYS.get(token)` 判断授权。只要 KV 返回值不是 `null`，就视为授权。测试中使用的 marker 值是 `1`。

### Decoy 模型策略

`INVALID_KEY_MODE=decoy` 时，无效或未授权 key 会收到 decoy R2 对象，而不是 `403`。这个策略用于避免从 HTTP 状态直接暴露 key 是否有效。

userscript 仍会按 `packages/shared/src/model.ts` 中的 `MODEL_INTEGRITY` 校验下载内容。推荐 decoy 对象不要匹配真实模型的 byteLength 与 SHA-256；这样未授权下载即使返回 `200`，也会在 userscript 侧被完整性校验阻断。

如果需要更直接的错误语义，可将 `INVALID_KEY_MODE` 设置为 `error`，此时无效 key 返回 `403 Forbidden`。

## Shared 包契约

`packages/shared` 只包含跨应用共享且稳定的契约：

| 导出                            | 说明                                             |
| ------------------------------- | ------------------------------------------------ |
| `ANSWER_CODES`                  | `['TS', 'RA', 'FS', 'RD', 'PP', 'AJ']`           |
| `AnswerCode`                    | 上述答案编码的联合类型                           |
| `answerCodeForClassId(classId)` | 按 class id 返回对应答案编码                     |
| `MODEL_FILENAME`                | `yolo26n-640.onnx`                               |
| `DEFAULT_PUBLIC_MODEL_PATH`     | `/yolo26n-640.onnx`                              |
| `ModelAccessDecision`           | `'real' \| 'decoy' \| 'forbidden'`             |
| `MODEL_ACCESS_TOKEN_PATTERN`    | 64 位十六进制 token 正则                         |
| `isModelAccessToken(value)`     | token 类型守卫                                   |

应用之间不互相 import；跨应用共享内容应放在 `packages/shared`。

## 测试覆盖

| 范围                    | 测试文件                                                        | 覆盖行为                                                                           |
| ----------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Shared                  | `packages/shared/test/token.test.ts`                            | 64 位十六进制 token 校验                                                           |
| Userscript inference    | `apps/userscript/test/inference/yolo-output-parser.test.ts`     | 阈值过滤、最高置信度回退、重复 class 去重、过多小马种类失败                        |
| Userscript persistence  | `apps/userscript/test/persistence/answer-history-store.test.ts` | localStorage 记录过滤、坏 JSON 兜底、追加记录时剔除非法旧记录                      |
| Userscript utils/config | `apps/userscript/test/utils/utils.test.ts`                      | DOM selector、默认配置、HTML 转义、错误格式化、随机延迟、不可变 shuffle            |
| Model Worker            | `apps/model-worker/test/index.test.ts`                          | 授权真实模型、HEAD、CORS、decoy、`403` error 模式、`404`、`405`、R2 缺失、环境缺失 |

常用验证命令：

```bash
pnpm check
```

或分开执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm docs:check
pnpm graphify:check
pnpm architecture:check
pnpm build
```

Worker 测试依赖渲染后的 `wrangler.toml`。本地测试前可先使用测试值渲染：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv MODEL_BUCKET_NAME=test-bucket pnpm --filter @hv-pony-solver/model-worker render-config
pnpm --filter @hv-pony-solver/model-worker test
```

## CI/CD

### CI workflow

`.github/workflows/verify-monorepo.yml` 会在 `pull_request`、推送到 `main` 和 `workflow_dispatch` 时运行仓库校验；手动触发时可额外选择是否构建内置 ONNX Runtime Web JS runtime 的 userscript、是否运行 userscript Playwright smoke 测试，以及是否发布 artifact。workflow 使用 `actions/setup-node` 的 pnpm cache，并把 guardrails、测试、coverage/build 拆成并行 jobs。

userscript E2E 仅在 `workflow_dispatch` 且 `run_userscript_e2e=true` 时执行；它使用仓库内本地 fixture 页面进行 smoke 验证，不会访问真实 Hentaiverse 站点。

`Security Scan` workflow 使用 CodeQL 扫描 TypeScript/JavaScript，并在 PR 上运行 dependency review；根命令 `pnpm audit:high` 仍在主验证 workflow 的 `guardrails` job 中执行。

1. `validate-inputs` 先检查手动发布 artifact 时是否同时启用 `bundle_onnx_runtime=true`，否则直接失败，避免发布依赖远程 JS runtime 的 userscript artifact。
2. `guardrails` job 设置 Node.js 22、启用 pnpm cache、安装依赖，然后运行 `pnpm audit:high`、`pnpm lint`、`pnpm typecheck`、测试值 Wrangler 配置渲染、`pnpm docs:check`、`pnpm graphify:check`、`pnpm architecture:check` 和 `pnpm browser-sinks:check`。
3. `test` job 并行设置环境、渲染测试 Wrangler 配置并运行 `pnpm test`。
4. `coverage-build` job 并行设置环境、渲染测试 Wrangler 配置并运行 `pnpm test:coverage` 和 `pnpm build`。
5. `userscript-e2e` job 仅在 `workflow_dispatch` 且 `run_userscript_e2e=true` 时运行；它安装 Playwright Chromium 依赖，再运行 `pnpm test:e2e:userscript`。
6. `bundled-userscript` job 依赖 guardrails、test、coverage-build 和可选 E2E 成功后运行；当 `bundle_onnx_runtime=true` 时以 `--minify` 构建内置 ONNX Runtime Web JS runtime 的 userscript，并生成 `.sha256`、artifact manifest 与 esbuild metafile。
7. 如果 `publish_userscript_artifact=true`，`bundled-userscript` job 上传 `apps/userscript/dist/hv-pony-solver.user.js`、`.sha256`、artifact manifest 与 esbuild metafile；默认不上传，且必须同时设置 `bundle_onnx_runtime=true`。

### Model Worker 部署 workflow

`.github/workflows/deploy-cloudflare-model-worker.yml` 默认手动触发，用于按需验证 Model Worker；只有 `publish_model_worker=true` 时才部署，默认不部署。手动触发时可通过 `invalid_key_mode` 选择无效 token 行为，默认 `decoy`，可选 `decoy` 或 `error`。workflow 同样使用 `actions/setup-node` 的 pnpm cache。

验证与部署步骤：

1. Checkout。
2. 设置 Node.js 22。
3. 设置 pnpm。
4. `pnpm install --frozen-lockfile`。
5. 使用 GitHub Secrets 与 `invalid_key_mode` 输入渲染 Wrangler 配置。
6. 类型检查 Worker。
7. 运行 Worker 测试。
8. 如果 Cloudflare secrets 完整，运行 Wrangler dry-run。
9. 如果 `publish_model_worker=true`，执行 `pnpm --filter @hv-pony-solver/model-worker run deploy`；默认跳过部署。

需要配置的 GitHub Secrets：

| Secret                       | 用途                        |
| ---------------------------- | --------------------------- |
| `MODEL_KEYS_KV_NAMESPACE_ID` | 渲染 Worker KV namespace id |
| `MODEL_BUCKET_NAME`          | 渲染 Worker R2 bucket 名称  |
| `CLOUDFLARE_ACCOUNT_ID`      | Wrangler 部署认证           |
| `CLOUDFLARE_API_TOKEN`       | Wrangler 部署认证           |

### Model Worker invalid key 运维

`INVALID_KEY_MODE=decoy` 是默认策略：缺少 Bearer token、token 格式错误或 KV 未命中的请求会收到 decoy 模型，用于降低通过 HTTP 状态探测 key 有效性的信号。`INVALID_KEY_MODE=error` 会返回 `403 Forbidden`，适合异常流量、成本控制或排障时临时启用。

详细操作步骤、Cloudflare rate limit 建议和回滚方式记录在 `docs/model-worker-ops.md`。

## 部署与发布

### 发布 userscript

```bash
corepack pnpm --filter @hv-pony-solver/userscript build
```

如需把 `onnxruntime-web` JS runtime 内置进 userscript，可显式运行：

```bash
corepack pnpm --filter @hv-pony-solver/userscript build:bundled-runtime
```

默认构建不内置 JS runtime；`HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME=1` 或 `build:bundled-runtime` 会先按 `ONNX_RUNTIME_ASSETS.scriptAsset.byteLength` 与 `ONNX_RUNTIME_ASSETS.scriptAsset.sha256` 校验本地 `onnxruntime-web@1.26.0/dist/ort.min.js`，再把 JS runtime 内置进 userscript。两种构建都仍通过 `ortWasmPath` 加载 WASM 资源；发布前应使用 `verify-onnx-runtime-assets` 同时校验本地 JS runtime 与 `wasmAssets`，必要时再用 `verify-onnx-runtime-cdn` 手动联网校验 CDN。`HV_PONY_SOLVER_ONNX_RUNTIME_PATH` 仅用于可信本地调试，不应暴露给 workflow 输入或不可信参数。

将生成的文件安装到 userscript 管理器：

```text
apps/userscript/dist/hv-pony-solver.user.js
```

如果需要访问真实模型，需要确保构建产物中的 `modelConfig.accessKey` 对应 Worker KV 中存在的授权 key。`modelConfig.verifyIntegrity` 默认开启（`true`），会按 `packages/shared/src/model.ts` 中 `MODEL_INTEGRITY.byteLength` 与 `MODEL_INTEGRITY.sha256` 定义的字节长度和 SHA-256 对下载及缓存读取进行严格校验；当远端模型字节内容变更时，必须同步更新 `MODEL_INTEGRITY` 与 `MODEL_VERSION`，否则下载会被阻断。发布前应对待发布 ONNX 文件运行 `MODEL_FILE=/path/to/yolo26n-640.onnx corepack pnpm --filter @hv-pony-solver/userscript verify-model-integrity`，确保本地模型与 shared manifest 一致。

发布前应生成模型发布说明，记录当前 shared manifest 中的版本、byteLength 和 SHA-256：

```bash
corepack pnpm release:notes
```

该命令只读取仓库内 manifest 并输出 Markdown，不上传模型、不访问 Cloudflare，也不会替代发布前的 `verify-model-integrity`。

### 部署 Model Worker

准备 Cloudflare 资源：

1. KV namespace，用于 `MODEL_KEYS`。
2. R2 bucket，用于 `MODEL_BUCKET`。
3. R2 中至少放置：
   - `real/yolo26n-640.onnx`
   - `decoy/yolo26n-640.onnx`
4. KV 中写入允许访问真实模型的 64 位十六进制 token。

本地渲染配置：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=<kv-id> MODEL_BUCKET_NAME=<bucket-name> pnpm --filter @hv-pony-solver/model-worker render-config
```

本地部署：

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```

注意：使用 pnpm 10 时，过滤 workspace 后运行名为 `deploy` 的 package script 必须显式加 `run`，否则可能触发 pnpm 内置 `deploy` 命令。

## 代码风格与约束

- TypeScript 使用 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`isolatedModules`。
- ESLint 禁止 `any`，未使用参数可用 `_` 前缀忽略。
- Prettier 配置为无分号、单引号、trailing comma、`printWidth: 120`。
- 新增 ESLint 规则先以 warning 接入；当 warning 清零并稳定一段时间后再升级为 error。
- `apps/model-worker/wrangler.toml` 是生成文件，不参与 lint。
- userscript `dist`、coverage、node_modules、Wrangler 本地产物均被忽略。

## 常见问题

### `pnpm --filter @hv-pony-solver/model-worker deploy` 报 `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`

这是 pnpm 10 的命令解析冲突：`deploy` 被解析为 pnpm 内置命令，而不是 package script。使用：

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```

### Worker 测试找不到 Wrangler 配置

先渲染 `apps/model-worker/wrangler.toml`：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv MODEL_BUCKET_NAME=test-bucket pnpm --filter @hv-pony-solver/model-worker render-config
```

### userscript 一直拿到 decoy 模型

检查：

1. `modelConfig.accessKey` 是否为空或格式不是 64 位十六进制。
2. Worker KV 中是否存在同名 key。
3. R2 中 `real/yolo26n-640.onnx` 是否存在。
4. Worker 是否部署了最新配置。

### 模型缓存没有刷新

userscript 使用 `modelConfig.version` 判定 IndexedDB 缓存是否有效。模型内容更新后，应同步更新该 version，或手动清理浏览器 IndexedDB。

<!-- AUTO-GENERATED:END -->
