# HV PonySolver JS

在浏览器本地识别 Hentaiverse Pony 验证码，提供用户脚本和 Chromium/Firefox 扩展。图片预处理、ONNX Runtime Web 推理和答案选择均在本地完成；Cloudflare Model Worker 只分发模型与运行时资产，不接收验证码图片或识别结果。

## 选择客户端

| 客户端       | 当前版本 | 模型与运行时                                                         | 使用入口                                                                |
| ------------ | -------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 用户脚本     | `3.0.0`  | Key 下载 ORT 模型；默认加载固定 CDN 运行时，也可构建内置精简 glue 版 | [安装与菜单](docs/usage/userscript.md)                                  |
| 远程模型扩展 | `0.1.1`  | Key 下载 ORT 模型；JS、Worker、WASM 随扩展分发                       | [构建与加载](docs/browser-extension.md#build-outputs-and-local-loading) |
| 内置模型扩展 | `0.1.1`  | 模型与运行时全部随包分发，无需 Key                                   | [构建模式](docs/browser-extension.md#build-modes)                       |

版本分别来自[用户脚本包](apps/userscript/package.json)和[扩展包](apps/extension/package.json)，私有根包与内部包的版本不代表客户端版本。

扩展最低支持 Chromium 116、Firefox Desktop 140；Firefox Android 142 的发布证据需独立验收。Safari、其他移动浏览器、Manifest V2 和浏览器商店发布不在当前交付范围内。用户脚本的管理器兼容性不由扩展最低版本测试证明。

**不要在同一浏览器配置中同时启用用户脚本版和扩展版**，否则可能重复处理同一个验证码。

## 从源码构建

在仓库根目录准备工具和依赖。精确版本由 [mise.toml](mise.toml) 管理：

| 工具    | 版本                                |
| ------- | ----------------------------------- |
| Node.js | `24.15.0`，最低兼容要求 `>=24.15.0` |
| pnpm    | `12.3.0`                            |

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
```

选择需要的客户端构建：

```bash
# 用户脚本：默认外部运行时
mise exec -- pnpm --filter @hv-pony-solver/userscript build -- --minify
```

```bash
# 扩展：默认远程模型，构建时不需要 Key
mise exec -- pnpm --filter @hv-pony-solver/extension build
```

```bash
# 扩展：内置模型，需要预先准备固定且通过完整性校验的 model/yolo26n-640.ort
mise exec -- pnpm --filter @hv-pony-solver/extension build:packaged
```

扩展两种模式均重建 `apps/extension/dist/`，后一次构建覆盖前一次产物。Chrome/Edge 加载 `apps/extension/dist/chromium`；Firefox 临时加载 `apps/extension/dist/firefox/manifest.json`。工具栏按钮打开设置页，远程版在此验证并保存 Key。用户脚本产物安装方法和另一种运行时构建见[用户脚本指南](docs/usage/userscript.md)。

## 默认行为

- 默认 `auto`：识别后勾选答案，按设置延迟点击原生提交按钮；`manual` 只记录识别结果。
- 默认保留手动勾选。合计超过 4 项时只裁剪自动项，目标至多 3 项；手动项不会为了数量限制而被取消。
- 默认开启失败随机答案；扩展设置页可关闭。页面目标变化、取消或控件失效后，旧任务不会继续点击或提交。
- 面板默认 `top=155, left=1240`，显示最近 5 条记录，默认仅在存在 `div#csp` 时可见。隐藏面板不停止识别。
- AADB 等局部切页脚本移除面板或替换 body 后，会重新挂载原节点，保留状态与历史；可见性仍由设置决定，应用销毁后不会自行恢复。

设置范围、提交复核、历史保存失败与耗时含义见[答题和面板说明](docs/usage/settings.md)。遇到加载、Key、额度、面板、页面前进／后退时的扩展断连或提交问题时先查[故障排查](docs/usage/troubleshooting.md)。

## 模型与隐私

当前客户端使用 `.ort`，Model Worker 为旧客户端保留 `.onnx` 路由。远程 Key 只通过 `Authorization: Bearer` 传递，不写入 URL、日志或构建产物。扩展内容脚本不接收 Key 或模型字节；内置模型扩展不读取旧 Key，也不保留远程模型下载能力。

模型下载校验长度和 SHA-256，再写入 IndexedDB。额度默认按每 Key、每 UTC 自然月最多 5 次**已确认缓存下载**计算；查询、Key 验证和有效缓存命中不消耗次数。关闭额度时客户端显示无限制。完整时序见[模型缓存与计次](docs/model-cache-strategy.md)。

用户脚本两种运行时构建没有自动回退；“内置精简运行时”仍需下载模型和 WASM。扩展内置模型可从安装包提取，完整性校验不提供保密性。精确资产身份与更新步骤见[模型和 Runtime 清单](docs/onnx-runtime.md)。

## 开发与维护

| 任务                            | 文档                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 找文档或定位模块                | [文档导航](docs/README.md)、[整体架构](docs/architecture/overview.md)                                                                     |
| 准备测试环境、执行完整检查      | [开发与验证](docs/development/verification.md)、[命令参考](docs/development/commands.md)                                                  |
| 修改源码或新增模块              | [贡献规范](docs/development/contributing.md)、[目录组织](docs/development/directory-layout.md)、[AGENTS.md](AGENTS.md)                    |
| 修改服务端协议                  | [Model Worker HTTP 契约](docs/reference/model-worker-http.md)、[服务架构](docs/architecture/model-service.md)                             |
| 发布扩展、用户脚本或部署 Worker | [CI 与发布](docs/development/releases.md)、[Worker 运维](docs/model-worker-ops.md)                                                        |
| 更新文档或追查决定              | [文档维护规则](docs/development/documentation.md)、[文档重建决定](docs/decisions/implemented/process/2026-09-16-documentation-rebuild.md) |

完整本地检查使用 `mise exec -- pnpm check`；首次运行前须按[验证手册](docs/development/verification.md#model-worker-测试配置)准备 Worker 测试绑定，并备份已有生成配置。根测试包含工作区与根级 Node 测试，覆盖率不能替代它。

只修改文档时执行：

```bash
mise exec -- pnpm format:check
mise exec -- pnpm docs:check
mise exec -- node --test "scripts/docs-drift/test/*.test.mjs"
git diff --check
```

普通检查和构建不发布产品。commit、push、artifact、Release 和部署需要明确授权；本地检查通过也不代表远程鉴权、最低版本浏览器或 Android 验证完成。
