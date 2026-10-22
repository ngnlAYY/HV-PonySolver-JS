# CI、制品与发布

操作前确认产品、版本、目标 commit 和用户授权。普通检查或构建不执行发布。验证范围见[验证手册](verification.md)，扩展证据格式见[扩展手册](../browser-extension.md)，Worker 操作见[运维手册](../model-worker-ops.md)。

## 发布入口

| 手动输入                      | 产物或副作用                                              | 发布条件                                                                             |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `publish_userscript_artifact` | 用户脚本 Actions artifact，不创建 Release                 | 仓库检查；如选择 `run_userscript_e2e`，还需该 E2E 成功                               |
| `publish_extension_release`   | remote 桌面 Chromium/Firefox ZIP、校验和、artifact 元数据 | main；仓库检查、CodeQL、双浏览器加载、packaged fixture、最低桌面版本、受保护远程推理 |
| `publish_extension_artifact`  | canonical 内置模型扩展 artifact                           | main；上述扩展门禁，加 canonical 双浏览器及同一 Firefox ZIP 的 Android 142 外部证据  |
| `publish_model_worker`        | Cloudflare 真实部署                                       | main、production-model-worker 环境、完整 secrets 与显式发布意图                      |

前三项属于 Repository CI，最后一项属于独立部署 workflow，默认均关闭。普通 push、PR 和未选择发布的手动运行不创建 Release 或发布产品 artifact；测试报告等 CI 证据仍可上传。

## 仓库验证工作流

[verify-monorepo.yml](../../.github/workflows/verify-monorepo.yml) 在 PR、main push 和手动触发时运行；逐 job 的检查内容见[本地命令映射](verification.md#ci-job-与本地命令)。维护时保留以下边界：

- `jdx/mise-action` 读取根 `mise.toml`，保留 pnpm store 缓存与冻结安装；仅需 Node 的发布步骤可限定安装 Node。
- 外部 Action 固定完整 commit SHA，Docker Action 固定完整 `sha256` digest；每次 checkout 均设置 `persist-credentials: false`。guardrails 获取完整历史，供归档封印比较。
- `test` 包含工作区和根级 `scripts/**/*.test.mjs`；覆盖率不替代根测试。coverage-build 分别检查默认 `256 KiB` 与内置 Runtime `1 MiB` 用户脚本预算。
- 用户脚本 E2E 在 PR/main push 执行，手动运行由 `run_userscript_e2e` 控制。extension-e2e 内构建一次 remote，供基准和双浏览器 load-only 复用；Release 发布这份已测试产物，不二次构建。
- remote 鉴权与 canonical 模型受环境/仓库变量控制。job 未运行或 `enabled=false` 都不产生相应证据；发布 gate 同时检查成功状态与 enabled 输出。显式 authenticated 命令缺 Key 必须失败。
- 两种扩展发布均显式依赖本次 CodeQL 成功。内置 artifact 还要求 `firefox_android_e2e_run_id` 指向受信任外部 workflow 的成功 run，核对 commit、事件、Android 142 推理以及同一 Firefox ZIP 的名称、长度和 SHA-256。

门禁约束完整产品 ZIP 的首次上传，包括 job 间传递用的 artifact。remote 的受测 ZIP 等待全部远程发布门禁；canonical 的 Android 证据校验与 preflight 在构建 job 内完成，此前 ZIP 只保留在该 job 本地。只有显式授权且全部所需门禁通过，才上传供最终发布 job 使用的同一份产物。普通 canonical 检查不上传产品 ZIP。

canonical 下载 URL 与 Bearer 来自受保护配置。下载器在发送前校验配置，错误只报告类别，不保留可回显配置的原生异常或 `cause`；非法 URL、请求头及底层请求失败均不得将值带入 CI 日志。

自动 CI 在同一 workflow/event/ref 下取消旧运行；手动运行使用独立并发组，同组串行且不被 push 抢占。每个 job 保留独立超时。

### CI 故障定位

先定位首个失败 job/step，再判断后续 skipped 是依赖阻断还是独立失败：

- `Security audit`：按公告升级最小兼容补丁，同时更新根声明、override 和锁文件；保留 `audit:high`、7 天发布等待与 trust policy，不用忽略公告或降低阈值换取绿灯。
- CodeQL 提示 `Code scanning is not enabled for this repository`：检查仓库可见性、Code Security 许可与组织策略。公开仓库可使用免费 Code Scanning；个人私有仓库不能仅增加 workflow token 权限解决。改变可见性或购买许可须明确授权，不关闭上传或跳过发布门禁。
- CodeQL 执行成功后仍须检查新分析及 open alerts。旧提交重跑只证明该提交与仓库设置；未提交的本地修复不在远程证据中。

平台前提见 [GitHub 私有仓库启用说明](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/private-repository-enablement)。

## Model Worker 部署工作流

[.github/workflows/deploy-cloudflare-model-worker.yml](../../.github/workflows/deploy-cloudflare-model-worker.yml) 仅手动触发，生产 job 只在 `refs/heads/main` 运行，并绑定 `production-model-worker` Environment；其他 ref 在读取受保护 secrets 前跳过。

- Cloudflare secrets 完整且未选择发布时，只渲染配置、检查并执行 Wrangler dry-run。
- Cloudflare secrets 不完整且 `publish_model_worker=false` 时仍执行 typecheck 与测试，跳过配置渲染、Wrangler dry-run 和部署；`publish_model_worker=true` 且 secrets 不完整时 fail closed。
- 实际部署须同时满足 main、`publish_model_worker=true`、环境审批及完整 secrets。`enable_model_download_quota` 默认开启；关闭后模型下载不限每月 5 次，查询显示限制未启用。
- workflow 不自动执行线上公开探测。部署后等待边缘传播，再按[运维手册](../model-worker-ops.md)运行 `check:deployment`。

dry-run 只证明可以生成部署包；Wrangler 部署成功也不能证明 R2/KV、线上路由或真实模型鉴权正常。回滚仍须保留 Durable Object 绑定、类导出和迁移契约。

## 发布审阅与交付证据

用户脚本和扩展分别取各自 `package.json` 版本，不联动升级内部私有包。扩展 Release 标签为 `extension-v<扩展版本>`，校验实际 ZIP、SHA-256、artifact 元数据与目标 commit 后，通过 GitHub Git references API 原子创建绑定本次 `GITHUB_SHA` 的新标签，再用 `gh release create --verify-tag` 发布。已有标签、API 拒绝或网络失败立即中止，不把标签查询失败解释为不存在，也不自动改绑已有标签。若标签已创建而后续发布失败，标签会保留，须由维护者核对后处理，不自动删除重试。它不执行浏览器商店提交或签名，也不提供 Firefox Android 证据。

CodeQL 成功表示分析执行完成；修复告警后还须等待目标分支新分析，核对分析结果与告警实例。交付记录 run URL、commit、产物身份、通过门禁和 skipped/未运行项，不把“已触发”写成“已通过”。仅在明确授权时 commit、push、发布或部署；推送前确认远程没有未整合提交。
