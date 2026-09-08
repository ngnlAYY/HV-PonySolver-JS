# HV PonySolver JS

HV PonySolver JS 是一个面向 Hentaiverse Pony 验证码的 TypeScript 单仓库项目。项目由用户脚本、桌面浏览器扩展、Cloudflare Model Worker 和共享包组成，负责验证码图片预处理、ONNX Runtime Web 推理、模型安全分发以及构建与部署校验。

当前版本的核心约束：

- 当前用户脚本只下载并运行 `.ort` 模型。
- Model Worker 为旧版客户端保留原有 `.onnx` 路由。
- 用户脚本默认构建不内置 ONNX Runtime，运行时从固定版本的 jsDelivr 地址加载完整版。
- 用户脚本显式内置构建只内置精简 JS glue，精简 WASM 仍从 R2 下载。
- 用户脚本的两种构建都从 Model Worker 下载同一个 `.ort` 模型。
- 用户脚本的默认运行时和内置运行时之间没有自动回退。
- 模型访问密钥只允许通过 `Authorization: Bearer` 传递，不接受查询字符串密钥。
- 扩展版为 Chrome、Edge 和 Firefox 生成 Chromium/Firefox MV3 产物；默认远程下载模型，也可显式构建无需 Key 的内置模型版本；所有可执行 JS、Worker 和 WASM 均随扩展打包。
- 用户脚本与扩展共用 `packages/browser-core` 的 DOM、答题、推理和模型契约，但拥有独立的平台适配器和构建产物。

维护者可从[文档导航](docs/README.md)进入[整体架构](docs/architecture/overview.md)、[开发验证](docs/development/verification.md)和[当前目录组织](docs/development/directory-layout.md)。源码、结构、风格、注释与文档的历史审计见[仓库审计报告](docs/audits/2026-09-07-repository-audit.md)，已完成的目录、模块和配置改动见[实施记录](docs/development/implementation-plan.md)。

当前客户端版本：

| 客户端     | 当前版本 | 版本权威来源                   |
| ---------- | -------- | ------------------------------ |
| 用户脚本   | `3.0.0`  | `apps/userscript/package.json` |
| 浏览器扩展 | `0.1.1`  | `apps/extension/package.json`  |

根包和内部工作区都是私有包，其版本号不代表扩展发布版本。扩展 ZIP、artifact 元数据、清单以及 GitHub Release 标签都从扩展包版本生成。

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

## 答题与面板行为

答题模式默认为 `auto`。自动模式会在识别成功后勾选答案并经过配置的延迟点击页面原生提交按钮；`manual` 模式只把识别结果写入面板，不点击答案或提交。识别失败时随机答案默认开启，可以在扩展设置页关闭。

“保留已勾选答案”默认开启，允许用户在识别过程中手动答题：

- 手动勾选与程序自动勾选会分别跟踪，程序不会取消手动项；在自动勾选间隔中手动选中的答案也保持手动身份。
- 手动项与新旧自动项合计不超过 4 个时保持现状。
- 合计超过 4 个时，仅从自动项中按置信度由低到高移除，目标为总数至多 3 个；手动项本身已超过目标时仍全部保留。
- 关闭该开关后，程序会先清空当时已勾选答案，再接管本轮选择与提交。

程序在点击期间持续确认验证码、表单和控件仍属于同一轮。答案框不是预期的 6 个时显示“答案框数量异常”；缺少提交按钮时显示“未找到提交按钮”；表单已脱离页面、提交按钮已脱离或不属于该表单、任一答案框已脱离/不属于表单/被禁用时显示“答案控件不可用”；最终提交按钮被禁用时显示“提交按钮不可用”。若页面在等待期间替换了整组控件，本轮会静默取消，旧任务不会继续点击。相同验证码发生失败后会冷却 30 秒，连续 DOM 刷新在冷却期内不会重复记录；验证码变化、Key 更新或冷却结束后可重新尝试，持久化历史始终受 50 条硬上限约束。

状态面板默认位置为 `top=155, left=1240`，默认只在页面存在 `div#csp` 时显示。关闭该显示限制只改变面板可见性，不会关闭识别。面板默认显示 5 条记录，设置范围为 1–50 条。

“推理状态：完成 Nms”表示本次识别请求耗时，包含图片传输、排队及必要重试。新答题记录末尾的耗时从本轮开始准备模型时起算，包含模型准备、图片读取、识别和配置等待；自动模式还包含勾选间隔与提交延迟，手动模式则截至识别结果记录。它不包含开始扫描前的页面加载/防抖等待，也不包含提交后的服务器响应与页面跳转。两项耗时使用页面的单调时钟计算，系统校时不会改变结果；记录左侧的时刻仍使用本地时间。旧历史保留原值，不补算缺失阶段。

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
| `packages/shared`       | 浏览器端和 Model Worker 共用的模型、令牌及 ORT 资产契约         |
| `docs`                  | 文档导航、架构、开发手册、历史审计及运行时/缓存/运维专题        |
| `other`                 | 可供人工上传或归档的精简运行时生成物                            |
| `scripts`               | 仓库级构建、校验、文档漂移和发布辅助脚本                        |
| `.github/workflows`     | 验证、安全扫描和 Model Worker 部署工作流                        |

根 `scripts/` 按 `checks/`、`ci/`、`docs-drift/`、`model/`、`ort-runtime/`、`e2e/`、`lib/` 分组；扩展脚本按构建、基准、浏览器、E2E、fixture、模型和发布分组。根命令仍统一从 [package.json](package.json) 调用。共享包使用显式 exports，新增跨包入口时同步包清单和[架构边界检查](scripts/checks/check-architecture-boundaries.mjs)。

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

