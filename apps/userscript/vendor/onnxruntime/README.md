# 定制 ONNX Runtime Web bundle

`ort.wasm.bundle.min.mjs` 包含 ONNX Runtime Web `1.27.0` 的 JS API 与 Emscripten glue，不含 WASM。用户脚本 `build:bundled-runtime` 内置它并下载首方 WASM；扩展同时打包匹配的 WASM。profile、完整清单与构建约束见 [Runtime 专题](../../../../docs/onnx-runtime.md)。

## 供应链身份

| 字段              | 值                                                                 |
| ----------------- | ------------------------------------------------------------------ |
| ONNX Runtime 提交 | `8f0278c77bf44b0cc83c098c6c722b92a36ac4b5`                         |
| Emscripten SDK    | `4.0.23`                                                           |
| 构建模式          | `MinSizeRel`、basic minimal、SIMD、单线程、精简算子类型            |
| 算子配置          | `config/onnxruntime/required_operators_and_types.config`（生成物） |
| Bundle 字节长度   | `56,993`                                                           |
| Bundle SHA-256    | `a63d4f08e70220c0f721fabfd4e4b958aa127334a19038b2732d07e919f32554` |
| 匹配 WASM 长度    | `1,267,937`                                                        |
| 匹配 WASM SHA-256 | `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa` |

客户端按 [ONNX_RUNTIME_ASSETS](../../src/inference/onnx-runtime-assets.ts) 校验实际长度和 SHA-256，再通过 `ort.env.wasm.wasmBinary` 注入。glue 与其他 WASM 不保证 ABI 匹配，必须成对采用。

[LICENSE](LICENSE)保留固定上游提交的完整 MIT 文本。bundled 用户脚本和扩展推理 Worker 将其作为 banner 随包分发，压缩也保留；不通过修改此 vendor bundle 来添加声明，因此上面的长度和哈希不变。

## 复现与采用

仓库根运行 `mise exec -- pnpm build:onnx-runtime` 生成隔离产物；核对版本、长度和哈希后，用 `mise exec -- pnpm build:onnx-runtime -- --install` 安装 bundle 和生成算子配置。随后至少验证：

```bash
mise exec -- pnpm verify:onnx-runtime
mise exec -- pnpm docs:check
mise exec -- pnpm --filter @hv-pony-solver/extension test
```

完整验证及两种用户脚本 profile 门禁见[采用步骤](../../../../docs/onnx-runtime.md#安装生成的-glue)。构建不自动上传 R2、部署或发布。

## 维护边界

压缩 glue 和第三方许可按供应链身份维护，不手工格式化或局部修补。采用新配对时同步 Runtime/shared 清单、Worker 模板、客户端构建审计、测试与文档。

默认格式/链接门禁跳过 vendor；人工核对本 README 的相对链接，并单独运行 `mise exec -- pnpm exec prettier --check --ignore-path /dev/null apps/userscript/vendor/onnxruntime/README.md`。
