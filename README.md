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
| Lint / Format   | ESLint 9, typescript-eslint, Prettier                |
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
├── docs/                    # 架构、部署、应用说明
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
2. 只允许 `GET` 和 `HEAD`；其他路径返回 `404`，其他方法返回 `405` 并带 `Allow: GET, HEAD`。
3. `key` query 参数必须是 64 位十六进制字符串。
4. 通过 `MODEL_KEYS` KV 查询授权 key：存在则返回真实 R2 模型，否则按 `INVALID_KEY_MODE` 返回 decoy 或 `403`。
5. 真实模型对象键默认 `real/yolo26n-640.onnx`，decoy 模型对象键默认 `decoy/yolo26n-640.onnx`。
6. 成功响应使用 `application/octet-stream`，`Content-Disposition: inline; filename="yolo26n-640.onnx"`，`Cache-Control: public, max-age=86400`。无 `Origin` 请求允许直接下载；Hentaiverse 白名单 Origin 会被回显；未知 Origin 不授予 CORS。

## 端到端数据流

```text
Hentaiverse 页面验证码
  ↓ DOM MutationObserver 检测 #riddlemaster
userscript App
  ↓ ?key=<model access key>
Cloudflare model-worker
  ↓ KV 判断 key 是否授权
R2 real/decoy ONNX 模型
  ↓ IndexedDB 缓存 + SHA-256 校验
浏览器 Web Worker + ONNX Runtime Web
  ↓ YOLO 输出解析为 TS/RA/FS/RD/PP/AJ
AnswerSubmitter 勾选并延迟提交
  ↓
StatusPanel 记录结果、置信度与耗时
```

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

如果本机没有裸 `pnpm` 命令，也可以使用：

```bash
corepack pnpm install
```

## 命令参考

### 根目录命令

| 命令             | 说明                                                 |
| ---------------- | ---------------------------------------------------- |
| `pnpm install`   | 安装所有 workspace 依赖                              |
| `pnpm lint`      | 对整个仓库运行 ESLint                                |
| `pnpm typecheck` | 对所有 workspace 运行 TypeScript 类型检查            |
| `pnpm test`      | 运行所有 workspace 的 Vitest 测试                    |
| `pnpm build`     | 运行所有 workspace 的构建检查；userscript 会生成产物 |
| `pnpm check`     | 依次运行 lint、typecheck、test、build                |
| `pnpm format`    | 用 Prettier 格式化仓库文件                           |

### Userscript 命令

| 命令                                                                  | 说明                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `corepack pnpm --filter @hv-pony-solver/userscript build`             | 用 esbuild 打包未压缩 userscript，并写入 `apps/userscript/dist/hv-pony-solver.user.js` |
| `corepack pnpm --filter @hv-pony-solver/userscript build -- --minify` | 用 esbuild 打包压缩 userscript                                                         |
| `pnpm --filter @hv-pony-solver/userscript typecheck`                  | 类型检查 userscript 源码                                                               |
| `pnpm --filter @hv-pony-solver/userscript test`                       | 在 jsdom 环境运行 userscript 单元测试                                                  |

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

构建脚本会：

1. 以 `apps/userscript/src/main.ts` 为入口。
2. 使用 esbuild 打包为浏览器 IIFE。
3. 从 `src/userscript/metadata.ts` 读取 userscript metadata。
4. 校验 metadata 必须以 `// ==UserScript==` 开始、以 `// ==/UserScript==` 结束。
5. 将 metadata 拼接到 bundle 前面。

### Bundle budget

`apps/userscript/scripts/build-userscript.test.mjs` 会在生成 metafile 时检查 bundle 大小：main bundle 目标小于 80KB，worker bundle 目标小于 20KB。该检查用于防止 userscript 产物无意膨胀。

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

| 配置                     | 当前值                                                                | 说明                                                         |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `imageSize`              | `640`                                                                 | 输入图像会 letterbox 到 640x640                              |
| `confidenceThreshold`    | `0.30`                                                                | YOLO 行置信度阈值                                            |
| `maxDetections`          | `16`                                                                  | 最多读取 16 个候选框                                         |
| `maxKinds`               | `3`                                                                   | 识别到 1 到 3 种不同小马才算成功                             |
| `ortScriptUrl`           | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js` | 默认构建下 Worker 动态加载 ONNX Runtime Web JS runtime       |
| `ortWasmPath`            | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/`           | ONNX Runtime Web wasm 资源路径，内置 JS runtime 时仍远程加载 |
| `workerRequestTimeoutMs` | `30000`                                                               | ONNX Worker 单次请求超时                                     |
| `modelDownloadTimeoutMs` | `30000`                                                               | 模型下载超时                                                 |

YOLO 输出解析规则：

