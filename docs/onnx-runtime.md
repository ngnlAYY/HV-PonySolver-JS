# 精简 ONNX Runtime Web

最后复核：2026-08-25。

当前用户脚本只使用 ORT 格式模型；既有旧版用户脚本仍请求 legacy ONNX 路径。Model Worker 同时保留两个精确路由，不重定向，也不自动协商格式。浏览器扩展始终随包分发精简 glue 和 WASM，不使用本页所述的用户脚本运行时 profile 切换。

## 用户脚本运行时 profile

默认 `build` profile 不内置 ONNX Runtime。Blob Worker 从下列固定版本 URL 加载官方完整版浏览器运行时，配置一个 WASM 线程，并且不会回退到精简运行时：

- `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js`
- `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/`

显式 `build:bundled-runtime` profile 内置项目构建的精简 JS glue。其 Worker 只从 `models.ngnl.host` 下载内容寻址的精简 WASM，校验字节长度和 SHA-256 后赋给 `ort.env.wasm.wasmBinary`。两个 profile 使用同一份远程 ORT 模型和 WASM Execution Provider；运行时与模型格式都没有自动回退。

## 精简运行时构建身份

运行时基于 ONNX Runtime `v1.27.0` 的提交 `8f0278c77bf44b0cc83c098c6c722b92a36ac4b5` 构建，并固定 Emscripten SDK `4.0.23`：

- basic minimal ORT 格式支持；
- 仅 CPU/WASM Execution Provider；
- WebAssembly SIMD、单线程；
- 不包含 JSEP、WebGPU、WebNN、training、ML operators、RTTI 或 exceptions；
- 从 `model/yolo26n-640.onnx` 生成精简算子与元素类型配置。

对应 Emscripten glue 只由用户脚本 `build:bundled-runtime` 内置；扩展构建器会复制并审计同一对 glue/WASM 资产。

## R2 资产

上传时必须使用下列精确字节。若 WASM 内容发生变化，文件名、URL、对象键、长度和哈希必须作为一个原子契约更新：

| Request path                                                                                   | R2 object key                                                                                 |      Size | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `/yolo26n-640.ort`                                                                             | `real/yolo26n-640.ort`                                                                        | 9,914,448 | `4e771776d9356679539ffed53ee40ea012394f9b586aa92a76267e8fee38094c` |
| `/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | 1,267,937 | `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa` |

ORT 路由与 legacy ONNX 路由使用相同的 Bearer/KV 鉴权、诱饵策略和下载确认计次协议。WASM 路由公开、只匹配精确路径，并返回一年 immutable 缓存。

## 复现与安装

运行：

```bash
pnpm build:onnx-runtime
```

脚本执行以下输出：

- 完整中间产物写入 `${ORT_BUILD_ROOT:-$HOME/.cache/hv-pony-ort-v1.27.0}/artifacts`；
- 内容寻址 WASM 复制到 `${ORT_RUNTIME_OUTPUT_DIR:-other}`；
- 终端打印可直接使用的 `runtime/<filename>` R2 对象键和全部产物哈希。

命令不会上传 R2、部署 Worker 或发布客户端。`pnpm build:onnx-runtime -- --install` 还会替换受版本控制的 `apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs`，并重新生成被 Git 忽略的 `config/onnxruntime/required_operators_and_types.config`。采用新输出前必须有意更新 `ONNX_RUNTIME_ASSETS`、共享 Runtime 清单、Worker 模板、扩展构建审计、测试和文档，随后运行：

```bash
corepack pnpm verify:onnx-runtime
corepack pnpm docs:check
corepack pnpm --filter @hv-pony-solver/extension test
```
