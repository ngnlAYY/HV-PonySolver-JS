# 用户脚本安装与构建

用户脚本在 Hentaiverse 页面运行，使用 GM 菜单和存储，由浏览器 Worker 执行推理。它与扩展共享答题逻辑，但安装方式、运行时来源和设置入口独立。先停用同一浏览器配置中的 PonySolver 扩展，避免重复提交。

## 构建并安装

先按[项目 README](../../README.md#从源码构建)安装工具和依赖。在仓库根目录选择一个 profile：

| profile          | 命令                                                                                      | 运行时来源                                    |
| ---------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `external`，默认 | `mise exec -- pnpm --filter @hv-pony-solver/userscript build -- --minify`                 | 固定版本 CDN 的 JS、MJS、WASM，逐项校验后加载 |
| `bundled`        | `mise exec -- pnpm --filter @hv-pony-solver/userscript build:bundled-runtime -- --minify` | 脚本内置精简 glue，首方下载内容寻址 WASM      |

两种模式都下载同一个远程 `.ort` 模型，都需要有效 Key。构建时无需 Key，运行时也不会在两种 profile 之间自动回退。默认输出为 `apps/userscript/dist/hv-pony-solver.user.js`；用具备所需 GM API 的用户脚本管理器导入该文件并启用。项目的 Playwright 测试不等同于真实管理器兼容性验收。

安装后进入 Hentaiverse，通过管理器菜单打开“HV-PonySolver 设置”，选择“设置模型下载 Key”。Key 验证使用不计次的 HEAD；保存成功后在验证码页面检查面板与识别结果。不要把 Key 写入源码、浏览器 URL 或问题报告。

## 设置菜单

菜单提供模型 Key 设置/清除、下载次数查询、自动/手动模式、提交等待、答题间隔、面板位置与重置、紧凑模式、历史显示条数和 csp 显示限制。菜单中的“精简版”指面板紧凑显示，不会切换 Runtime 构建 profile。

当前菜单不提供扩展的“下载模型”、失败随机答案或保留手动勾选开关；后两项沿用默认行为。完整输入格式和共享行为见[答题与面板](settings.md)。首次识别可能需要下载模型并准备会话，后续有效缓存命中无需重新下载。

## 同时保留两种构建

默认两种 profile 使用同一路径，后一次覆盖前一次。需要比较时分别指定输出与清单路径：

```bash
HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH=apps/userscript/dist/hv-pony-solver.external.user.js \
HV_PONY_SOLVER_ARTIFACT_MANIFEST_PATH=apps/userscript/dist/hv-pony-solver.external.artifact.json \
mise exec -- pnpm --filter @hv-pony-solver/userscript build -- --minify

HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH=apps/userscript/dist/hv-pony-solver.bundled.user.js \
HV_PONY_SOLVER_ARTIFACT_MANIFEST_PATH=apps/userscript/dist/hv-pony-solver.bundled.artifact.json \
mise exec -- pnpm --filter @hv-pony-solver/userscript build:bundled-runtime -- --minify
```

| 环境变量                                | 作用                  |
| --------------------------------------- | --------------------- |
| `HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH` | 用户脚本输出路径      |
| `HV_PONY_SOLVER_METAFILE_PATH`          | esbuild metafile 输出 |
| `HV_PONY_SOLVER_ARTIFACT_MANIFEST_PATH` | 产物清单输出          |
| `HV_PONY_SOLVER_ARTIFACT_SHA256_PATH`   | 产物 SHA-256 输出     |

清单记录文件名、长度、SHA-256、是否压缩与 `bundledRuntime`。检查预算必须针对对应 profile；默认门禁使用未压缩产物，发布压缩产物不能代替它：

```bash
mise exec -- pnpm --filter @hv-pony-solver/userscript build
mise exec -- pnpm bundle:check:default
```

```bash
mise exec -- pnpm --filter @hv-pony-solver/userscript build:bundled-runtime
mise exec -- pnpm bundle:check:bundled
```

两种预算分别为 256 KiB 和 1 MiB。`dist/`、metafile 和产物清单是生成物，不作为普通源码提交。

## 存储与网络边界

Key 通过敏感 GM 存储保存；GM API 不可用时拒绝保存，不降级到页面可读存储。普通设置通过 GM 桥接，答题历史使用同源 localStorage 独立键，模型使用浏览器 IndexedDB。不同平台的存储不会自动互相迁移。

模型请求使用标准 Fetch 与 Bearer header，遵循服务 CORS；不使用 GM 特权网络绕过该契约。图片和答案留在浏览器中。运行时 URL、长度、哈希、Blob URL 清理和精简构建步骤见[Runtime 专题](../onnx-runtime.md)，模型确认见[缓存专题](../model-cache-strategy.md)。

## 修改与验证

入口为 [main.ts](../../apps/userscript/src/main.ts)，平台组装在 [app-dependencies.ts](../../apps/userscript/src/app/app-dependencies.ts)，菜单实现为 [settings-menu.ts](../../apps/userscript/src/userscript/settings-menu.ts)。具体调用链见[浏览器架构](../architecture/browser-runtime.md)。

```bash
mise exec -- pnpm check:userscript
mise exec -- pnpm test:e2e:userscript
```

前者包含类型、单元测试和默认构建；后者运行 Chromium Playwright 场景，包括确定性页面流程及 external Worker 资产初始化场景，不使用生产模型 Key。涉及实际管理器、线上页面或远程鉴权时仍需独立验收，不能把本地 fixture 描述为线上推理已通过。
