# 用户脚本安装与构建

用户脚本通过 GM 菜单设置，由浏览器 Worker 本地推理。安装前停用同一浏览器配置中的 PonySolver 扩展，避免重复提交。

## 构建并安装

先按[项目 README](../../README.md#从源码构建)安装工具和依赖。在仓库根目录选择一个 profile：

| profile          | 命令                                                                                      | 运行时来源                                    |
| ---------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `external`，默认 | `mise exec -- pnpm --filter @hv-pony-solver/userscript build -- --minify`                 | 固定版本 CDN 的 JS、MJS、WASM，逐项校验后加载 |
| `bundled`        | `mise exec -- pnpm --filter @hv-pony-solver/userscript build:bundled-runtime -- --minify` | 脚本内置精简 glue，首方下载内容寻址 WASM      |

两种 profile 都需有效 Key 下载同一远程 `.ort` 模型，构建时无需 Key，运行时不自动回退。用具备所需 GM API 的管理器导入并启用 `apps/userscript/dist/hv-pony-solver.user.js`；Playwright 测试不代替真实管理器兼容性验收。

进入 Hentaiverse，在“HV-PonySolver 设置”中选择“设置模型下载 Key”。验证使用不计次的认证 `GET /quota`，不下载模型；额度耗尽或禁用不影响有效 Key 的保存，额度服务故障会使验证失败。不要把 Key 写入源码、URL 或问题报告。

- 新的设置或清除淘汰尚未写入的旧验证，包括已经验证成功、仍排队等待旧 GM 写入的操作；取消输入不淘汰原操作。
- 同页 GM 设置/清除串行提交。已发起的写入不可撤销，后续操作等待其结算，防止旧值迟到覆盖清除或新 Key；前次失败不阻断后续写入。此顺序不提供跨标签事务，底层写入永久挂起时也不能安全跳过。
- 实际提交后，才取消并等待旧初始化、恢复当前失败验证码；已就绪会话继续复用。提交回调不阻塞后续存储写入。取消输入、验证/保存失败或应用已销毁时不触发恢复。

## 设置菜单

菜单提供 Key 设置/清除、下载次数查询、答题模式与延迟、面板位置/重置、紧凑模式、历史条数和 csp 显示限制。“精简版”指面板紧凑显示，不切换 Runtime profile。

菜单不提供单独“下载模型”、失败随机答案或保留手动勾选开关；后两项沿用默认行为。输入格式见[答题与面板](settings.md)。首次识别按需下载模型并准备会话，有效缓存命中不重新下载。

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

Key 仅存入敏感 GM 存储，API 不可用时拒绝保存。敏感 GM 读写/删除失败只报告操作类别，不透传管理器原异常或 cause，避免其参数回显泄露 Key。普通设置使用 GM，历史使用同源 localStorage 独立键，模型使用 IndexedDB；不同平台不自动迁移存储。

模型通过标准 Fetch 与 Bearer header 请求，遵循 CORS，不用 GM 特权网络绕过。图片和答案留在浏览器。资产身份与加载清理见[Runtime 专题](../onnx-runtime.md)，下载确认见[缓存专题](../model-cache-strategy.md)。

## 修改与验证

入口为 [main.ts](../../apps/userscript/src/main.ts)，平台组装在 [app-dependencies.ts](../../apps/userscript/src/app/app-dependencies.ts)，菜单实现为 [settings-menu.ts](../../apps/userscript/src/userscript/settings-menu.ts)。具体调用链见[浏览器架构](../architecture/browser-runtime.md)。

```bash
mise exec -- pnpm check:userscript
mise exec -- pnpm test:e2e:userscript
```

前者执行类型、单元测试和默认构建；后者用 Chromium Playwright 验证页面 fixture 与 external Worker 资产初始化，不使用生产 Key。真实管理器、线上页面和远程鉴权仍需独立验收。
