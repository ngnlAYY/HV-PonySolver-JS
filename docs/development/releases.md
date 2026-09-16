# CI、制品与发布

本页解释验证、Actions artifact、GitHub Release 和 Cloudflare 部署之间的门禁。操作前先确认目标产品、版本和 commit；普通构建成功不会自动发布。扩展证据格式见[扩展手册](../browser-extension.md)，Worker 的具体操作见[运维手册](../model-worker-ops.md)。

## 发布入口

| 手动输入                      | 产物或副作用                              | 关键限制                                                                          |
| ----------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| `publish_userscript_artifact` | 上传用户脚本 Actions artifact             | 不创建 GitHub Release                                                             |
| `publish_extension_release`   | 远程桌面扩展 ZIP、校验和、artifact 元数据 | 仅 main；标签来自扩展包版本；双浏览器、最低桌面版本、受保护远程推理和 CodeQL 门禁 |
| `publish_extension_artifact`  | canonical 内置模型扩展 artifact           | 独立双浏览器、受保护远程推理和同一 Firefox ZIP 的 Android 142 外部证据            |
| `publish_model_worker`        | Cloudflare 真实部署                       | main、production-model-worker 环境、完整 secrets 与显式发布意图                   |

前三项位于 Repository CI，最后一项位于独立部署工作流，默认都关闭。

## 仓库验证工作流

`.github/workflows/verify-monorepo.yml` 在 Pull Request、`main` 推送和手动触发时执行：

- 通过固定 commit SHA 的 `jdx/mise-action` 安装 `mise.toml` 声明的 Node.js `24.15.0` 和 pnpm `12.3.0`，保留 pnpm store 缓存并执行冻结依赖安装。
- 检查外部 GitHub Action 是否固定到完整 commit SHA，要求 Docker Action 使用完整 `sha256` digest，并强制每个 `actions/checkout` 设置 `persist-credentials: false`。
- 依赖审计、第一方格式检查、ESLint 和 TypeScript 类型检查。
- JavaScript/TypeScript CodeQL 扫描，并在 Pull Request 中执行依赖审查。
- 文档漂移、命令示例、本地链接和决策结构/归档封印检查，以及架构边界和浏览器危险调用检查。guardrails checkout 获取完整历史，供归档与变更前基线比较。
- 工作区及根级 `scripts/**/*.test.mjs` 测试，以及工作区覆盖率；递归覆盖率命令不包含根级测试。
- 默认外部 profile 构建及 `256 KiB` 预算。
- 显式内置 profile 构建及 `1 MiB` 预算。
- Pull Request 和 `main` push 执行用户脚本 Playwright Chromium E2E；手动运行由 `run_userscript_e2e` 控制。
- 扩展 job 只构建一次远程产物并复用于有界 transport 基准与 Chromium/Firefox 加载检查；Release 直接下载并发布这份已测试产物，不再二次构建；另执行内容脚本、内置模型双浏览器推理及 Chromium 116/Firefox 140 精确最低版本门禁。
- 受仓库变量和受保护环境控制的真实远程模型与 canonical 内置模型门禁；缺少生产配置时明确跳过，不能冒充已验证。
- 手动选择 `publish_userscript_artifact`、`publish_extension_artifact` 或 `publish_extension_release` 时执行对应发布门禁；三个选项默认都关闭。
- 同一 workflow/event/ref 的新自动 CI 会取消旧运行；手动制品/发布运行与 push 使用不同并发组，彼此串行且不会被 push 抢占；每个 job 都有独立超时，避免浏览器、网络或发布门禁永久占用 runner。

普通 push 和 Pull Request 不创建 GitHub Release，也不发布生产扩展 artifact。

## Model Worker 部署工作流

`.github/workflows/deploy-cloudflare-model-worker.yml` 仅支持从 `refs/heads/main` 手动触发生产 job；其他 ref 的 job 会在读取受保护 secrets 前跳过：

- Cloudflare secrets 完整时，默认只渲染配置、执行检查并运行 Wrangler dry-run，不执行部署。
- Cloudflare secrets 不完整且 `publish_model_worker=false` 时，工作流仍执行 typecheck 与测试，但会安全跳过配置渲染、Wrangler dry-run 和部署；若已经请求发布则 fail closed。
- 手动输入 `enable_model_download_quota` 控制是否启用每 Key 月度下载限制，默认开启；关闭后模型请求不受 5 次限制，额度查询会提示限制未开启。
- 整个 job 绑定 `production-model-worker` GitHub Environment；在 `refs/heads/main` 上只有 `publish_model_worker=true`、环境审批通过且所需 secrets 完整时才实际部署。
- 工作流不自动运行线上公开契约探测；部署完成只证明 Wrangler 发布命令成功。等待边缘传播后，由操作者按 [`docs/model-worker-ops.md`](../../docs/model-worker-ops.md) 手动执行 `check:deployment`。

dry-run 成功只证明 Wrangler 可以生成部署包，不证明 Cloudflare 已更新，也不证明 R2、KV 或线上路由正确。

## 发布审阅与交付证据

用户脚本版本由 `apps/userscript/package.json` 决定，扩展版本由 `apps/extension/package.json` 决定；不联动升级私有内部包。发布前核对实际 ZIP 与 artifact 哈希、目标 commit 的门禁状态和所需 E2E 证据。扩展 Release 复用已测试的远程产物，不二次构建。

CodeQL job 成功表示分析执行完成；处理安全告警时还需等待目标分支的新分析，核对分析结果与告警实例状态。发布输入不代表浏览器商店提交、签名或 Android 验证。

记录 run URL、commit、产物身份、已通过的具体门禁以及 skipped/未运行项。禁止把“已触发”记成“已通过”。仓库任务仅在用户明确要求时创建 commit、push、发布或部署；推送前确认远程没有未整合提交。