| 项目         | 默认外部完整版                       | 显式内置精简版                          |
| ------------ | ------------------------------------ | --------------------------------------- |
| profile 名称 | `external`                           | `bundled`                               |
| 构建命令     | `build`                              | `build:bundled-runtime`                 |
| JS 运行时    | 下载并校验 jsDelivr `ort.min.js`     | 构建时内置精简 glue                     |
| WASM         | 下载并校验 jsDelivr 完整版 WASM      | 从 `models.ngnl.host` 下载内容寻址 WASM |
| 内容校验     | JS/WASM 最大长度、精确长度和 SHA-256 | WASM 最大长度、精确长度和 SHA-256       |
| 自动回退     | 无                                   | 无                                      |
| 包体预算     | `256 KiB`                            | `1 MiB`                                 |

根 `bundle:check` 对不带 `--minify` 的默认 profile 产物执行 `256 KiB` 门禁；显式压缩的发布构建不能替代这项未压缩门禁。

### 默认外部完整版

默认构建使用固定版本的 ONNX Runtime Web `1.27.0`：

```text
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.wasm
```

默认 JS 运行时还固定以下原子契约：

| 字段                                    | 值                                                                 |
| --------------------------------------- | ------------------------------------------------------------------ |
| `externalFullRuntime.byteLength`        | `360,434`                                                          |
| `externalFullRuntime.sha256`            | `de1beb9d172dbda72e56fa2f430c8e4477e97908609859ab47f89fc3e034a8d5` |
| `externalFullRuntime.maxByteLength`     | `400,000`                                                          |
| `externalFullRuntime.wasmByteLength`    | `26,827,543`                                                       |
| `externalFullRuntime.wasmSha256`        | `78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48` |
| `externalFullRuntime.wasmMaxByteLength` | `30,000,000`                                                       |

ONNX 推理 Worker 以 `redirect: error` 并行下载 `ort.min.js` 和完整版 WASM，分别限制声明/实际大小，并对解压后的实际字节执行精确长度与 SHA-256 校验；只有两项都校验成功后才创建临时 Blob URL、调用 `importScripts()`，并通过 `wasmBinary` 注入已验证的 WASM 字节。启动期间最多暂存两个请求，失败后立即拒绝已排队及后续请求。运行时随后设置：

- `numThreads = 1`
- `proxy = false`
- WASM Execution Provider

该模式不会下载项目生成的精简 WASM，也不会在 CDN 或完整性校验失败时切换到内置精简版。远程 JS 和完整版 WASM 都由固定字节身份保护，ORT 不再自行按目录路径下载未验证的 WASM。

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

受版本控制的运行时契约位于：

```text
apps/userscript/src/inference/onnx-runtime-assets.ts
```

算子与类型配置由固定模型在构建时生成到
`config/onnxruntime/required_operators_and_types.config`；该本地输出已被 Git 忽略，以免把可再生文件当成源码。

更详细的构建约束见 [`docs/onnx-runtime.md`](docs/onnx-runtime.md)。

## 环境要求

| 工具    | 要求                                    |
| ------- | --------------------------------------- |
| mise    | 管理本地与 CI 的 Node.js、pnpm 工具版本 |
| Node.js | `24.15.0`（最低兼容要求 `>= 24.15.0`）  |
| pnpm    | `12.3.0`                                |

仓库根目录的 `mise.toml` 是本地与 GitHub Actions 的工具版本来源，精确固定 Node.js `24.15.0` 和 pnpm `12.3.0`；`package.json#engines` 保留 `>= 24.15.0` 的最低兼容要求，`package.json#packageManager` 与 mise 的 pnpm 版本保持一致。npm 包依赖仍由 pnpm 工作区和 `pnpm-lock.yaml` 管理。