- 每行按 6 个 float 读取。
- 第 5 个值是 confidence，第 6 个值是 class id。
- 优先保留 confidence 大于等于 `0.30` 的行。
- 如果没有任何行过阈值，但存在输出行，则回退到最高 confidence 的一行。
- 重复 class 只保留最高 confidence。
- 有效答案数量在 1 到 3 之间时 `success=true`。

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
3. 未命中或读取失败时，从 `${urlBase}?key=${encodeURIComponent(accessKey)}` 下载。
4. 下载成功后写回 IndexedDB；写入失败不会阻止本次使用已下载模型。

注意：当前源码默认 `accessKey` 为空。如果要访问真实模型，需要为构建产物提供授权 key。userscript 里的 key 对安装者可见，不应被视作真正保密的服务端密钥。

### 答题与历史记录

| 配置               | 当前值                                       |
| ------------------ | -------------------------------------------- |
| `randomOnFail`     | `false`                                      |
| 提交前延迟         | `3000` 到 `5000` ms                          |
| 多选点击间隔       | `1000` 到 `1500` ms                          |
| 历史记录 key       | `local_answer_history_v2`                    |
| 每个世界保留记录数 | `5`                                          |
| 世界识别           | URL 包含 `/isekai/` 时为异世界，否则为主世界 |

状态面板显示：模型状态、ONNX Session 状态、推理状态、当前世界和最近答题记录。渲染历史记录时会转义 HTML 敏感字符。

### 调试日志

userscript 菜单提供 `开启调试日志` 与 `关闭调试日志`。开启后，脚本会在浏览器 console 输出带 `[PonySolverLocal]` 前缀的调试日志。默认关闭，不会输出普通调试日志；警告和错误仍会输出，便于排障。

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

`wrangler.toml` 由 `render-config` 生成，并被 `.gitignore` 忽略。`render-config` 在 `HV_PONY_SOLVER_RENDER_ENV=production` 或 `deploy` 时会拒绝 `test-kv` / `test-bucket` 占位值；`pnpm --filter @hv-pony-solver/model-worker run deploy` 会自动以 `deploy` 模式渲染配置，并在部署前校验生成的 `wrangler.toml` 不含测试占位值。

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

示例：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=<kv-id> MODEL_BUCKET_NAME=<bucket-name> pnpm --filter @hv-pony-solver/model-worker render-config
```

### Worker 运行时绑定与变量

| 名称                     | 类型       | 必填 | 说明                                               |
| ------------------------ | ---------- | ---- | -------------------------------------------------- |
| `MODEL_KEYS`             | KV binding | 是   | 授权 token 存储；token 字符串作为 key，值非空即可  |
| `MODEL_BUCKET`           | R2 binding | 是   | 存放真实模型与 decoy 模型                          |
| `PUBLIC_MODEL_PATH`      | var        | 否   | 公开下载路径；缺省使用共享常量 `/yolo26n-640.onnx` |
| `REAL_MODEL_OBJECT_KEY`  | var        | 是   | 真实模型在 R2 中的 object key                      |
| `DECOY_MODEL_OBJECT_KEY` | var        | 是   | decoy 模型在 R2 中的 object key                    |
| `INVALID_KEY_MODE`       | var        | 否   | `decoy` 或 `error`；非 `error` 时按 `decoy` 处理   |

### HTTP 行为

| 场景                                                           | 响应                                         |
| -------------------------------------------------------------- | -------------------------------------------- |
| `GET /yolo26n-640.onnx?key=<authorized-64-hex>` 且 KV 命中     | `200` 真实模型                               |
| `HEAD /yolo26n-640.onnx?key=<authorized-64-hex>` 且 KV 命中    | `200` 无 body，保留模型 headers              |
| 缺少 key、key 格式错误、KV 未命中，且 `INVALID_KEY_MODE=decoy` | `200` decoy 模型                             |
| 缺少 key、key 格式错误、KV 未命中，且 `INVALID_KEY_MODE=error` | `403 Forbidden`                              |
| 非模型路径                                                     | `404 Not Found`                              |
| 非 `GET` / `HEAD` 方法                                         | `405 Method Not Allowed`，`Allow: GET, HEAD` |
| 选中的 R2 object 缺失                                          | `500 Model object is not configured`         |
| 必填运行时变量缺失                                             | `500 Internal Server Error`                  |

### 授权 key 规则

授权 key 必须匹配：

```text
/^[0-9a-fA-F]{64}$/
```

Worker 通过 `MODEL_KEYS.get(key)` 判断授权。只要 KV 返回值不是 `null`，就视为授权。测试中使用的 marker 值是 `1`。

### Decoy 模型策略

`INVALID_KEY_MODE=decoy` 时，无效或未授权 key 会收到 decoy R2 对象，而不是 `403`。这个策略用于避免从 HTTP 状态直接暴露 key 是否有效。

userscript 仍会按 `packages/shared/src/model.ts` 中的 `MODEL_INTEGRITY` 校验下载内容。推荐 decoy 对象不要匹配真实模型的 byteLength 与 SHA-256；这样未授权下载即使返回 `200`，也会在 userscript 侧被完整性校验阻断。

如果需要更直接的错误语义，可将 `INVALID_KEY_MODE` 设置为 `error`，此时无效 key 返回 `403 Forbidden`。

## Shared 包契约

`packages/shared` 只包含跨应用共享且稳定的契约：

| 导出                            | 说明                                   |
| ------------------------------- | -------------------------------------- | ------- | ------------ |
| `ANSWER_CODES`                  | `['TS', 'RA', 'FS', 'RD', 'PP', 'AJ']` |
| `AnswerCode`                    | 上述答案编码的联合类型                 |
| `answerCodeForClassId(classId)` | 按 class id 返回对应答案编码           |
| `MODEL_FILENAME`                | `yolo26n-640.onnx`                     |
| `DEFAULT_PUBLIC_MODEL_PATH`     | `/yolo26n-640.onnx`                    |
| `ModelAccessDecision`           | `'real'                                | 'decoy' | 'forbidden'` |
| `MODEL_ACCESS_TOKEN_PATTERN`    | 64 位十六进制 token 正则               |
| `isModelAccessToken(value)`     | token 类型守卫                         |

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
pnpm build
```

