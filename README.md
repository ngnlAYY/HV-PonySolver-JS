# HV PonySolver JS

HV PonySolver JS 是一个面向 Hentaiverse Pony 验证码的 TypeScript 单仓库项目。项目由用户脚本、桌面浏览器扩展、Cloudflare Model Worker 和共享包组成，负责验证码图片预处理、ONNX Runtime Web 推理、模型安全分发以及构建与部署校验。

当前版本的核心约束：

- 新版用户脚本只下载并运行 `.ort` 模型。
- 旧版用户脚本仍可通过原有 `.onnx` 路径工作。
- 默认构建不内置 ONNX Runtime，运行时从固定版本的 jsDelivr 地址加载完整版。
- 显式内置构建只内置精简 JS glue，精简 WASM 仍从 R2 下载。
- 两种构建都从 Model Worker 下载同一个 `.ort` 模型。
- 默认运行时和内置运行时之间没有自动回退。
- 模型访问密钥只允许通过 `Authorization: Bearer` 传递，不接受查询字符串密钥。
- 扩展版为 Chrome、Edge 和 Firefox 生成 Chromium/Firefox MV3 产物；默认远程下载模型，也可显式构建无需 Key 的内置模型版本；所有可执行 JS、Worker 和 WASM 均随扩展打包。
- 用户脚本与扩展共用 `packages/browser-core` 的 DOM、答题、推理和模型契约，但拥有独立的平台适配器和构建产物。

## 功能概览

- 在独立 Web Worker 中执行 ONNX Runtime Web 推理，避免阻塞页面主线程。
- 将验证码图片转换为 `640 x 640` CHW `Float32` 输入。
- 解析 YOLO 输出并映射为 Pony 答案代码。
- 使用本地缓存减少模型重复下载。
- 通过 Cloudflare Worker、KV 和 R2 分发真实模型、诱饵模型及公开 WASM。
- 对 `.ort` 模型和精简 WASM 执行长度与 SHA-256 校验。
- 提供默认外部完整版和显式内置精简版两种运行时构建。
- 提供文档漂移、架构边界、浏览器危险调用、包体预算和部署契约检查。
- 提供可重复的远程/内置模型 Chromium/Firefox 扩展 ZIP、SHA-256、扩展资源审计和真实浏览器整链测试。

## 架构

```text
Hentaiverse 页面
    |
    v
用户脚本主线程
    |-- 读取配置和访问密钥
    |-- 下载并缓存 yolo26n-640.ort
    |-- 创建 Blob Web Worker
    |
    v
ONNX 推理 Worker
    |-- external: 从 jsDelivr 加载完整 ONNX Runtime Web
    |-- bundled: 使用内置精简 glue，并下载首方精简 WASM
    |-- 创建 WASM Execution Provider 会话
    |-- 执行图像预处理、推理和结果解析
    |
    v
答案选择与状态面板

扩展版：

Hentaiverse 内容脚本
    |-- DOM 观察、图片读取、答案点击和原生提交
    |-- JSON-safe、有大小上限的 Base64 图片消息
    |
    +--> Chromium MV3 service worker --> Offscreen Document --+
    |                                                           |
    +--> Firefox MV3 background page ----------------------------+
                                                                v
                                               扩展推理 Host
                                               |-- remote: Key + 下载/缓存模型
                                               |-- packaged: 包内 .ort（完整性校验、非机密）
                                               |
                                               v
                                               module Worker
                                               + 一次性模型 ArrayBuffer
                                               + 精简 ORT glue/WASM

Cloudflare Model Worker
    |-- KV: 校验 Bearer token
    |-- R2: 读取真实模型、诱饵模型和公开 WASM
    |-- 路由: 旧版 ONNX、新版 ORT、精简 WASM
```

本文使用以下名称区分两类 Worker：

| 名称             | 含义                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ONNX 推理 Worker | 用户脚本或扩展推理 Host 创建的浏览器 Web Worker                                                                                  |
| 扩展推理 Host    | Chromium Offscreen Document 或 Firefox background script；远程模式负责 Key/下载/缓存，内置模式只读取包内模型，两者都管理推理会话 |
| Model Worker     | `apps/model-worker` 中部署到 Cloudflare 的服务                                                                                   |

## 仓库结构

| 路径                    | 作用                                                            |
| ----------------------- | --------------------------------------------------------------- |
| `apps/userscript`       | 用户脚本、ONNX 推理 Worker、构建器和浏览器测试                  |
| `apps/extension`        | Chromium/Firefox 扩展入口、消息协议、设置页、构建器和浏览器测试 |
| `apps/model-worker`     | Cloudflare Model Worker、Wrangler 配置和部署契约检查            |
| `packages/browser-core` | 用户脚本与扩展共用的标准浏览器 DOM、答题、推理、模型和渲染逻辑  |
| `packages/shared`       | 用户脚本和 Model Worker 共用的模型、令牌及 ORT 资产契约         |
| `config/onnxruntime`    | 精简 ONNX Runtime 所需的算子与类型配置                          |
| `docs`                  | 运行时、运维和架构补充文档                                      |
| `other`                 | 可供人工上传或归档的精简运行时生成物                            |
| `scripts`               | 仓库级构建、校验、文档漂移和发布辅助脚本                        |
| `.github/workflows`     | 验证、安全扫描和 Model Worker 部署工作流                        |

## 模型格式与兼容关系

新版和旧版客户端由请求路径区分，不在用户脚本中做格式探测或兼容回退。

