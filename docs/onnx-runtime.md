# 模型与 ONNX Runtime 资产

本文是模型格式、运行时 profile、字节身份和复现步骤的维护入口。普通安装见[用户脚本指南](usage/userscript.md)与[扩展指南](browser-extension.md)。公开资产清单不是秘密；它用于拒绝损坏或被替换的内容。

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

| 项目         | 默认外部完整版                               | 显式内置精简版                          |
| ------------ | -------------------------------------------- | --------------------------------------- |
| profile 名称 | `external`                                   | `bundled`                               |
| 构建命令     | `build`                                      | `build:bundled-runtime`                 |
| JS 运行时    | 下载并校验 jsDelivr `ort.min.js` 与 JSEP MJS | 构建时内置精简 glue                     |
| WASM         | 下载并校验 jsDelivr 完整版 WASM              | 从 `models.ngnl.host` 下载内容寻址 WASM |
| 内容校验     | JS/MJS/WASM 最大长度、精确长度和 SHA-256     | WASM 最大长度、精确长度和 SHA-256       |
| 自动回退     | 无                                           | 无                                      |
| 包体预算     | `256 KiB`                                    | `1 MiB`                                 |

根 `bundle:check` 对不带 `--minify` 的默认 profile 产物执行 `256 KiB` 门禁；显式压缩的发布构建不能替代这项未压缩门禁。

### 默认外部完整版

默认构建使用固定版本的 ONNX Runtime Web `1.27.0`：

```text
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.mjs
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.wasm
```

默认 JS 运行时还固定以下原子契约：

| 字段                                    | 值                                                                 |
| --------------------------------------- | ------------------------------------------------------------------ |
| `externalFullRuntime.byteLength`        | `360,434`                                                          |
| `externalFullRuntime.sha256`            | `de1beb9d172dbda72e56fa2f430c8e4477e97908609859ab47f89fc3e034a8d5` |
| `externalFullRuntime.maxByteLength`     | `400,000`                                                          |
| `externalFullRuntime.mjsByteLength`     | `46,614`                                                           |
| `externalFullRuntime.mjsSha256`         | `3ee381d20a80f51a788a1c4a5872f6f1d047538dd4342f4af00062de5f9ea4c6` |
| `externalFullRuntime.mjsMaxByteLength`  | `64,000`                                                           |
| `externalFullRuntime.wasmByteLength`    | `26,827,543`                                                       |
| `externalFullRuntime.wasmSha256`        | `78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48` |
| `externalFullRuntime.wasmMaxByteLength` | `30,000,000`                                                       |

ONNX 推理 Worker 以 `redirect: error` 并行下载 `ort.min.js`、JSEP MJS 和完整版 WASM，分别限制声明/实际大小，并对解压后的实际字节执行精确长度与 SHA-256 校验；只有三项都校验成功后才创建临时 Blob URL。classic JS 通过 `importScripts()` 同步执行并立即撤销 URL；JSEP MJS URL 交给 `wasmPaths.mjs`，已验证 WASM 则通过 `wasmBinary` 注入。MJS URL 在交接前失败时立即撤销，交接后由 `onFirstSessionInitSettled` 在首次 `InferenceSession.create` 成功或失败后只撤销一次。启动期间最多暂存两个请求，失败后立即拒绝已排队及后续请求。运行时随后设置：

- `numThreads = 1`
- `proxy = false`
- WASM Execution Provider

该模式不会下载项目生成的精简 WASM，也不会在 CDN 或完整性校验失败时切换到内置精简版。远程 classic JS、JSEP MJS 和完整版 WASM 都由固定字节身份保护，ORT 不再自行按目录路径下载未验证的辅助模块或 WASM。

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

精简构建只包含 CPU/WASM Execution Provider、SIMD 和单线程，使用 basic minimal ORT 格式支持；不包含 JSEP、WebGPU、WebNN、training、ML operators、RTTI 或 exceptions。算子与元素类型配置从固定 `model/yolo26n-640.onnx` 生成。

## 复现与采用

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

### 安装生成的 glue