Worker 测试依赖渲染后的 `wrangler.toml`。本地测试前可先使用测试值渲染：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv MODEL_BUCKET_NAME=test-bucket pnpm --filter @hv-pony-solver/model-worker render-config
pnpm --filter @hv-pony-solver/model-worker test
```

## CI/CD

### CI workflow

`.github/workflows/verify-monorepo.yml` 默认手动触发，用于按需运行仓库校验：

1. Checkout。
2. 设置 Node.js 22。
3. 设置 pnpm。
4. `pnpm install --frozen-lockfile`。
5. `pnpm lint`。
6. `pnpm typecheck`。
7. 使用测试值渲染 Worker Wrangler 配置。
8. `pnpm test`。
9. `pnpm build`。
10. 如果 `bundle_onnx_runtime=true`，额外构建内置 ONNX Runtime Web JS runtime 的 userscript。
11. 如果 `publish_userscript_artifact=true`，上传 `apps/userscript/dist/hv-pony-solver.user.js` artifact；默认不上传。

### Model Worker 部署 workflow

`.github/workflows/deploy-cloudflare-model-worker.yml` 默认手动触发，用于按需验证 Model Worker；只有 `publish_model_worker=true` 时才部署，默认不部署。

验证与部署步骤：

1. Checkout。
2. 设置 Node.js 22。
3. 设置 pnpm。
4. `pnpm install --frozen-lockfile`。
5. 使用 GitHub Secrets 渲染 Wrangler 配置。
6. 类型检查 Worker。
7. 运行 Worker 测试。
8. 如果 `publish_model_worker=true`，执行 `pnpm --filter @hv-pony-solver/model-worker run deploy`；默认跳过部署。

需要配置的 GitHub Secrets：

| Secret                       | 用途                        |
| ---------------------------- | --------------------------- |
| `MODEL_KEYS_KV_NAMESPACE_ID` | 渲染 Worker KV namespace id |
| `MODEL_BUCKET_NAME`          | 渲染 Worker R2 bucket 名称  |
| `CLOUDFLARE_ACCOUNT_ID`      | Wrangler 部署认证           |
| `CLOUDFLARE_API_TOKEN`       | Wrangler 部署认证           |

## 部署与发布

### 发布 userscript

```bash
corepack pnpm --filter @hv-pony-solver/userscript build
```

如需把 `onnxruntime-web` JS runtime 内置进 userscript，可显式运行：

```bash
corepack pnpm --filter @hv-pony-solver/userscript build:bundled-runtime
```

默认构建不内置 JS runtime；两种构建都仍通过 `ortWasmPath` 加载 WASM 资源。`HV_PONY_SOLVER_ONNX_RUNTIME_PATH` 仅用于可信本地调试，不应暴露给 workflow 输入或不可信参数。

将生成的文件安装到 userscript 管理器：

```text
apps/userscript/dist/hv-pony-solver.user.js
```

如果需要访问真实模型，需要确保构建产物中的 `modelConfig.accessKey` 对应 Worker KV 中存在的授权 key。`modelConfig.verifyIntegrity` 默认开启（`true`），会按 `packages/shared/src/model.ts` 中 `MODEL_INTEGRITY` 定义的 `byteLength` 与 `sha256` 对下载及缓存读取进行严格校验；当远端模型字节内容变更时，必须同步更新 `MODEL_INTEGRITY` 与 `MODEL_VERSION`，否则下载会被阻断。

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