| 客户端                     | 请求路径                | 模型格式 | 状态                               |
| -------------------------- | ----------------------- | -------- | ---------------------------------- |
| 新版用户脚本               | `/yolo26n-640.ort`      | ORT      | 当前默认                           |
| 浏览器扩展（默认远程模型） | `/yolo26n-640.ort`      | ORT      | Key 鉴权下载，本地打包运行时       |
| 浏览器扩展（显式内置模型） | `model/yolo26n-640.ort` | ORT      | 无需 Key，模型与运行时均在扩展包内 |
| 旧版用户脚本               | `/yolo26n-640.onnx`     | ONNX     | 继续保留                           |

新版模型契约：

| 字段       | 值                                         |
| ---------- | ------------------------------------------ |
| 文件名     | `yolo26n-640.ort`                          |
| 公开 URL   | `https://models.ngnl.host/yolo26n-640.ort` |
| R2 对象键  | `real/yolo26n-640.ort`                     |
| 字节长度   | `9,914,448`                                |
| 版本       | `yolo26n-640-2026-05-14`                   |
| 完整性来源 | `packages/shared/src/ort-assets.ts`        |

远程模型下载器和内置模型构建器都使用固定长度和 SHA-256 契约验证 `.ort` 内容。远程模型 URL、对象键、长度和哈希必须一起更新，不能只替换 R2 对象；内置构建的输入路径固定为仓库根目录的 `model/yolo26n-640.ort`。

## ONNX Runtime 构建模式

以下运行时 profile 只适用于用户脚本，并由构建命令决定，不由运行时配置自动选择。扩展版始终使用随包分发的精简 glue 和 WASM，没有外部运行时 profile。

| 项目         | 默认外部完整版                      | 显式内置精简版                          |
| ------------ | ----------------------------------- | --------------------------------------- |
| profile 名称 | `external`                          | `bundled`                               |
| 构建命令     | `build`                             | `build:bundled-runtime`                 |
| JS 运行时    | 从 jsDelivr 加载 `ort.min.js`       | 构建时内置精简 glue                     |
| WASM         | 从 jsDelivr `dist/` 加载完整版 WASM | 从 `models.ngnl.host` 下载内容寻址 WASM |
| WASM 校验    | 依赖固定版本 CDN                    | 最大长度、精确长度和 SHA-256            |
| 自动回退     | 无                                  | 无                                      |
| 包体预算     | `256 KiB`                           | `1 MiB`                                 |

根 `bundle:check` 对不带 `--minify` 的默认 profile 产物执行 `256 KiB` 门禁；显式压缩的发布构建不能替代这项未压缩门禁。

### 默认外部完整版

默认构建使用固定版本的 ONNX Runtime Web `1.27.0`：

```text
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/
```

ONNX 推理 Worker 使用 `importScripts()` 加载 `ort.min.js`，并设置：

- `numThreads = 1`
- `proxy = false`
- WASM Execution Provider

该模式不会下载项目生成的精简 WASM，也不会在 CDN 失败时切换到内置精简版。固定版本 URL 降低了版本漂移，但远程 JS 和完整版 WASM 仍属于外部 CDN 信任边界。

### 显式内置精简版

内置构建将以下 glue 打入 ONNX 推理 Worker：

```text
apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs
```

glue 在构建前校验：

| 字段     | 值                                                                 |
| -------- | ------------------------------------------------------------------ |
| 字节长度 | `56,993`                                                           |
| SHA-256  | `a63d4f08e70220c0f721fabfd4e4b958aa127334a19038b2732d07e919f32554` |
| 最大长度 | `96,000`                                                           |

运行时下载以下精简 WASM：

```text
https://models.ngnl.host/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm
```

精简 WASM 契约：

| 字段      | 值                                                                                            |
| --------- | --------------------------------------------------------------------------------------------- |
| 文件名    | `ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm`         |
| R2 对象键 | `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` |
| 字节长度  | `1,267,937`                                                                                   |
| SHA-256   | `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa`                            |
| 最大长度  | `2,000,000`                                                                                   |

下载使用 `cache: force-cache` 和 `redirect: error`。响应必须同时通过最大长度、精确长度和 SHA-256 校验，否则推理初始化失败，不会回退到 CDN 完整版。

### 精简运行时供应链

当前精简运行时固定以下上游信息：

| 字段              | 值                                                                 |
| ----------------- | ------------------------------------------------------------------ |
| npm 包            | `onnxruntime-web@1.27.0`                                           |
| ONNX Runtime 提交 | `8f0278c77bf44b0cc83c098c6c722b92a36ac4b5`                         |
| emsdk             | `4.0.23`                                                           |
| 算子配置 SHA-256  | `2abe2e2987496ab518de97a7f4b157cec1bd1817c621d3523073034fb47591fe` |

权威配置位于：

```text
apps/userscript/src/inference/onnx-runtime-assets.ts
config/onnxruntime/required_operators_and_types.config
```

更详细的构建约束见 [`docs/onnx-runtime.md`](docs/onnx-runtime.md)。

## 环境要求

| 工具     | 要求                         |
| -------- | ---------------------------- |
| Node.js  | `>= 24.15.0`                 |
| pnpm     | `11.21.0`                    |
| Corepack | 推荐启用，用于固定 pnpm 版本 |

安装依赖：

```bash
corepack enable
pnpm install
```

