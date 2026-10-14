# HV PonySolver JS

在浏览器本地识别 Hentaiverse Pony 验证码，提供用户脚本和 Chromium/Firefox 扩展。图片预处理、ONNX Runtime Web 推理和答案选择均在本地完成；Cloudflare Model Worker 只分发模型与运行时资产，不接收验证码图片或识别结果。

## 选择客户端

| 客户端       | 版本    | 模型与运行时                                              | 使用入口                                                                |
| ------------ | ------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| 用户脚本     | `3.0.0` | Key 下载模型；默认固定 CDN 运行时，可构建内置精简 glue 版 | [安装与菜单](docs/usage/userscript.md)                                  |
| 远程模型扩展 | `0.1.1` | Key 下载模型；JS、Worker、WASM 随包分发                   | [构建与加载](docs/browser-extension.md#build-outputs-and-local-loading) |
| 内置模型扩展 | `0.1.1` | 模型和运行时随包分发，无需 Key                            | [构建模式](docs/browser-extension.md#build-modes)                       |

版本以[用户脚本](apps/userscript/package.json)和[扩展](apps/extension/package.json)包清单为准。扩展最低支持 Chromium 116、Firefox Desktop 140；Firefox Android 142 需独立发布证据。Safari、其他移动浏览器、Manifest V2 和商店发布不在当前交付范围。用户脚本管理器兼容性需单独验证。

**不要在同一浏览器配置中同时启用用户脚本版和扩展版**，以免重复处理验证码。

## 从源码构建

在仓库根目录准备 [mise.toml](mise.toml) 固定的 Node.js `24.15.0` 和 pnpm `12.3.0`：

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
```

选择一种构建：

```bash
# 用户脚本：默认外部运行时
mise exec -- pnpm --filter @hv-pony-solver/userscript build -- --minify
```

```bash
# 远程模型扩展：构建时不需要 Key
mise exec -- pnpm --filter @hv-pony-solver/extension build
```

```bash
# 内置模型扩展：先准备通过完整性校验的 model/yolo26n-640.ort
mise exec -- pnpm --filter @hv-pony-solver/extension build:packaged
```

扩展两种模式都会重建 `apps/extension/dist/`，覆盖上一份产物。Chrome/Edge 加载 `apps/extension/dist/chromium`；Firefox 临时加载 `apps/extension/dist/firefox/manifest.json`。工具栏按钮打开设置页，远程版在此验证并保存 Key。用户脚本安装与另一种运行时构建见[用户脚本指南](docs/usage/userscript.md)。

## 默认行为

- `auto` 识别、勾选后延迟点击原生提交按钮；`manual` 只记录结果。默认开启失败随机答案，扩展设置页可关闭。
- 保留手动勾选。合计超过 4 项时只裁剪自动项，目标至多 3 项；本轮手动取消的项不会被勾回。目标、图片选源或外层 fieldset 的有效禁用状态变化会先取消旧轮次，新验证码不必等待旧初始化或设置读取完成；取消或控件失效后不再点击或提交。
- 面板默认 `top=155, left=1240`，显示最近 5 条记录，仅在存在 `div#csp` 时可见；隐藏面板不停止识别。
- 启动时 body 暂缺，或 AADB 等局部切页移除面板、替换 body 后，等待挂载并继续扫描，保留面板状态和历史，仍遵守可见性设置；销毁后不恢复。JPX `AjaxRound` 清除扫描定时器后，后续验证码相关 DOM 变化会恢复扫描，每题仍只提交一次。

设置范围、提交复核与历史耗时见[设置与行为](docs/usage/settings.md)；加载、Key、额度、面板和页面切换问题见[故障排查](docs/usage/troubleshooting.md)。

## 模型与隐私

当前客户端使用 `.ort`，服务端保留旧 `.onnx` 路由。远程 Key 只通过 `Authorization: Bearer` 发送，不进入 URL、日志或产物；扩展内容脚本不接收 Key 或模型字节。内置模型扩展不读取旧 Key，也不保留远程下载能力；安装包中的模型可被提取，完整性校验不提供保密性。

模型校验长度和 SHA-256 后写入 IndexedDB。额度默认按每 Key、每 UTC 自然月最多 5 次**已确认缓存下载**计算；查询、Key 验证和有效缓存命中不计次，关闭额度时显示无限制。详见[缓存与计次](docs/model-cache-strategy.md)。

用户脚本两个 Runtime profile 不自动回退；“内置精简运行时”仍需下载模型和 WASM。资产身份见[Runtime 专题](docs/onnx-runtime.md)，扩展权限与消息边界见[扩展专题](docs/browser-extension.md#permission-matrix)。

## 开发与维护

从[文档导航](docs/README.md)选择主题；修改前阅读 [AGENTS.md](AGENTS.md)。常用入口：

- [整体架构](docs/architecture/overview.md)与[目录组织](docs/development/directory-layout.md)
- [开发验证](docs/development/verification.md)与[命令参考](docs/development/commands.md)
- [HTTP 契约](docs/reference/model-worker-http.md)、[CI 与发布](docs/development/releases.md)、[Worker 运维](docs/model-worker-ops.md)
- [文档维护与检查](docs/development/documentation.md#验证文档修改)

完整检查为 `mise exec -- pnpm check`，先按[验证手册](docs/development/verification.md#model-worker-测试配置)备份并准备 Worker 测试配置。工作区以覆盖率模式执行一次，根级工具测试通过 `test:root` 单独执行，不重复普通工作区测试；覆盖率门槛不变。普通检查和构建不发布产品；commit、push、artifact、Release 和部署需明确授权。本地通过不代表远程鉴权、最低版本或 Android 验收完成。