按 [mise 官方说明](https://mise.jdx.dev/getting-started.html) 安装 mise 后，在仓库根目录安装工具与依赖：

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
```

首次 `mise trust` 用于信任仓库工具配置。后续命令可以通过 `mise exec --` 执行，无需修改全局 Node.js 或 pnpm：

```bash
mise exec -- node --version
mise exec -- pnpm --version

MODEL_KEYS_KV_NAMESPACE_ID=test-kv \
MODEL_BUCKET_NAME=test-bucket \
mise exec -- pnpm --filter @hv-pony-solver/model-worker render-config

mise exec -- pnpm check
```

首次运行包含 Model Worker 的测试或构建前，需要生成上面的本地测试配置。`test-kv` 和 `test-bucket` 只用于本地验证；生成命令会覆盖 `apps/model-worker/wrangler.toml`，已有自定义生成配置时应先在仓库外备份，验证后恢复。生产配置与发布步骤见[Worker 运维](docs/model-worker-ops.md)。

下文简写的 `pnpm` 和 `node` 命令均假定当前 shell 已[激活 mise](https://mise.jdx.dev/cli/activate.html)；未激活时在命令前加 `mise exec --`。升级工具时同步修改 `mise.toml` 和 `package.json`，再更新本节及工具版本契约测试。

### 根配置职责

| 配置                                                                          | 负责内容                                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [mise.toml](mise.toml)                                                        | 本地与 CI 的精确工具版本                                        |
| [package.json](package.json)                                                  | 公共命令、包管理器声明、Node 兼容要求，以及 `prettier` 格式规则 |
| [pnpm-workspace.yaml](pnpm-workspace.yaml) / [pnpm-lock.yaml](pnpm-lock.yaml) | 工作区、依赖覆盖规则和冻结依赖解析                              |
| [eslint.config.mjs](eslint.config.mjs)                                        | JavaScript/TypeScript 静态规则与日志模块例外                    |
| [tsconfig.base.json](tsconfig.base.json)                                      | 五个工作区继承的严格编译选项                                    |
| [.prettierignore](.prettierignore)                                            | 排除 vendor、运行时生成物、pnpm 锁文件和本地协调状态的格式化    |

各工作区通过自己的 `vitest.config.ts` 执行测试，由根命令递归调度。格式化规则集中在 `package.json#prettier`；格式化忽略清单只控制 Prettier 处理范围，Git 跟踪仍由 Git 的忽略规则决定。

## 快速构建

### 浏览器扩展

构建远程模型版：

```bash
pnpm --filter @hv-pony-solver/extension build
```

已有经过校验的固定 `model/yolo26n-640.ort` 时，可以改为构建内置模型版：

```bash
pnpm --filter @hv-pony-solver/extension build:packaged
```

`build` 默认等价于 `--model-mode remote`，构建时不需要 Key，运行后通过 Key 下载模型；`build:packaged` 等价于 `--model-mode packaged`，只从固定的 `model/yolo26n-640.ort` 读取模型，不接受生产路径覆盖，也不在运行时回退到远程下载。当前扩展版本为 `0.1.1`。每次构建都会清理并重新生成 `apps/extension/dist/`；下面列出两种模式各自的产物，单次构建只保留所选模式的 ZIP：

```text
chromium/                                      Chrome、Edge 解压目录
firefox/                                       Firefox 解压目录
hv-pony-solver-chromium-0.1.1.zip              远程模型 Chromium 安装包
hv-pony-solver-firefox-0.1.1.zip               远程模型 Firefox 安装包
hv-pony-solver-chromium-packaged-0.1.1.zip     内置模型 Chromium 安装包
hv-pony-solver-firefox-packaged-0.1.1.zip      内置模型 Firefox 安装包
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

点击工具栏按钮会打开扩展设置页。远程版本可配置模型 Key；Key 只保存在扩展源的 IndexedDB 中且不会回显，验证使用不计额度的 HEAD 探测。“查询下载次数”读取已保存 Key 的当前状态但不计次；后端关闭限制时显示“无次数限制（模型下载次数限制未开启）”。“下载模型”使用已保存 Key 下载、校验并缓存模型，已有有效缓存时不会重复消耗额度；后端只在 IndexedDB 缓存事务完成后接收确认并计次。设置页会保留后端、HTTP、超时或浏览器连接的实际错误信息；额度查询遇到后台 Port 瞬时断开时只重连一次，第二次失败直接显示真实原因。内置版本不读取也不删除旧 Key，Key 控件保持置灰并显示“当前版本已内置模型，无需配置模型 Key。”。两种版本都可配置自动/手动模式、失败随机答案、保留手动勾选、点击/提交时间、面板位置、仅在 `div#csp` 存在时显示面板（默认开启）、紧凑模式和历史条数；这些小型设置与分世界历史保存在 `storage.local`。

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

| 命令                                                        | 作用                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build`                                                | 构建所有工作区包，用户脚本使用默认外部 profile                                                                                                               |
| `pnpm format:check`                                         | 检查第一方源码、配置与文档格式；排除生成物、第三方资产和 pnpm 锁文件                                                                                         |
| `pnpm lint`                                                 | 执行 ESLint                                                                                                                                                  |
| `pnpm typecheck`                                            | 对所有工作区执行 TypeScript 类型检查                                                                                                                         |
| `pnpm test`                                                 | 执行工作区和仓库级测试                                                                                                                                       |
| `pnpm test:coverage`                                        | 生成覆盖率报告                                                                                                                                               |
| `pnpm docs:check`                                           | 检查契约文档与源码/资产的漂移，以及维护文档的本地链接和标题锚点                                                                                              |
| `pnpm architecture:check`                                   | 检查跨层和跨应用导入边界                                                                                                                                     |
| `pnpm browser-sinks:check`                                  | 检查浏览器危险调用白名单                                                                                                                                     |
| `pnpm bundle:check`                                         | 构建未压缩的默认 profile 并检查 `256 KiB` 预算                                                                                                               |
| `pnpm bundle:check:default`                                 | 检查当前产物的默认 profile 预算                                                                                                                              |
| `pnpm bundle:check:bundled`                                 | 检查当前产物的内置 profile 预算                                                                                                                              |
| `pnpm benchmark:inference`                                  | 执行推理预处理和解析基准，不作为 CI 性能门槛                                                                                                                 |
| `pnpm benchmark:extension`                                  | 执行有界 Chromium CI transport smoke（4 个场景、1,600 次操作、约 201 MiB 负载）；不作为性能比较证据                                                          |
| `pnpm benchmark:extension:full`                             | 显式执行代表性双浏览器矩阵（16 个场景、343,200 次操作、约 335 GiB 负载）；仅用于有意的本地基线/候选比较                                                      |
| `pnpm benchmark:extension:quick`                            | 执行降低采样的 Chromium transport smoke；不能作为性能比较证据                                                                                                |
| `pnpm benchmark:extension:product`                          | 使用本地固定模型测量实际 Chromium 消息与 ORT 推理链路，并在 localhost 回放模型下载、缓存和确认                                                               |
| `pnpm benchmark:extension:exhaustive`                       | 显式执行完整 transport 尺寸矩阵；成本显著高于默认代表性矩阵                                                                                                  |
| `pnpm test:e2e:userscript`                                  | 执行用户脚本 Playwright Chromium 测试                                                                                                                        |
| `pnpm test:e2e:extension:content`                           | 加载临时 Chromium 扩展并执行确定性内容脚本整链 fixture                                                                                                       |
| `pnpm test:e2e:extension:chromium:load-only`                | 加载生产远程 Chromium 产物，仅验证加载与普通设置，不声称已验证远程模型                                                                                       |
| `pnpm test:e2e:extension:chromium:authenticated`            | 从受保护环境读取 `KvKey`，验证真实模型后至少执行一次 `detect`；缺少 Key 时 fail closed                                                                       |
| `pnpm test:e2e:extension:firefox:load-only`                 | 用 Firefox 临时安装生产远程 ZIP，并验证当前设置页控件；不声称已执行鉴权推理                                                                                  |
| `pnpm --filter @hv-pony-solver/extension test:e2e:packaged` | 在真实 Chromium 和 Firefox 中验证内置模型、无 Key 推理及会话重建                                                                                             |
| `pnpm check:userscript`                                     | 执行用户脚本聚合检查                                                                                                                                         |
| `pnpm check:browser-core`                                   | 执行共用浏览器核心的类型、单元和契约检查                                                                                                                     |
| `pnpm check:extension`                                      | 执行扩展类型、测试、双目标构建和 Firefox 严格 lint                                                                                                           |
| `pnpm extension:package-check`                              | 重新生成扩展双目标产物，并执行 Firefox 严格 lint                                                                                                             |
| `pnpm check:model-worker`                                   | 执行 Model Worker 聚合检查                                                                                                                                   |
| `pnpm check:quick`                                          | 依次执行 `format:check`、`lint`、`typecheck`、`test`、`docs:check`、`architecture:check`、`browser-sinks:check`、`extension:package-check` 和 `bundle:check` |
| `pnpm check`                                                | 先执行 `check:quick`，再执行 `test:coverage` 和 `build`                                                                                                      |
| `pnpm build:onnx-runtime`                                   | 从固定上游构建精简 ONNX Runtime                                                                                                                              |
| `pnpm verify:onnx-runtime`                                  | 校验已纳入仓库的精简 glue                                                                                                                                    |

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
pnpm --filter @hv-pony-solver/extension benchmark:ci
pnpm --filter @hv-pony-solver/extension benchmark:full
pnpm --filter @hv-pony-solver/extension benchmark:quick
pnpm --filter @hv-pony-solver/extension benchmark:exhaustive
pnpm --filter @hv-pony-solver/extension benchmark:compare -- BASELINE_JSON CANDIDATE_JSON [OUTPUT_JSON]
pnpm --filter @hv-pony-solver/extension benchmark:product
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

`test:e2e:content` 使用只存在于临时测试构建中的确定性推理 Host，不访问真实模型服务。`test:e2e:chromium:load-only` 只证明生产远程版本可加载和设置可持久化；Firefox load-only 还会打开实际 ZIP 的设置页，核对 Key、次数查询、模型下载、面板显示限制和保留手动答案控件，二者都明确不验证远程模型。只有受保护的 `test:e2e:chromium:authenticated` 才读取 `KvKey`；它在鉴权下载和完整性校验后必须至少完成一次真实 `detect`，不能停在 `prepare`，缺少 Key 时直接失败。内置模型门禁不读取 Key 并显式关闭随机回退：Chromium 先校验实际 ZIP 与 artifact，再解压到临时目录并只加载该目录；Firefox 用标准 WebDriver 安装已校验的实际 ZIP（需要 `geckodriver` 与 `openssl`）。两者都断言成功类型、准确 checkbox index 和 confidence，证据绑定 archive SHA-256 与解压 tree；确定性 fixture 还必须匹配 artifact 中的 `expected.classId`/`expected.confidence`。各种证据不能互相替代。

CI 的独立最低版本任务下载并实际运行 Chromium 116 与 Firefox Desktop 140，同时设置 `REQUIRE_EXACT_MINIMUM_BROWSER=true`；更高的当前浏览器会被拒绝，不能冒充最低版本覆盖。GitHub runner 当前不能真实自动化 Firefox Android 142。发布可供商店审核的内置模型扩展 artifact 时，必须把 `firefox_android_e2e_run_id` 指向一个成功的外部测试 run；该 run 的命名 artifact 必须包含对同一 Firefox ZIP（名称、长度、SHA-256）的 Android 142 成功推理证据。缺失证据、版本不是 142、使用随机回退或 archive 不一致都会使 release preflight 失败。

手动触发 `Repository CI` 时可选择 `publish_extension_release=true`，从 `main` 创建当前版本对应的 `extension-v0.1.1` GitHub Release，并附带远程模型版 Chromium/Firefox ZIP、SHA-256 与 artifact 元数据。该入口默认关闭，要求完整仓库门禁、双浏览器 smoke、最低桌面版本和受保护 Key 的真实远程推理全部通过；它不发布到浏览器商店，也不声称 Firefox Android 已验证。内置模型 artifact 仍使用 `publish_extension_artifact=true` 和独立 Android 142 证据。完整格式与受保护 CI 环境配置见 [`docs/browser-extension.md`](docs/browser-extension.md)。

校验本地旧版 ONNX 模型：

```bash
MODEL_FILE=/path/to/yolo26n-640.onnx \
pnpm --filter @hv-pony-solver/userscript verify-model-integrity
```

`verify-model-integrity` 使用 [packages/shared/src/model.ts](packages/shared/src/model.ts) 中的旧版 ONNX 长度和 SHA-256。当前 ORT 输入由 `build:packaged` 按 [ort-assets.ts](packages/shared/src/ort-assets.ts) 校验；两种模型的完整性清单分别维护。

`mise exec -- pnpm benchmark:extension:product` 要求本地固定的 `model/yolo26n-640.ort` 和可运行的 Chromium。它默认连续识别 100 次，可传入 `--iterations 1000` 延长运行；另测冷/热 `prepare`、四标签页并发、20 次取消尝试后恢复（分别记录实际取消和抢先完成次数）、4000×4000 合成图片和缓存关闭后重新命中。报告写入 `apps/extension/dist/product-benchmark/product-benchmark.json`。识别使用正式内置模型 ZIP 和真实 content client → broker → Offscreen → Worker → ORT；缓存阶段使用生产下载器与 IndexedDB，仅通过 localhost 回放下载确认，不访问生产 Key 或模型服务。该基准与原有 transport 矩阵独立，不作为发布证据或 CI 性能门槛。

合成纯白 PNG 只用于固定负载，不能证明识别准确率。报告给出 P50/P95、模型 GET/确认/二进制与元数据写入次数，以及连续识别前后的 CDP 堆快照；未测量的 WASM/网络缓冲峰值和 Port/监听器总数保留为 `null`，不把快照变化解释为泄漏证明。比较候选版本时应使用同一机器、浏览器、模型、迭代数与空闲系统状态。

### Model Worker 命令

```bash
pnpm --filter @hv-pony-solver/model-worker render-config
pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
pnpm --filter @hv-pony-solver/model-worker dev
pnpm --filter @hv-pony-solver/model-worker typecheck
pnpm --filter @hv-pony-solver/model-worker test
pnpm --filter @hv-pony-solver/model-worker build
```

为明确执行本工作区的部署脚本，部署 Model Worker 时必须显式使用：

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```

## 生成精简 ONNX Runtime

生成命令：

```bash
pnpm build:onnx-runtime
```

脚本从固定 ONNX Runtime 提交和 emsdk 版本构建只包含所需算子的 SIMD 运行时。完整中间产物写入 `${ORT_BUILD_ROOT:-$HOME/.cache/hv-pony-ort-v1.27.0}/artifacts`，并把内容寻址 WASM 复制到 `${ORT_RUNTIME_OUTPUT_DIR:-other}`。`ORT_BUILD_ROOT` 会先解析现存祖先目录和符号链接，规范化后的最终目录名必须匹配 `hv-pony-ort-*`，且不得指向文件系统根目录或用户主目录；清理旧构建前会先执行这项门禁并复核目录身份。上游 checkout 必须在开始时完全干净；JS 依赖安装、临时 `build.ts` 补丁和 bundle 生成都发生在 `${ORT_BUILD_ROOT}/js-build` 的一次性副本中，退出或中断后由下一次运行安全重建，并再次验证上游 checkout。专用构建根可复用，但同一时刻只允许一个构建进程持有互斥锁；并发启动会立即失败，未知 untracked 或 tracked 改动仍会阻断：

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
pnpm format:check
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

| 绑定                    | 类型                         | 作用                                                            |
| ----------------------- | ---------------------------- | --------------------------------------------------------------- |
| `MODEL_KEYS`            | Cloudflare KV                | 保存允许访问真实模型的 token 标记                               |
| `MODEL_BUCKET`          | Cloudflare R2                | 保存真实模型、诱饵模型和精简 WASM                               |
| `MODEL_DOWNLOAD_QUOTAS` | SQLite-backed Durable Object | 按规范化 Key 的 SHA-256 标识保存 UTC 月度确认次数与临时下载回执 |

### 运行时变量

| 变量                           | 作用                                         |
| ------------------------------ | -------------------------------------------- |
| `PUBLIC_MODEL_PATH`            | 旧版 ONNX 公开路径，默认 `/yolo26n-640.onnx` |
| `REAL_MODEL_OBJECT_KEY`        | 旧版真实 ONNX 的 R2 对象键，必填             |
| `DECOY_MODEL_OBJECT_KEY`       | 鉴权失败时使用的诱饵对象键，必填             |
| `PUBLIC_ORT_MODEL_PATH`        | 新版 ORT 公开路径，默认 `/yolo26n-640.ort`   |
| `REAL_ORT_MODEL_OBJECT_KEY`    | 新版真实 ORT 的 R2 对象键，默认来自共享契约  |
| `PUBLIC_RUNTIME_WASM_PATH`     | 精简 WASM 公开路径，默认来自共享契约         |
| `RUNTIME_WASM_OBJECT_KEY`      | 精简 WASM 的 R2 对象键，默认来自共享契约     |
| `PUBLIC_QUOTA_PATH`            | Key 月度下载次数查询路径，默认 `/quota`      |
| `INVALID_KEY_MODE`             | 无效 token 策略，只允许 `decoy` 或 `error`   |
| `MODEL_DOWNLOAD_QUOTA_ENABLED` | 是否启用每 Key 月度下载次数限制，默认 `true` |

### 生成 Wrangler 配置

```bash
MODEL_KEYS_KV_NAMESPACE_ID='<kv-namespace-id>' \
MODEL_BUCKET_NAME='<r2-bucket-name>' \
INVALID_KEY_MODE=decoy \
MODEL_DOWNLOAD_QUOTA_ENABLED=true \
pnpm --filter @hv-pony-solver/model-worker render-config

pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
```

部署模式会拒绝测试占位值。`INVALID_KEY_MODE` 和 `MODEL_DOWNLOAD_QUOTA_ENABLED` 省略时使用项目默认策略。

## Model Worker HTTP 契约

### 路由

| 路径                                   | 鉴权         | R2 对象                    | 缓存策略          |
| -------------------------------------- | ------------ | -------------------------- | ----------------- |
| `/yolo26n-640.onnx`                    | Bearer token | 旧版真实模型或诱饵对象     | `no-store`        |
| `/yolo26n-640.ort`                     | Bearer token | 新版真实模型或诱饵对象     | `no-store`        |
| `/quota`                               | Bearer token | 本 Key 的月度下载次数 JSON | `no-store`        |
| `/runtime/ort-wasm-simd-<sha256>.wasm` | 公开         | 精简 WASM                  | 一年、`immutable` |

模型与 Runtime 路由支持的方法：

```text
GET, HEAD, OPTIONS
```

`/quota` 支持 `GET, POST, OPTIONS`：`GET` 查询次数，`POST` 在客户端完成完整性校验和 IndexedDB 缓存后确认一次下载。

- 未知路径返回 `404`。
- 模型和 Runtime 路由不支持的方法返回 `405`，并设置 `Allow: GET, HEAD, OPTIONS`；`/quota` 的 `Allow` 为 `GET, POST, OPTIONS`。
- `HEAD` 返回与 `GET` 一致的响应头，但不返回响应体。
- 模型响应使用 `application/octet-stream` 和 `Cache-Control: no-store`。
- 模型响应的 `Content-Disposition` 文件名取对应公开路径的最后一段；路径以 `/` 结尾时回退到共享清单中的标准文件名。
- WASM 响应使用 `application/wasm` 和 `Cache-Control: public, max-age=31536000, immutable`。
- 文本错误响应使用 `no-store` 和 `X-Content-Type-Options: nosniff`。
- 真实 ONNX、真实 ORT 和公开 Runtime 在返回响应或预留额度前，必须匹配共享清单中的精确 R2 对象长度；若 R2 对象带 SHA-256 元数据，该值也必须匹配。元数据读取异常或任一值漂移时返回通用 `500`。
- `GET /quota` 只读并返回 `enabled`、`limit`、`used`、`remaining` 和 `retryAfterSeconds`，不会消耗次数。
- 真实模型 `GET` 返回临时 `X-HV-Model-Download-Receipt`，但此时不递增次数；客户端读取并校验完整模型、完成 IndexedDB 事务后，才使用同一 Key 和回执调用 `POST /quota`。
- 同一 Key 的 ONNX 与 ORT 缓存确认共用每个 UTC 自然月 5 次额度；重复确认同一回执是幂等的，未完成或已失效的回执不计数。`HEAD`、`OPTIONS`、诱饵模型和 Runtime 不计数。`MODEL_DOWNLOAD_QUOTA_ENABLED=false` 时不执行额度限制，也不递增计数；此时格式正确的 `POST /quota` 返回 `409`，不会伪造一次成功确认，缺失或畸形回执仍返回 `400`。

### 响应矩阵

| 请求或情况                                                                           | HTTP 契约                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中  | `200` 真实模型，模型响应使用 `Cache-Control: no-store` 并返回临时回执；`GET /yolo26n-640.ort` 使用相同契约                                                                           |
| `GET /quota` 携带有效 Bearer token                                                   | `200` JSON 额度状态；只报告已确认的缓存下载，不消耗下载次数                                                                                                                          |
| `POST /quota` 携带有效 Bearer token 和 `X-HV-Model-Download-Receipt`                 | 有效待确认回执返回 `200` 并将该 Key 的已用次数递增一次；重复提交已确认回执仍返回 `200` 且不重复计数，失效、未知回执或额度限制已关闭时返回 `409`；缺失或畸形回执返回 `400`            |
| `HEAD /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中 | `200`，只读取 R2 元数据且不返回响应体；`HEAD /yolo26n-640.ort` 使用相同契约                                                                                                          |
| `OPTIONS /yolo26n-640.onnx`                                                          | `204` preflight，`Access-Control-Allow-Methods: GET, HEAD, OPTIONS`，`Access-Control-Allow-Headers: Authorization`；`OPTIONS /yolo26n-640.ort` 使用相同策略，预检缓存上限为 86400 秒 |
| `OPTIONS /quota`                                                                     | `204` preflight，`Access-Control-Allow-Methods: GET, POST, OPTIONS`，`Access-Control-Allow-Headers: Authorization, X-HV-Model-Download-Receipt`，预检缓存上限为 86400 秒             |
| `OPTIONS /runtime/ort-wasm-simd-<sha256>.wasm`                                       | `204` preflight，`Access-Control-Allow-Methods: GET, HEAD, OPTIONS`，`Access-Control-Allow-Origin: *`，不声明允许的请求头，预检缓存上限为 86400 秒                                   |
| 非 `GET` / `HEAD` / `OPTIONS` 方法                                                   | 模型路由返回 `405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`                                                                                                                   |
| 同一 Key 当月已确认 5 次后再次请求真实模型                                           | `429 Too Many Requests`，包含到下个 UTC 月的 `Retry-After`，并通过 `Access-Control-Expose-Headers` 暴露该响应头                                                                      |
| 同一 Key 已占满 5 个待确认/已确认槽位，但仍有未失效回执                              | `503 Service Unavailable`，`Retry-After` 指向最早待确认回执的失效时间；避免并发请求越过硬上限                                                                                        |
| 选中的 R2 object 缺失                                                                | `500 Internal Server Error`                                                                                                                                                          |
| 真实模型或 Runtime 的 R2 长度漂移、已记录的 SHA-256 漂移                             | `500 Internal Server Error`；不返回对象内容，真实模型不会预留额度                                                                                                                    |

启用额度限制时，真实模型 `GET` 先查询已确认额度；已耗尽则直接返回 `429`，查询失败返回 `503`，两者都不读取 R2 对象。通过预检后才读取并校验对象，再原子预留回执，最终预留仍决定是否允许下载。该预检为允许下载的请求增加一次额度查询，不能提前判断待确认槽位是否占满。

通过额度预检后，选中的 R2 object 缺失或完整性元数据不符合共享清单时不会回退到其他对象；真实模型在此阶段不会预留额度。

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

Worker 总是检查 R2 对象的精确长度。Cloudflare R2 只有在上传时记录了 SHA-256 才会通过对象元数据暴露该值；为兼容既有对象，缺少该元数据不会单独拒绝响应，但只要存在就必须匹配共享清单。客户端仍会对实际下载字节执行精确长度和 SHA-256 校验，因此上传新对象时应保留 SHA-256 元数据，并在发布前用 canonical 文件复核实际内容。

## 部署 Model Worker

本地部署流程：

```bash
MODEL_KEYS_KV_NAMESPACE_ID='<kv-namespace-id>' \
MODEL_BUCKET_NAME='<r2-bucket-name>' \
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

ONNX Runtime 资产由 `ONNX_RUNTIME_ASSETS` 统一描述，其中 `externalFullRuntime` 对应默认外置完整版，`bundledMinimalRuntime` 对应显式内置精简版。默认外置 JS 使用 `externalFullRuntime.byteLength`、`externalFullRuntime.sha256` 和 `externalFullRuntime.maxByteLength`；默认外置 WASM 使用 `externalFullRuntime.wasmByteLength`、`externalFullRuntime.wasmSha256` 和 `externalFullRuntime.wasmMaxByteLength`；构建 glue 使用 `bundleAsset.byteLength`、`bundleAsset.sha256` 和 `bundleAsset.maxByteLength`；首方 WASM 使用 `wasmAsset.url`、`wasmAsset.byteLength`、`wasmAsset.sha256` 和 `wasmAsset.maxByteLength`。相关入口为 `build:onnx-runtime` 与 `verify:onnx-runtime`。

`architecture:check` 保护关键依赖边界：`inferenceTimeoutConfig` 继续集中管理异步超时，`StatusPanel` 继续负责 UI 状态输出，`Model Worker Core` 继续与 Userscript 浏览器代码隔离。

准备好[本地测试绑定](#环境要求)后，推荐的定向检查顺序如下；提交前使用 `mise exec -- pnpm check` 执行包含扩展打包、覆盖率和全仓构建的完整门禁：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:check
pnpm architecture:check
pnpm browser-sinks:check
pnpm bundle:check
pnpm verify:onnx-runtime
```

仅修改文档时，使用对应的文档验证即可：

```bash
mise exec -- pnpm format:check
mise exec -- pnpm docs:check
mise exec -- node --test "scripts/docs-drift/test/*.test.mjs"
git diff --check
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

- 通过固定 commit SHA 的 `jdx/mise-action` 安装 `mise.toml` 声明的 Node.js `24.15.0` 和 pnpm `12.3.0`，保留 pnpm store 缓存并执行冻结依赖安装。
- 检查外部 GitHub Action 是否固定到完整 commit SHA，要求 Docker Action 使用完整 `sha256` digest，并强制每个 `actions/checkout` 设置 `persist-credentials: false`。
- 依赖审计、第一方格式检查、ESLint 和 TypeScript 类型检查。
- JavaScript/TypeScript CodeQL 扫描，并在 Pull Request 中执行依赖审查。
- 文档漂移与本地链接、架构边界和浏览器危险调用检查。
- 工作区及根级 `scripts/**/*.test.mjs` 测试，以及工作区覆盖率；递归覆盖率命令不包含根级测试。
- 默认外部 profile 构建及 `256 KiB` 预算。
- 显式内置 profile 构建及 `1 MiB` 预算。
- Pull Request 和 `main` push 执行用户脚本 Playwright Chromium E2E；手动运行由 `run_userscript_e2e` 控制。
- 扩展 job 只构建一次远程产物并复用于有界 transport 基准与 Chromium/Firefox 加载检查；Release 直接下载并发布这份已测试产物，不再二次构建；另执行内容脚本、内置模型双浏览器推理及 Chromium 116/Firefox 140 精确最低版本门禁。
- 受仓库变量和受保护环境控制的真实远程模型与 canonical 内置模型门禁；缺少生产配置时明确跳过，不能冒充已验证。
- 手动选择 `publish_userscript_artifact`、`publish_extension_artifact` 或 `publish_extension_release` 时执行对应发布门禁；三个选项默认都关闭。
- 同一 workflow/event/ref 的新自动 CI 会取消旧运行；手动制品/发布运行与 push 使用不同并发组，彼此串行且不会被 push 抢占；每个 job 都有独立超时，避免浏览器、网络或发布门禁永久占用 runner。

普通 push 和 Pull Request 不创建 GitHub Release，也不发布生产扩展 artifact。

### Model Worker 部署工作流

`.github/workflows/deploy-cloudflare-model-worker.yml` 仅支持从 `refs/heads/main` 手动触发生产 job；其他 ref 的 job 会在读取受保护 secrets 前跳过：

- Cloudflare secrets 完整时，默认只渲染配置、执行检查并运行 Wrangler dry-run，不执行部署。
- Cloudflare secrets 不完整且 `publish_model_worker=false` 时，工作流仍执行 typecheck 与测试，但会安全跳过配置渲染、Wrangler dry-run 和部署；若已经请求发布则 fail closed。
- 手动输入 `enable_model_download_quota` 控制是否启用每 Key 月度下载限制，默认开启；关闭后模型请求不受 5 次限制，额度查询会提示限制未开启。
- 整个 job 绑定 `production-model-worker` GitHub Environment；在 `refs/heads/main` 上只有 `publish_model_worker=true`、环境审批通过且所需 secrets 完整时才实际部署。
- 工作流不自动运行线上公开契约探测；部署完成只证明 Wrangler 发布命令成功。等待边缘传播后，由操作者按 [`docs/model-worker-ops.md`](docs/model-worker-ops.md) 手动执行 `check:deployment`。

dry-run 成功只证明 Wrangler 可以生成部署包，不证明 Cloudflare 已更新，也不证明 R2、KV 或线上路由正确。

## 安全边界

- 不要把模型 token 写入 URL、日志、README、构建产物或公开配置。
- 查询字符串密钥不会授权真实模型。
- `@connect` 和 CORS 只允许网络访问，不代替 token 鉴权。
- 默认外部 profile 对 jsDelivr `ort.min.js` 和完整版 WASM 都拒绝重定向，只接受可流式读取的响应正文，并校验最大长度、精确长度和 SHA-256；只有两项都通过后才执行 JS 并注入 WASM 字节。
- 内置 profile 对首方精简 glue 和 WASM 执行固定资产身份与内容完整性校验。
- 扩展产物不加载远程 JS/WASM；ORT glue、module Worker 和内容寻址 WASM 均随包分发。远程 `.ort` 下载和包内 `.ort` 都按固定长度与 SHA-256 校验；包内模型不加密，也不具备机密性。
- 扩展内容脚本不接收模型 Key 或模型字节。远程版本只有设置页可发起 Key 验证和模型下载请求；内置版本不构建 Key 存储、验证或远程下载能力。
- 验证码图片为兼容扩展 JSON 消息边界继续使用有上限的 Base64；模型从 Host 以可转移的二进制 `ArrayBuffer` 交给推理 Worker，初始化后由 Worker 转回同一所有权供缓存。单消费者路径不复制整份模型，并发消费者各自取得独立缓冲区，避免一个 Worker 的 transfer detach 另一个缓存调用的字节；模型不使用 Base64 或分片。
- 模型和 WASM 的 R2 对象必须与共享清单中的长度和 SHA-256 一致；Worker 在响应前强制检查长度，并在 R2 提供 SHA-256 元数据时强制比对，客户端继续校验实际响应字节。
- 日志不得记录原始 Key、规范化 Key、配额对象标识或配额状态。已鉴权的 `/quota` 响应按公开 schema 返回额度状态，不回显 Key 或内部对象标识。
- `decoy` 模式的未鉴权 `200` 不表示真实模型泄漏。
- `HEAD` 请求不计配额，且 decoy 响应头的 `Content-Length` 与 `ETag` 来自诱饵对象，与真实对象不同；叠加公开的真实模型 SHA-256，构成可区分有效与无效 Key 的探测面。这是当前接受的权衡，缓解方向记录在 [`docs/model-worker-ops.md`](docs/model-worker-ops.md) 的「待办运维项」。
- 部署检查、静态测试和浏览器 E2E 分别证明不同边界，不能相互替代。

## 故障排查

### pnpm 版本不匹配

```bash
mise install
mise exec -- node --version
mise exec -- pnpm --version
mise exec -- pnpm install --frozen-lockfile
```

项目固定 pnpm `12.3.0`。使用 `mise exec -- pnpm` 可明确选择仓库版本；若直接执行 `pnpm` 仍命中其他版本，请检查当前 shell 的 mise 激活配置。

### 默认构建无法加载 ONNX Runtime

确认用户脚本管理器和网络允许访问：

```text
cdn.jsdelivr.net
```

默认 profile 没有内置回退。若错误提示运行时大小或 SHA-256 校验失败，应先确认两个固定 URL 都未重定向，JS 实际解压字节匹配 `externalFullRuntime.byteLength` 与 `externalFullRuntime.sha256`，WASM 实际字节匹配 `externalFullRuntime.wasmByteLength` 与 `externalFullRuntime.wasmSha256`；不要放宽对应 `maxByteLength` 或 `wasmMaxByteLength` 上限，也不要跳过校验。需要绕过完整版 CDN 时，应改用显式内置构建；内置构建仍需要访问 `models.ngnl.host` 下载精简 WASM 和 `.ort` 模型。

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

### 页面显示“答案控件不可用”

这表示识别已到达答题阶段，但保存的表单控件快照不满足安全点击条件。依次检查：

- 当前表单和提交按钮仍连接在页面中，且 `submit.form` 指向该表单；
- 表单的解析后提交地址仍与识别开始时一致，并且是同源地址；
- 页面存在同一表单下的 6 个答案 checkbox；
- 每个 checkbox 仍连接、`checkbox.form` 指向同一表单且没有 `disabled`；
- 没有同时启用用户脚本版和扩展版；
- 离线保存的 HTML 是否缺少原页面脚本生成的关联状态。网页存档可以用于复现 DOM 解析，但不保证表单控件与在线页面具有相同可用状态。

当前版本对同一验证码失败冷却 30 秒；冷却期内的 MutationObserver 刷新不会新增同类记录。如果日志在毫秒级持续出现，先确认浏览器实际加载的是扩展 `0.1.1` 的完整新构建，而不是旧 ZIP、旧解压目录或用户脚本与扩展的双重实例。

### 扩展额度查询或模型下载报错

- 先确认远程模型版已保存有效 Key；内置模型版会禁用这些按钮。
- “查询下载次数”不消耗额度；“下载模型”只有在完整校验并提交 IndexedDB 缓存后才确认一次使用。
- `HTTP 429` 表示该 Key 本 UTC 月已确认用完 5 次；`HTTP 503` 还可能表示临时回执槽位占满或额度服务不可用，两者不能混为一谈。
- “连接已断开”是扩展后台 Port 未返回结果，不等同于 Worker 返回额度耗尽。额度查询会自动重连一次，仍失败时保留第二次的真实浏览器错误。
- `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation` 通常表示仍在运行旧版或混合构建文件；重新构建并完整替换解压目录后重新加载扩展，不要只覆盖单个 JavaScript 文件。

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
pnpm --filter @hv-pony-solver/userscript build:bundled-runtime
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

- [文档导航](docs/README.md)：按维护任务查找架构、开发和审计资料。
- [整体架构](docs/architecture/overview.md)：工作区依赖、平台差异、数据所有权和权威模块。
- [开发与验证](docs/development/verification.md)：本地工具链、定向测试、CI 命令和证据边界。
- [目录组织与维护](docs/development/directory-layout.md)：当前脚本分组、模块职责及后续迁移检查。
- [代码风格与注释](docs/development/contributing.md)、[文档维护](docs/development/documentation.md)：日常修改与文档联动规则。
- [审计优化实施记录](docs/development/implementation-plan.md)：目录迁移、模块拆分、门禁补强与验证结果。
- [2026-09-07 仓库审计](docs/audits/2026-09-07-repository-audit.md)：全仓盘点、优化优先级与本次验证范围。
- [`docs/onnx-runtime.md`](docs/onnx-runtime.md)：精简运行时资产、哈希和复现说明。
- [`docs/browser-extension.md`](docs/browser-extension.md)：扩展架构、权限、构建、加载、存储和验证边界。
- [`docs/model-cache-strategy.md`](docs/model-cache-strategy.md)：浏览器缓存、Worker `no-store` 与下载确认计次策略。
- [`docs/model-worker-ops.md`](docs/model-worker-ops.md)：Model Worker 运维和线上验收矩阵。

本文档中的命令、URL、对象键和哈希属于代码契约。修改相关实现时必须同步测试和文档漂移规则。