如果当前 shell 中的 `pnpm` 不是项目声明的版本，直接使用：

```bash
corepack pnpm install
```

## 快速构建

### 浏览器扩展

```bash
pnpm --filter @hv-pony-solver/extension build
pnpm --filter @hv-pony-solver/extension build:packaged
```

`build` 默认等价于 `--model-mode remote`，需要 Key 下载模型；`build:packaged` 等价于 `--model-mode packaged`，只从固定的 `model/yolo26n-640.ort` 读取模型，不接受生产路径覆盖，也不在运行时回退到远程下载。每次构建都会清理并重新生成 `apps/extension/dist/`：

```text
chromium/                                      Chrome、Edge 解压目录
firefox/                                       Firefox 解压目录
hv-pony-solver-chromium-<version>.zip          Chromium 安装包
hv-pony-solver-firefox-<version>.zip           Firefox 安装包
hv-pony-solver-chromium-packaged-<version>.zip 内置模型 Chromium 安装包
hv-pony-solver-firefox-packaged-<version>.zip  内置模型 Firefox 安装包
*.zip.sha256                                   压缩包哈希
*.artifact.json                                文件长度与 SHA-256 清单
```

ZIP 使用固定时间戳与稳定文件顺序；相同源码和工具链应产生相同字节。`build-manifest.json` 和顶层 artifact 清单记录 `modelDelivery`；内置版本还记录模型文件名、`9,914,448` 字节长度和 SHA-256。构建器同时审计清单引用、权限、CSP、远程可执行代码、动态导入以及模型/ORT glue/WASM 哈希。

支持范围：

| 产物                       | 浏览器          | 最低版本            | 后台模型                                               | 执行门禁                                     |
| -------------------------- | --------------- | ------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `chromium`（两种模型模式） | Chrome、Edge    | Chromium 116        | MV3 service worker broker + Offscreen Document         | CI 在真实 Chromium 116 上执行                |
| `firefox`（两种模型模式）  | Firefox Desktop | Firefox 140         | MV3 background script，清单不写不受支持的 `persistent` | CI 在真实 Firefox 140 上执行                 |
| `firefox`（同一 ZIP）      | Firefox Android | Firefox Android 142 | MV3 background script                                  | 当前 runner 无法自动化；发布必须提供外部证据 |

Safari、其他移动浏览器和 Manifest V2 不在当前范围内。Firefox Desktop 140 与 Firefox Android 142 是不同下限；“当前桌面版本 >= 下限”不能作为任一最低版本执行证据，也不能代表 Android 覆盖。数据传输同意声明中，远程模式声明 `authenticationInfo`，因为模型 Key 会作为 Bearer 凭据发送到 `models.ngnl.host`；内置模式声明 `none`。内置版本也移除模型服务 host permission；Chromium 仍保留 `offscreen`。验证码图片和识别结果不发送到模型服务，推理在浏览器本地完成。

本地加载：

- Chrome：打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，指向 `apps/extension/dist/chromium`。
- Edge：打开 `edge://extensions`，启用开发人员模式，加载同一个 `chromium` 目录。
- Firefox：打开 `about:debugging#/runtime/this-firefox`，选择“临时载入附加组件”，打开 `apps/extension/dist/firefox/manifest.json`。

点击工具栏按钮会打开扩展设置页。远程版本可配置模型 Key；Key 只保存在扩展源的 IndexedDB 中且不会回显，验证会实际下载并校验模型，可能消耗月度额度。内置版本不读取也不删除旧 Key，Key 控件保持置灰并显示“当前版本已内置模型，无需配置模型 Key。”。两种版本都可配置自动/手动模式、失败随机答案、点击/提交时间、面板位置、紧凑模式和历史条数；这些小型设置与分世界历史保存在 `storage.local`。

不要在同一浏览器配置中同时启用用户脚本版和扩展版，否则两者可能同时处理并提交同一个验证码。

### 默认外部完整版

```bash
pnpm --filter @hv-pony-solver/userscript build -- --minify
```

### 显式内置精简版

```bash
pnpm --filter @hv-pony-solver/userscript build:bundled-runtime -- --minify
```

两条命令默认写入同一个用户脚本输出路径。连续构建两种 profile 时，后一次构建会覆盖前一次。需要同时保留时，可以显式设置不同输出：

```bash
HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH=apps/userscript/dist/hv-pony-solver.external.user.js \
HV_PONY_SOLVER_ARTIFACT_MANIFEST_PATH=apps/userscript/dist/hv-pony-solver.external.artifact.json \
pnpm --filter @hv-pony-solver/userscript build -- --minify

HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH=apps/userscript/dist/hv-pony-solver.bundled.user.js \
HV_PONY_SOLVER_ARTIFACT_MANIFEST_PATH=apps/userscript/dist/hv-pony-solver.bundled.artifact.json \
pnpm --filter @hv-pony-solver/userscript build:bundled-runtime -- --minify
```

构建器支持以下输出环境变量：

| 环境变量                                | 作用                      |
| --------------------------------------- | ------------------------- |
| `HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH` | 用户脚本输出路径          |
| `HV_PONY_SOLVER_METAFILE_PATH`          | esbuild metafile 输出路径 |
| `HV_PONY_SOLVER_ARTIFACT_MANIFEST_PATH` | 构建产物清单路径          |
| `HV_PONY_SOLVER_ARTIFACT_SHA256_PATH`   | 构建产物 SHA-256 文件路径 |

