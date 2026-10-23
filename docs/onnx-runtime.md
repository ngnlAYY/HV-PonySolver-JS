# 模型与 ONNX Runtime 资产

本页维护格式、Runtime profile、字节身份和复现步骤。安装见[用户脚本指南](usage/userscript.md)和[扩展指南](browser-extension.md)；公开资产清单用于拒绝损坏或替换内容。

## 模型格式与兼容关系

| 客户端                     | 模型路径                | 行为                                   |
| -------------------------- | ----------------------- | -------------------------------------- |
| 当前用户脚本、远程模型扩展 | `/yolo26n-640.ort`      | Bearer 鉴权下载，浏览器本地推理        |
| 内置模型扩展               | `model/yolo26n-640.ort` | 固定包内模型，无 Key                   |
| 旧用户脚本                 | `/yolo26n-640.onnx`     | 保留旧路径，不在新客户端探测或回退格式 |

当前 ORT URL 是 `https://models.ngnl.host/yolo26n-640.ort`，内置构建输入固定为仓库根 `model/yolo26n-640.ort`。`MODEL_VERSION` 为 `yolo26n-640-2026-05-14`；旧 ONNX 和对应 ORT 必须从同一导出一起再生。文件名、路径、R2 对象键、长度和 SHA-256 原子更新，精确值集中在下文 [R2 资产](#r2-资产)。

## ONNX Runtime 构建模式

profile 只由用户脚本构建命令选择，不自动回退；扩展始终随包分发精简 glue 和 WASM。

| 项目     | 默认外部完整版                     | 显式内置精简版                      |
| -------- | ---------------------------------- | ----------------------------------- |
| profile  | `external` / `externalFullRuntime` | `bundled` / `bundledMinimalRuntime` |
| 构建命令 | `build`                            | `build:bundled-runtime`             |
| JS/MJS   | 下载并校验固定 jsDelivr 资产       | 构建时内置已校验 glue               |
| WASM     | 下载并校验 jsDelivr 完整版         | 下载并校验首方内容寻址文件          |
| 包体预算 | `256 KiB`                          | `1 MiB`                             |

根 `bundle:check` 校验默认 profile 的**未压缩**产物，压缩发布包不能代替此门禁；两种 profile 分别验证。

### 默认外部完整版

`onnxruntime-web@1.27.0` 的四个定位字段固定为：

```text
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.mjs
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.wasm
```

| `ONNX_RUNTIME_ASSETS` 字段              | 值                                                                 |
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

推理 Worker 用 `redirect: error` 并行下载 JS/MJS/WASM，三者的声明大小、实际长度与 SHA-256 全部通过后才创建 Blob URL。classic JS 由 `importScripts()` 执行后立即撤销；MJS 交给 `wasmPaths.mjs`，已校验 WASM 通过 `wasmBinary` 注入，不让 ORT 另行下载辅助文件。

MJS 交接前失败立即撤销；交接后由 `onFirstSessionInitSettled` 在首次 `InferenceSession.create` 成功或失败时撤销一次。启动最多暂存两个请求，失败后拒绝已排队及后续请求。运行时固定 `numThreads=1`、`proxy=false`、WASM Execution Provider；CDN 或完整性错误不会切换到精简版。

### 显式内置精简版

构建前校验并内置 `apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs`：

| 字段                        | 值                                                                 |
| --------------------------- | ------------------------------------------------------------------ |
| `bundleAsset.byteLength`    | `56,993`                                                           |
| `bundleAsset.sha256`        | `a63d4f08e70220c0f721fabfd4e4b958aa127334a19038b2732d07e919f32554` |
| `bundleAsset.maxByteLength` | `96,000`                                                           |
| `wasmAsset.maxByteLength`   | `2,000,000`                                                        |

`wasmAsset.url` 固定为：

```text
https://models.ngnl.host/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm
```

`wasmAsset.byteLength`、`wasmAsset.sha256` 与下方 R2 WASM 行一致。下载使用 `cache: force-cache`、`redirect: error`，校验失败终止初始化，不回退完整版。glue 不含 WASM，二者必须配对更新；扩展使用相同配对，但 WASM 从包内读取。

完整 [MIT 许可](../apps/userscript/vendor/onnxruntime/LICENSE)取自固定上游提交。bundled 用户脚本与两种模式的扩展将其作为推理 Worker 的 banner 保留，压缩构建也不得删除；默认 external 用户脚本不额外内嵌这份许可。该声明不修改 vendor glue/WASM 的字节或哈希，也不增加扩展包根文件。

### 精简运行时供应链

| 字段              | 固定值                                                             |
| ----------------- | ------------------------------------------------------------------ |
| npm 包            | `onnxruntime-web@1.27.0`                                           |
| ONNX Runtime 提交 | `8f0278c77bf44b0cc83c098c6c722b92a36ac4b5`                         |
| emsdk             | `4.0.23`                                                           |
| 算子配置 SHA-256  | `2abe2e2987496ab518de97a7f4b157cec1bd1817c621d3523073034fb47591fe` |

权威清单是 [ONNX_RUNTIME_ASSETS](../apps/userscript/src/inference/onnx-runtime-assets.ts)。精简构建为 CPU/WASM、SIMD、单线程和 basic minimal ORT 格式支持，不含 JSEP、WebGPU、WebNN、training、ML operators、RTTI 或 exceptions。算子/元素类型由固定 `model/yolo26n-640.onnx` 生成；`config/onnxruntime/required_operators_and_types.config` 为被忽略的可再生产物。

Python 转换工具单独维护于 [requirements.in](../scripts/ort-runtime/requirements.in) 和带哈希的 [requirements.txt](../scripts/ort-runtime/requirements.txt)：ONNX `1.22.0`、ONNX Runtime `1.27.0`，bootstrap pip `26.2.0`。两个生成入口都使用精确 pip 版本及 `--require-hashes`。Python 工具升级不自动替换已采用的模型/glue/WASM；重新生成后仍按固定字节身份与转换结果验收。

## 复现与采用

在仓库根目录执行：

```bash
mise exec -- pnpm build:onnx-runtime
```

中间产物写入 `${ORT_BUILD_ROOT:-$HOME/.cache/hv-pony-ort-v1.27.0}/artifacts`，内容寻址 WASM 复制到 `${ORT_RUNTIME_OUTPUT_DIR:-other}`，当前为：

```text
other/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm
```

构建目录与清理必须满足：

- 解析现存祖先与符号链接后，`ORT_BUILD_ROOT` 末级名匹配 `hv-pony-ort-*`；拒绝文件系统根、仓库内目录，以及等于或包含仓库、启动 cwd、home 的目录。
- 每次递归清理重新核对构建根身份和目标规范路径，目标必须位于专用根内，不能覆盖受保护目录。cwd 保护值在启动时固定。
- 上游 checkout 开始/结束均须干净；依赖安装、临时 `build.ts` 修改与 bundle 生成位于一次性 `js-build` 副本。下次运行可安全重建；未知 tracked/untracked 改动阻断构建。
- 专用根可复用，但同一时刻只允许一个构建进程持锁。对已验证的构建根目录只读描述符加 `flock` 并复核目录身份，不创建或截断 `.build.lock`；遗留同名符号链接不能影响目录外文件或绕开互斥。

脚本不上传 R2、部署服务或发布客户端。采用新产物须同步 glue、`ONNX_RUNTIME_ASSETS`、shared 的模型/WASM 身份、`wrangler.template.toml`、测试、文档和 R2 对象；完整路径见下方清单链接。

### 安装生成的 glue

明确采用时执行 `mise exec -- pnpm build:onnx-runtime -- --install`，替换受版本控制的 glue 并生成被忽略的算子配置。随后先准备[测试绑定](development/verification.md#model-worker-测试配置)，再验证：

```bash
mise exec -- pnpm verify:onnx-runtime
mise exec -- pnpm check
```

用户脚本两种 profile 和扩展构建的受影响浏览器验证按[验证手册](development/verification.md)执行；本地校验不能代替上传后的验收。

## 清单字段与模型验证

[model.ts](../packages/shared/src/model.ts) 的 `MODEL_VERSION`、`MODEL_INTEGRITY.byteLength`、`MODEL_INTEGRITY.sha256` 描述旧 ONNX；[ort-model.ts](../packages/shared/src/ort-model.ts) 描述对应 ORT；[ort-runtime.ts](../packages/shared/src/ort-runtime.ts) 描述精简 WASM；[ort-assets.ts](../packages/shared/src/ort-assets.ts) 组合路径与对象键。外部 JS/MJS/WASM 和 glue 由 `ONNX_RUNTIME_ASSETS` 管理。图片、输出和超时参数见[浏览器运行时](architecture/browser-runtime.md)。

构建与文档工具用 TypeScript AST 读取完整清单 initializer，不执行源码。模型完整性字段须为直接、唯一的字面量属性；Runtime 清单须为静态对象。拒绝会覆盖身份的 spread、computed key、getter、重复字段或后缀运算，不能把合法前缀误当作实际资产值。

用户脚本 Runtime 的 `Content-Length` 若存在，必须是规范十进制非负安全整数且不超上限；空值、符号、前导零、指数、十六进制和小数均拒绝。该头描述编码后的大小，不能直接等同 fetch 解压后的字节长度；无论 Content-Encoding 是否被 CORS 暴露，实际正文都须通过精确长度和 SHA-256 校验。缺长度头仍允许有界读取。

资产只接受可流式正文；`body === null` 时失败，不回退无界 `arrayBuffer()`。已知长度预分配，未知长度按需倍增并即时复制分块，不保留分块数组或外部大缓冲。取消、超限或长度异常时发起 reader 取消并释放锁，不等待取消 Promise，清理错误不覆盖原始错误；失败内容不入缓存。

旧 ONNX 可用 `MODEL_FILE` 指定本地文件运行 `verify-model-integrity`；ORT 由客户端下载器与内置扩展构建按 shared 清单验证：

```bash
MODEL_FILE=/path/to/yolo26n-640.onnx \
mise exec -- pnpm --filter @hv-pony-solver/userscript verify-model-integrity
```

## R2 资产

以下为当前精确身份；ONNX 对象键可由 Worker 模板配置，其默认值列在表中。WASM 改动必须连同文件名、URL、对象键和完整性字段一起采用。

| Request path                                                                                   | R2 object key                                                                                 |  字节长度 | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `/yolo26n-640.onnx`                                                                            | `real/yolo26n-640.onnx`                                                                       | 9,809,075 | `318e96a0c32202fea2f4c0aed6010f5ba4a13952f5206a9b1cddc9a4fcf1f070` |
| `/yolo26n-640.ort`                                                                             | `real/yolo26n-640.ort`                                                                        | 9,914,448 | `4e771776d9356679539ffed53ee40ea012394f9b586aa92a76267e8fee38094c` |
| `/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | 1,267,937 | `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa` |

上传命令见[运维手册](model-worker-ops.md#r2-上传清单)。Worker 检查精确 R2 长度和已有 SHA-256 元数据，缺 SHA 元数据兼容旧对象；浏览器仍校验实际字节。鉴权、确认计次与公开 WASM 缓存分别遵循 [HTTP 契约](reference/model-worker-http.md)。