在明确采用新产物时运行 `mise exec -- pnpm build:onnx-runtime -- --install`，替换受版本控制的 glue，并生成被 Git 忽略的算子配置。只生成产物时不传 `--install`。仓库、cwd、home 本身及其祖先目录均不得作为递归清理输出。

## 清单字段与模型验证

图片预处理、结果过滤和推理超时参数见[浏览器运行时](architecture/browser-runtime.md)。本文维护模型和 WASM 的资产身份及构建契约。

旧版 ONNX 模型清单由 `MODEL_VERSION`、`MODEL_INTEGRITY.byteLength` 和 `MODEL_INTEGRITY.sha256` 组成。`MODEL_FILE` 指定本地校验文件，`verify-model-integrity` 执行字节长度和 SHA-256 校验。新版 ORT 使用独立的共享资产清单，不覆盖旧版契约。

ONNX Runtime 资产由 `ONNX_RUNTIME_ASSETS` 统一描述，其中 `externalFullRuntime` 对应默认外置完整版，`bundledMinimalRuntime` 对应显式内置精简版。默认外置 classic JS 使用 `externalFullRuntime.byteLength`、`externalFullRuntime.sha256` 和 `externalFullRuntime.maxByteLength`；默认外置 JSEP MJS 使用 `externalFullRuntime.mjsByteLength`、`externalFullRuntime.mjsSha256` 和 `externalFullRuntime.mjsMaxByteLength`；默认外置 WASM 使用 `externalFullRuntime.wasmByteLength`、`externalFullRuntime.wasmSha256` 和 `externalFullRuntime.wasmMaxByteLength`；构建 glue 使用 `bundleAsset.byteLength`、`bundleAsset.sha256` 和 `bundleAsset.maxByteLength`；首方 WASM 使用 `wasmAsset.url`、`wasmAsset.byteLength`、`wasmAsset.sha256` 和 `wasmAsset.maxByteLength`。相关入口为 `build:onnx-runtime` 与 `verify:onnx-runtime`。

所有资产只接受可流式读取的响应正文；`body === null` 时失败关闭，不退回无界 `arrayBuffer()`。共享有界读取原语对已知长度预分配缓冲区，避免同时保留全部分块和完整 WASM；取消、超限或长度不符时释放 reader。完整性错误不写入缓存。

旧 ONNX 的本地校验使用以下命令；当前 ORT 则由扩展内置构建及下载器按各自共享清单检查。

```bash
MODEL_FILE=/path/to/yolo26n-640.onnx \
mise exec -- pnpm --filter @hv-pony-solver/userscript verify-model-integrity
```

模型与 WASM 的共享完整性清单见 [ort-assets.ts](../packages/shared/src/ort-assets.ts)、[ort-model.ts](../packages/shared/src/ort-model.ts)、[ort-runtime.ts](../packages/shared/src/ort-runtime.ts)；外部 JS/MJS/WASM 和 glue 清单见 [ONNX_RUNTIME_ASSETS](../apps/userscript/src/inference/onnx-runtime-assets.ts)。Worker 对对象元数据的检查范围见 [HTTP 契约](reference/model-worker-http.md)。

## R2 资产

上传时必须使用下列精确字节。若 WASM 内容发生变化，文件名、URL、对象键、长度和哈希必须作为一个原子契约更新：

| Request path                                                                                   | R2 object key                                                                                 |      Size | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `/yolo26n-640.ort`                                                                             | `real/yolo26n-640.ort`                                                                        | 9,914,448 | `4e771776d9356679539ffed53ee40ea012394f9b586aa92a76267e8fee38094c` |
| `/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | 1,267,937 | `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa` |

ORT 路由与 legacy ONNX 路由使用相同的 Bearer/KV 鉴权、诱饵策略和下载确认计次协议。WASM 路由公开、只匹配精确路径，并返回一年 immutable 缓存。Worker 在返回真实 ONNX、真实 ORT 或公开 WASM 前强制比对共享清单中的 R2 对象长度；R2 若提供 SHA-256 元数据也必须匹配。缺少 SHA-256 元数据为兼容既有对象可以通过，但客户端仍会校验实际响应字节。