构建产物清单记录文件名、字节长度、SHA-256、是否压缩以及 `bundledRuntime` 标志。

## 常用开发命令

### 仓库级命令

| 命令                                                        | 作用                                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                | 构建所有工作区包，用户脚本使用默认外部 profile                                                                                               |
| `pnpm lint`                                                 | 执行 ESLint                                                                                                                                  |
| `pnpm typecheck`                                            | 对所有工作区执行 TypeScript 类型检查                                                                                                         |
| `pnpm test`                                                 | 执行工作区和仓库级测试                                                                                                                       |
| `pnpm test:coverage`                                        | 生成覆盖率报告                                                                                                                               |
| `pnpm docs:check`                                           | 检查 README 与源码、配置和资产清单的漂移                                                                                                     |
| `pnpm architecture:check`                                   | 检查跨层和跨应用导入边界                                                                                                                     |
| `pnpm browser-sinks:check`                                  | 检查浏览器危险调用白名单                                                                                                                     |
| `pnpm bundle:check`                                         | 构建未压缩的默认 profile 并检查 `256 KiB` 预算                                                                                               |
| `pnpm bundle:check:default`                                 | 检查当前产物的默认 profile 预算                                                                                                              |
| `pnpm bundle:check:bundled`                                 | 检查当前产物的内置 profile 预算                                                                                                              |
| `pnpm benchmark:inference`                                  | 执行推理预处理和解析基准，不作为 CI 性能门槛                                                                                                 |
| `pnpm benchmark:extension`                                  | 执行默认代表性浏览器 transport microbenchmark；不宣称扩展 remote/packaged、cold/warm 或推理性能                                              |
| `pnpm benchmark:extension:quick`                            | 执行降低采样的 Chromium transport smoke；不能作为性能比较证据                                                                                |
| `pnpm benchmark:extension:exhaustive`                       | 显式执行完整 transport 尺寸矩阵；成本显著高于默认代表性矩阵                                                                                  |
| `pnpm test:e2e`                                             | 执行用户脚本 Playwright Chromium 测试                                                                                                        |
| `pnpm test:e2e:extension:content`                           | 加载临时 Chromium 扩展并执行确定性内容脚本整链 fixture                                                                                       |
| `pnpm test:e2e:extension:chromium:load-only`                | 加载生产远程 Chromium 产物，仅验证加载与普通设置，不声称已验证远程模型                                                                       |
| `pnpm test:e2e:extension:chromium:authenticated`            | 从受保护环境读取 `KvKey`，验证真实模型后至少执行一次 `detect`；缺少 Key 时 fail closed                                                       |
| `pnpm test:e2e:extension:firefox:load-only`                 | 用 Firefox 临时加载并重载生产远程产物，不声称已执行鉴权推理                                                                                  |
| `pnpm --filter @hv-pony-solver/extension test:e2e:packaged` | 在真实 Chromium 和 Firefox 中验证内置模型、无 Key 推理及会话重建                                                                             |
| `pnpm check:userscript`                                     | 执行用户脚本聚合检查                                                                                                                         |
| `pnpm check:browser-core`                                   | 执行共用浏览器核心的类型、单元和契约检查                                                                                                     |
| `pnpm check:extension`                                      | 执行扩展类型、测试、双目标构建和 Firefox 严格 lint                                                                                           |
| `pnpm extension:package-check`                              | 重新生成扩展双目标产物，并执行 Firefox 严格 lint                                                                                             |
| `pnpm check:model-worker`                                   | 执行 Model Worker 聚合检查                                                                                                                   |
| `pnpm check:quick`                                          | 依次执行 `lint`、`typecheck`、`test`、`docs:check`、`architecture:check`、`browser-sinks:check`、`extension:package-check` 和 `bundle:check` |
| `pnpm check`                                                | 先执行 `check:quick`，再执行 `test:coverage` 和 `build`                                                                                      |
| `pnpm build:onnx-runtime`                                   | 从固定上游构建精简 ONNX Runtime                                                                                                              |
| `pnpm verify:onnx-runtime`                                  | 校验已纳入仓库的精简 glue                                                                                                                    |

### 用户脚本命令

```bash
pnpm --filter @hv-pony-solver/userscript build
pnpm --filter @hv-pony-solver/userscript build:bundled-runtime
pnpm --filter @hv-pony-solver/userscript test
pnpm --filter @hv-pony-solver/userscript typecheck
pnpm --filter @hv-pony-solver/userscript test:e2e
pnpm --filter @hv-pony-solver/userscript verify:onnx-runtime
```

### 浏览器扩展命令

```bash
pnpm --filter @hv-pony-solver/extension benchmark
pnpm --filter @hv-pony-solver/extension benchmark:quick
pnpm --filter @hv-pony-solver/extension benchmark:exhaustive
pnpm --filter @hv-pony-solver/extension benchmark:compare -- BASELINE_JSON CANDIDATE_JSON [OUTPUT_JSON]
pnpm --filter @hv-pony-solver/extension typecheck
pnpm --filter @hv-pony-solver/extension test
pnpm --filter @hv-pony-solver/extension test:coverage
pnpm --filter @hv-pony-solver/extension build
pnpm --filter @hv-pony-solver/extension build:packaged
pnpm --filter @hv-pony-solver/extension test:e2e:content
pnpm --filter @hv-pony-solver/extension test:e2e:chromium:load-only
pnpm --filter @hv-pony-solver/extension test:e2e:chromium:authenticated
pnpm --filter @hv-pony-solver/extension test:e2e:firefox:load-only
pnpm --filter @hv-pony-solver/extension test:e2e:packaged:chromium
pnpm --filter @hv-pony-solver/extension test:e2e:packaged:firefox
pnpm --filter @hv-pony-solver/extension test:e2e:packaged
```

