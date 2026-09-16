# 定制 ONNX Runtime Web bundle

本目录保存项目定制的 JS API 与 glue。完整资产清单、profile 差异和构建约束见[Runtime 专题](../../../../docs/onnx-runtime.md)，本文用于核对随附文件及其配对。

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

在仓库根目录运行 `mise exec -- pnpm build:onnx-runtime` 生成隔离产物。确认终端输出的版本、长度和哈希后，才可追加 `-- --install` 替换受版本控制的 bundle，并生成被 Git 忽略的算子配置。安装后至少运行：

```bash
mise exec -- pnpm verify:onnx-runtime
mise exec -- pnpm docs:check
mise exec -- pnpm --filter @hv-pony-solver/extension test
```

## 维护边界

本文件是项目说明，压缩 glue 与第三方许可按供应链身份维护，不作手工格式化或局部修补。修改 glue/WASM 必须同步 Runtime 清单、shared 清单、Worker 模板、两种客户端构建审计和相关测试；不能只替换其中一个文件。用户脚本 bundled 的 WASM 仍需网络下载，扩展则读取包内 WASM。

默认格式门禁跳过 vendor。本 README 需单独执行 `mise exec -- pnpm exec prettier --check --ignore-path /dev/null apps/userscript/vendor/onnxruntime/README.md`，并人工核对相对链接。构建与验证不会自动上传 R2、部署服务或发布客户端。
