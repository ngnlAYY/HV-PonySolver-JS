# 定制 ONNX Runtime Web bundle

最后复核：2026-08-25。

`ort.wasm.bundle.min.mjs` 内置 ONNX Runtime Web `1.27.0` 的 JavaScript API 与 Emscripten glue，不包含 WebAssembly 二进制。用户脚本的 `build:bundled-runtime` 会内置本文件；扩展构建器也会复制并审计它，但为扩展同时打包匹配的 WASM。

## 供应链身份

| 字段              | 值                                                                 |
| ----------------- | ------------------------------------------------------------------ |
| ONNX Runtime 提交 | `8f0278c77bf44b0cc83c098c6c722b92a36ac4b5`                         |
| Emscripten SDK    | `4.0.23`                                                           |
| 构建模式          | `MinSizeRel`、basic minimal、SIMD、单线程、精简算子类型            |
| 算子配置          | `config/onnxruntime/required_operators_and_types.config`           |
| Bundle 字节长度   | `56,993`                                                           |
| Bundle SHA-256    | `a63d4f08e70220c0f721fabfd4e4b958aa127334a19038b2732d07e919f32554` |
| 匹配 WASM 长度    | `1,267,937`                                                        |
| 匹配 WASM SHA-256 | `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa` |

用户脚本从 `apps/userscript/src/inference/onnx-runtime-assets.ts` 声明的首方内容寻址 URL 下载匹配 WASM，在使用前校验长度与 SHA-256，并通过 `ort.env.wasm.wasmBinary` 交给运行时。该 glue 与其他 WASM 不保证 ABI 匹配，不得单独替换其中一个文件。

## 复现与采用

在仓库根目录运行 `corepack pnpm build:onnx-runtime` 生成隔离产物。确认终端输出的版本、长度和哈希后，才可追加 `-- --install` 替换受版本控制的 bundle，并生成被 Git 忽略的算子配置。安装后至少运行：

```bash
corepack pnpm verify:onnx-runtime
corepack pnpm docs:check
corepack pnpm --filter @hv-pony-solver/extension test
```

更完整的构建目录、R2 对象和原子更新要求见仓库根目录的 `docs/onnx-runtime.md`。