`test:e2e:content` 使用只存在于临时测试构建中的确定性推理 Host，不访问真实模型服务。`test:e2e:chromium:load-only` 只证明生产远程版本可加载和设置可持久化，明确不验证远程模型。只有受保护的 `test:e2e:chromium:authenticated` 才读取 `KvKey`；它在鉴权下载和完整性校验后必须至少完成一次真实 `detect`，不能停在 `prepare`，缺少 Key 时直接失败。内置模型门禁不读取 Key 并显式关闭随机回退：Chromium 先校验实际 ZIP 与 artifact，再解压到临时目录并只加载该目录；Firefox 用标准 WebDriver 安装已校验的实际 ZIP（需要 `geckodriver` 与 `openssl`）。两者都断言成功类型、准确 checkbox index 和 confidence，证据绑定 archive SHA-256 与解压 tree；确定性 fixture 还必须匹配 artifact 中的 `expected.classId`/`expected.confidence`。各种证据不能互相替代。

CI 的独立最低版本任务下载并实际运行 Chromium 116 与 Firefox Desktop 140，同时设置 `REQUIRE_EXACT_MINIMUM_BROWSER=true`；更高的当前浏览器会被拒绝，不能冒充最低版本覆盖。GitHub runner 当前不能真实自动化 Firefox Android 142。发布扩展时必须把 `firefox_android_e2e_run_id` 指向一个成功的外部测试 run；该 run 的命名 artifact 必须包含对同一 Firefox ZIP（名称、长度、SHA-256）的 Android 142 成功推理证据。缺失证据、版本不是 142、使用随机回退或 archive 不一致都会使 release preflight 失败。完整格式与受保护 CI 环境配置见 [`docs/browser-extension.md`](docs/browser-extension.md)。

校验本地 `.ort` 模型：

```bash
MODEL_FILE=/path/to/yolo26n-640.ort \
pnpm --filter @hv-pony-solver/userscript verify-model-integrity
```

### Model Worker 命令

```bash
pnpm --filter @hv-pony-solver/model-worker render-config
pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
pnpm --filter @hv-pony-solver/model-worker dev
pnpm --filter @hv-pony-solver/model-worker typecheck
pnpm --filter @hv-pony-solver/model-worker test
pnpm --filter @hv-pony-solver/model-worker build
```

pnpm 11 会将 `deploy` 识别为自身命令。部署 Model Worker 时必须显式使用：

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```

## 生成精简 ONNX Runtime

生成命令：

```bash
pnpm build:onnx-runtime
```

脚本从固定 ONNX Runtime 提交和 emsdk 版本构建只包含所需算子的 SIMD 运行时。默认输出到 `other/`：

```text
other/ort-wasm-simd-<sha256>.wasm
```

当前可上传文件：

```text
other/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm
```

生成脚本不会上传 R2、部署 Model Worker 或自动发布用户脚本。采用新生成物前必须同步：

- `apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs`
- `apps/userscript/src/inference/onnx-runtime-assets.ts`
- `packages/shared/src/ort-assets.ts`
- `apps/model-worker/wrangler.template.toml`
- 对应测试、文档和 R2 对象

随后执行：

```bash
pnpm verify:onnx-runtime
pnpm lint
pnpm typecheck
pnpm test
```

## Model Worker 配置

Model Worker 使用 Wrangler 模板生成部署配置：

```text
apps/model-worker/wrangler.template.toml
```

生成的 `apps/model-worker/wrangler.toml` 是本地或 CI 产物，不应手工维护为权威来源。

### 绑定

| 绑定                    | 类型                         | 作用                                              |
| ----------------------- | ---------------------------- | ------------------------------------------------- |
| `MODEL_KEYS`            | Cloudflare KV                | 保存允许访问真实模型的 token 标记                 |
| `MODEL_BUCKET`          | Cloudflare R2                | 保存真实模型、诱饵模型和精简 WASM                 |
| `MODEL_DOWNLOAD_QUOTAS` | SQLite-backed Durable Object | 按规范化 Key 的 SHA-256 标识保存 UTC 月度下载次数 |

### 运行时变量

| 变量                        | 作用                                         |
| --------------------------- | -------------------------------------------- |
| `PUBLIC_MODEL_PATH`         | 旧版 ONNX 公开路径，默认 `/yolo26n-640.onnx` |
| `REAL_MODEL_OBJECT_KEY`     | 旧版真实 ONNX 的 R2 对象键，必填             |
| `DECOY_MODEL_OBJECT_KEY`    | 鉴权失败时使用的诱饵对象键，必填             |
| `PUBLIC_ORT_MODEL_PATH`     | 新版 ORT 公开路径，默认 `/yolo26n-640.ort`   |
| `REAL_ORT_MODEL_OBJECT_KEY` | 新版真实 ORT 的 R2 对象键，默认来自共享契约  |
| `PUBLIC_RUNTIME_WASM_PATH`  | 精简 WASM 公开路径，默认来自共享契约         |
| `RUNTIME_WASM_OBJECT_KEY`   | 精简 WASM 的 R2 对象键，默认来自共享契约     |
| `INVALID_KEY_MODE`          | 无效 token 策略，只允许 `decoy` 或 `error`   |

### 生成 Wrangler 配置

```bash
MODEL_KEYS_KV_NAMESPACE_ID=<kv-namespace-id> \
MODEL_BUCKET_NAME=<r2-bucket-name> \
INVALID_KEY_MODE=decoy \
pnpm --filter @hv-pony-solver/model-worker render-config

pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
```

部署模式会拒绝测试占位值。`INVALID_KEY_MODE` 省略时使用项目默认策略。

## Model Worker HTTP 契约

### 路由

| 路径                                   | 鉴权         | R2 对象                | 缓存策略          |
| -------------------------------------- | ------------ | ---------------------- | ----------------- |
| `/yolo26n-640.onnx`                    | Bearer token | 旧版真实模型或诱饵对象 | `no-store`        |
| `/yolo26n-640.ort`                     | Bearer token | 新版真实模型或诱饵对象 | `no-store`        |
| `/runtime/ort-wasm-simd-<sha256>.wasm` | 公开         | 精简 WASM              | 一年、`immutable` |

支持的方法：

```text
GET, HEAD, OPTIONS
```

- 未知路径返回 `404`。
- 不支持的方法返回 `405`，并设置 `Allow: GET, HEAD, OPTIONS`。
- `HEAD` 返回与 `GET` 一致的响应头，但不返回响应体。
- 模型响应使用 `application/octet-stream` 和 `Cache-Control: no-store`。
- WASM 响应使用 `application/wasm` 和 `Cache-Control: public, max-age=31536000, immutable`。
- 文本错误响应使用 `no-store` 和 `X-Content-Type-Options: nosniff`。
- 同一 Key 的 ONNX 与 ORT 真实模型 `GET` 共用每个 UTC 自然月 5 次额度；`HEAD`、`OPTIONS`、诱饵模型和 Runtime 不计数。

### 响应矩阵

| 请求或情况                                                                           | HTTP 契约                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中  | `200` 真实模型，模型响应使用 `Cache-Control: no-store`；`GET /yolo26n-640.ort` 使用相同契约                                                                 |
| `HEAD /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中 | `200`，只读取 R2 元数据且不返回响应体；`HEAD /yolo26n-640.ort` 使用相同契约                                                                                 |
| `OPTIONS /yolo26n-640.onnx`                                                          | `204` preflight，`Access-Control-Allow-Methods: GET, HEAD, OPTIONS`，`Access-Control-Allow-Headers: Authorization`；`OPTIONS /yolo26n-640.ort` 使用相同契约 |
| 非 `GET` / `HEAD` / `OPTIONS` 方法                                                   | `405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`                                                                                                       |
| 同一 Key 当月第 6 次及后续真实模型 `GET`                                             | `429 Too Many Requests`，包含到下个 UTC 月的 `Retry-After`，并通过 `Access-Control-Expose-Headers` 暴露该响应头                                             |
| 选中的 R2 object 缺失                                                                | `500 Internal Server Error`                                                                                                                                 |

选中的 R2 object 缺失时不会回退到其他对象。

### 鉴权

真实模型请求必须包含：

```http
Authorization: Bearer <64位十六进制token>
```

Model Worker 只在 token 格式正确且 `MODEL_KEYS` 中存在非空标记时返回真实模型。

以下方式不受支持：

```text
?key=<token>
?token=<token>
```

query-string key 不授权真实模型；按缺少 Bearer token 处理。只有有效的 `Authorization: Bearer` 可以选择真实模型对象。

无效或缺失 token 的处理由 `INVALID_KEY_MODE` 决定：

| 模式    | 行为                               |
| ------- | ---------------------------------- |
| `decoy` | 返回诱饵对象和 `200`，这是默认策略 |
| `error` | 返回 `403`                         |

### CORS

模型路由允许以下浏览器来源：

```text
https://hentaiverse.org
https://alt.hentaiverse.org
```

允许的来源会被原样回显，并设置 `Vary: Origin`。未知浏览器来源不会获得允许来源响应头。没有 `Origin` 的非浏览器请求按公开响应头处理。

精简 WASM 是公开内容寻址资源，使用：

```http
Access-Control-Allow-Origin: *
```

CORS 只控制浏览器读取权限，不构成真实模型鉴权。

## R2 上传清单

部署前至少确认以下对象存在：

| 对象          | R2 对象键                                                                                     | 是否公开 |
| ------------- | --------------------------------------------------------------------------------------------- | -------- |
| 旧版真实 ONNX | `REAL_MODEL_OBJECT_KEY` 配置值                                                                | 否       |
| 诱饵模型      | `DECOY_MODEL_OBJECT_KEY` 配置值                                                               | 否       |
| 新版真实 ORT  | `real/yolo26n-640.ort`                                                                        | 否       |
| 精简 WASM     | `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | 是       |

上传精简 WASM 的示例：

```bash
pnpm --filter @hv-pony-solver/model-worker exec wrangler r2 object put \
  "<bucket-name>/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm" \
  --file "other/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm"
```

## 部署 Model Worker

本地部署流程：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=<kv-namespace-id> \
MODEL_BUCKET_NAME=<r2-bucket-name> \
INVALID_KEY_MODE=decoy \
pnpm --filter @hv-pony-solver/model-worker render-config

pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
pnpm --filter @hv-pony-solver/model-worker run deploy
```

部署后可以执行公开契约探测：

```bash
MODEL_WORKER_URL=https://models.ngnl.host/yolo26n-640.onnx \
MODEL_WORKER_ORT_URL=https://models.ngnl.host/yolo26n-640.ort \
MODEL_WORKER_RUNTIME_WASM_URL=https://models.ngnl.host/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm \
MODEL_WORKER_RUNTIME_WASM_BYTE_LENGTH=1267937 \
MODEL_WORKER_INVALID_KEY_MODE=decoy \
MODEL_WORKER_PROBE_ID=manual-$(date +%s) \
pnpm --filter @hv-pony-solver/model-worker check:deployment
```

该检查验证旧版 ONNX 和当前 ORT 路由的未鉴权 `OPTIONS`/`HEAD`，并验证公开精简 WASM 的 `HEAD`、CORS、内容类型、长度、ETag 和缓存契约。检查成功仍不证明以下事项：

- 真实 token 可以读取真实模型。
- 有效 token 能下载并通过哈希校验的真实 ORT 模型。
- R2 对象内容与本地哈希一致。
- 用户脚本已发布或浏览器推理成功。

这些项目需要独立验收。

`MODEL_DOWNLOAD_QUOTAS` 和 `ModelDownloadQuota` 由 `wrangler.template.toml` 中的 `new_sqlite_classes` 迁移创建，不需要新增 GitHub secret。部署后的回滚必须保留 Durable Object 类导出、绑定和迁移；如需临时停用限制，应采用保留这些资源的前向回滚，不能直接部署删除 Durable Object 配置的旧版本。

## 测试与质量门

### 源码契约索引

用户脚本推理参数以 `imagePreprocessConfig`、`yoloOutputConfig` 和 `inferenceTimeoutConfig` 为权威来源。关键字段包括 `imageSize`、`confidenceThreshold`、`maxDetections`、`maxKinds`、`rowSize`、`confidenceIndex`、`classIndex`、`workerInitTimeoutMs`、`workerDetectTimeoutMs` 和 `modelDownloadTimeoutMs`。

旧版 ONNX 模型清单由 `MODEL_VERSION`、`MODEL_INTEGRITY.byteLength` 和 `MODEL_INTEGRITY.sha256` 组成。`MODEL_FILE` 指定本地校验文件，`verify-model-integrity` 执行字节长度和 SHA-256 校验。新版 ORT 使用独立的共享资产清单，不覆盖旧版契约。

ONNX Runtime 资产由 `ONNX_RUNTIME_ASSETS` 统一描述，其中 `externalFullRuntime` 对应默认外置完整版，`bundledMinimalRuntime` 对应显式内置精简版。构建 glue 使用 `bundleAsset.byteLength`、`bundleAsset.sha256` 和 `bundleAsset.maxByteLength`；首方 WASM 使用 `wasmAsset.url`、`wasmAsset.byteLength`、`wasmAsset.sha256` 和 `wasmAsset.maxByteLength`。相关入口为 `build:onnx-runtime` 与 `verify:onnx-runtime`。

`architecture:check` 保护关键依赖边界：`inferenceTimeoutConfig` 继续集中管理异步超时，`StatusPanel` 继续负责 UI 状态输出，`Model Worker Core` 继续与 Userscript 浏览器代码隔离。

推荐的本地检查顺序：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:check
pnpm architecture:check
pnpm browser-sinks:check
pnpm bundle:check
pnpm verify:onnx-runtime
```

测试范围包括：

- 用户脚本配置、模型下载、缓存、推理 Worker 协议和 YOLO 输出解析。
- 默认外部 profile 与显式内置 profile 的构建隔离。
- 远程 `.ort` 模型契约和精简 WASM 完整性。
- Model Worker 环境归一化、路由、鉴权、CORS、缓存和错误响应。
- 每 Key 月度配额、ONNX/ORT 共享计数、UTC 月切换、并发硬上限和 `429` 契约。
- Wrangler 模板渲染与部署契约检查器。
- README 文档漂移、架构边界和浏览器危险调用。
- 默认和内置用户脚本包体预算。
- 扩展消息解码、来源检查、队列上限、超时/断连/重连、Key 隔离、双清单和可重复压缩包。
- Chromium 扩展 fixture 的自动/手动答题、一次原生提交、状态/历史和排除路由。
- 远程/内置模型四种扩展清单、包内模型、无 Key 设置页，以及真实 Chromium/Firefox 的内置模型推理和会话重建。

默认 Playwright E2E 使用本地 fixture，不访问真实 Hentaiverse 网站，也不证明线上 Model Worker 或 R2 状态。只有显式提供有效 `KvKey` 的远程扩展 Chromium smoke 才会发起真实模型下载；内置模型门禁只读取扩展包内资源。两者都不等同于 Chrome Web Store、Edge Add-ons 或 AMO 发布验收。

## CI 与发布

### 仓库验证工作流

`.github/workflows/verify-monorepo.yml` 在 Pull Request、`main` 推送和手动触发时执行：

- 使用 runner 提供的 Node.js 运行时和冻结依赖安装。
- 依赖审计、ESLint 和 TypeScript 类型检查。
- 文档漂移、架构边界和浏览器危险调用检查。
- 工作区测试与覆盖率。
- 默认外部 profile 构建及 `256 KiB` 预算。
- 显式内置 profile 构建及 `1 MiB` 预算。
- 按条件执行的 Playwright Chromium E2E。
- 双目标扩展构建、扩展资源与安全契约审计和 Chromium 扩展整链 fixture。
- 按手动输入发布的用户脚本构建产物。

CI 中的 E2E 和用户脚本产物发布默认不是每次运行都执行。

### Model Worker 部署工作流

`.github/workflows/deploy-cloudflare-model-worker.yml` 仅支持手动触发：

- 默认只渲染配置、执行检查并运行 Wrangler dry-run。
- 只有 `publish_model_worker=true` 且所需 secrets 完整时才实际部署。
- 部署完成后运行公开契约检查。

dry-run 成功只证明 Wrangler 可以生成部署包，不证明 Cloudflare 已更新，也不证明 R2、KV 或线上路由正确。

### 安全扫描

`.github/workflows/security-scan.yml` 执行 JavaScript/TypeScript CodeQL，并在 Pull Request 中执行依赖审查。

## 安全边界

- 不要把模型 token 写入 URL、日志、README、构建产物或公开配置。
- 查询字符串密钥不会授权真实模型。
- `@connect` 和 CORS 只允许网络访问，不代替 token 鉴权。
- 默认外部 profile 信任固定版本的 jsDelivr 运行时资源。
- 内置 profile 只对首方精简 WASM 执行内容完整性校验。
- 扩展产物不加载远程 JS/WASM；ORT glue、module Worker 和内容寻址 WASM 均随包分发。远程 `.ort` 下载和包内 `.ort` 都按固定长度与 SHA-256 校验；包内模型不加密，也不具备机密性。
- 扩展内容脚本不接收模型 Key 或模型字节。远程版本只有设置页可发起 Key 验证请求；内置版本不构建 Key 存储、验证或远程下载能力。
- 验证码图片为兼容扩展 JSON 消息边界继续使用有上限的 Base64；模型从 Host 以一次可转移的二进制 `ArrayBuffer` 交给推理 Worker，不使用 Base64 或分片。
- 模型和 WASM 的 R2 对象必须与共享清单中的长度和 SHA-256 一致。
- 原始 Key、规范化 Key、配额对象标识和配额状态均不得写入日志或响应。
- `decoy` 模式的未鉴权 `200` 不表示真实模型泄漏。
- 部署检查、静态测试和浏览器 E2E 分别证明不同边界，不能相互替代。

## 故障排查

### pnpm 版本不匹配

```bash
corepack pnpm --version
corepack pnpm install
```

项目固定 pnpm `11.21.0`。不要让全局 pnpm 的其他主版本接管项目脚本。

### 默认构建无法加载 ONNX Runtime

确认用户脚本管理器和网络允许访问：

```text
cdn.jsdelivr.net
```

默认 profile 没有内置回退。需要绕过完整版 CDN JS 时，应改用显式内置构建；内置构建仍需要访问 `models.ngnl.host` 下载精简 WASM 和 `.ort` 模型。

### 精简 WASM 初始化失败

检查以下项目：

- R2 对象键与 `PUBLIC_RUNTIME_WASM_PATH` 是否匹配。
- 响应是否发生重定向。
- 字节长度是否为 `1,267,937`。
- SHA-256 是否为 `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa`。
- `Content-Type` 是否为 `application/wasm`。

本地先运行：

```bash
pnpm verify:onnx-runtime
```

扩展版还应运行：

```bash
pnpm --filter @hv-pony-solver/extension build
pnpm --filter @hv-pony-solver/extension test:e2e:chromium:load-only
```

扩展不从 R2 下载 WASM；它读取包内 `runtime/ort-wasm-simd-<sha256>.wasm`。若出现 Emscripten import/link 错误，优先确认构建器使用的定制 glue 与包内 WASM 哈希是一对匹配资产。

### 内置模型扩展构建失败

内置版本只接受仓库根目录的固定输入：

```text
model/yolo26n-640.ort
```

构建会在清理旧 `dist` 前拒绝缺失文件、符号链接、非普通文件、错误长度或错误 SHA-256。它不会使用 `KvKey` 下载模型，也没有路径覆盖或远程回退。修复模型文件后运行：

```bash
pnpm --filter @hv-pony-solver/extension build:packaged
```

### 模型请求返回诱饵内容或 `403`

确认：

- 请求使用 `Authorization: Bearer`。
- token 是 64 位十六进制字符串。
- `MODEL_KEYS` 中存在对应 token 的非空标记。
- 没有把 token 放在查询字符串中。
- `INVALID_KEY_MODE` 与预期一致。

### 内置构建体积异常

先构建内置 profile，再检查内置预算：

```bash
pnpm --filter @hv-pony-solver/userscript build:bundled-runtime -- --minify
pnpm bundle:check:bundled
```

不要对默认 profile 产物使用内置预算来判断运行时是否真正被打包。构建产物清单中的 `bundledRuntime` 必须与预期 profile 一致。

### Model Worker 部署命令未执行项目脚本

使用：

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```

不要省略 `run`。

## 相关文档

- [`docs/onnx-runtime.md`](docs/onnx-runtime.md)：精简运行时资产、哈希和复现说明。
- [`docs/browser-extension.md`](docs/browser-extension.md)：扩展架构、权限、构建、加载、存储和验证边界。
- [`docs/model-worker-ops.md`](docs/model-worker-ops.md)：Model Worker 运维和线上验收矩阵。

本文档中的命令、URL、对象键和哈希属于代码契约。修改相关实现时必须同步测试和文档漂移规则。
