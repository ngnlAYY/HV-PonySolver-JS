# 2026-10-29 全仓维护性、边界与依赖审计

基线 `3c2032b`，开始时 `main` 与 `origin/main` 一致、工作树干净。五个并行分区覆盖 browser-core、扩展运行时、用户脚本、Model Worker、shared 与扩展工具；主会话负责根脚本、CI、当前手册、依赖和集成验证。决定与取舍见[本轮笔记](../decisions/implemented/bug-fix/2026-10-29-intents-and-audit-tooling.md)。

## 审阅范围

运行时按职责完整复核 148 份第一方 TypeScript 源码及相关注释：browser-core 51、shared 7、用户脚本 27、扩展 52、Model Worker 11。测试按领域行为、平台接缝和安全/并发负例核对；根与扩展构建/校验/发布工具及两份 workflow 均纳入审阅。当前使用、架构、参考、开发和资产手册按源码及命令交叉检查，历史审计/决定保留日期并验证链接、格式与封印。

第三方压缩 Runtime 按字节身份、许可与实际产物验证，没有把上游压缩实现当作第一方源码逐行重审。

## 修复与精简

| 范围             | 结果                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| 用户脚本 Key     | 排队写入开始前复核意图，淘汰旧验证；敏感 GM 失败不透传原异常或 cause                                   |
| 用户脚本 Runtime | 摘要结算后、资产字节交付前再次复核取消，保留调用方原因                                                 |
| 扩展设置         | 四类模型请求最终交付前复核取消，覆盖额度重连                                                           |
| Worker 探测      | 响应头不匹配错误去除原值，保留预期与请求分类                                                           |
| 扩展工具         | 基准复用有界 ZIP 校验，稀疏维度/采样失败关闭；产物与解压树拒绝符号链接根                               |
| 文档事实         | 常量、正则与函数体统一使用有界缓存 AST，删除手写类型/函数扫描；拒绝语法错误及重复声明                  |
| 决策检查         | 拒绝活跃目录/文件符号链接及断链，拒绝 Markdown 被目录替代                                              |
| CI 与闲置状态    | 删除三个冗余根 Wrangler 渲染步骤及无消费者的 CLI 标志；复用命令行定位结果                              |
| 测试与注释       | 复用面板 mock；删除用户脚本重复取消场景及其搭建代码；Broker 常量回声改为真实截止时序；精简预热复述注释 |

删除的用户脚本“模式读取时取消”用例由 `packages/browser-core/test/captcha/captcha-solver.test.ts` 的同名回归保留，仍断言不提交、不写手动历史及取消结果。GM、平台默认值、Runtime、消息、并发和产物边界继续各自验证，未降低 coverage/include 或增加 skip/todo。

## 性能证据

在 Node 24.22.1 上，以当前 Worker 三份源码的 14 个真实提取调用为一批：修改前后逐值一致，预热后交替执行九批、每批 2000 次，批耗时中位数由 **0.4532 ms 降为 0.0169 ms**。该结果衡量文档事实提取，不是浏览器推理耗时。AST 模块从 400 行减至 148 行，解析缓存最多八份。

## 依赖核对

根和五工作区的直接依赖均按 import、CLI/API、构建及测试消费者复核，没有确认可安全删除的直接包；没有新增依赖或升级版本。TypeScript 原生 CLI 与编译器 API、两个 coverage provider、浏览器/DOM 工具、ZIP、ORT 与 Cloudflare 工具各有独立用途。

- `pnpm audit --json`：369 个锁定包版本，所有严重度均为 0。
- Python 转换链的八个锁定包及 pip 26.2.0：PyPI 当前漏洞元数据为空，未发现撤回版本；167 个锁定文件哈希均存在于对应版本的官方元数据。
- Node 24.22.1 与[官方 2026-10-21 安全修复版本](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)一致。
- ORT JS 构建继续只消费根锁工具及固定上游源码；本轮没有重新安装上游开发依赖、重编 C++/WASM 或改写 vendor 字节。

## 验证记录

- `mise exec -- pnpm check` 通过：1429 项运行时测试，393 项根 Node 测试；工作区 Node 测试用户脚本 31、Worker 82、扩展 190（另一次 12 项产物专用覆盖率检查）。全部现有覆盖率门槛、格式、lint、类型、文档、架构、危险调用、包体与构建门禁通过。
- Action SHA 与检出凭据门禁、vendor README 格式、`git diff --check` 通过。
- 用户脚本 Chromium E2E 10/10，扩展 content fixture 通过，含三次 JPX AJAX 换轮与 BFCache 恢复。
- remote ZIP：Chromium 156.0.8078.47、Firefox 153.0 load-only 通过；基准 CI smoke 4 场景、1600 次操作通过真实 ZIP 读取链。
- 未压缩用户脚本 default 208211 B / 256 KiB，bundled 290988 B / 1 MiB，分别构建并通过各自门禁。
- packaged fixture 与 canonical 的 Chromium 156.0.8078.47 / Firefox 153.0 推理均通过：fixture 匹配 TS/0.95 oracle，覆盖 Offscreen 与后台重启；canonical 在合成图上完成两次非随机推理和会话重建，作为执行链路证据。

四份 packaged 证据均绑定实际 ZIP、树哈希、模型与浏览器，保存在 `/tmp/hv-pony-audit-20261029-5rhsqR`；remote/fixture/canonical 产物和验证日志也保存在该目录。仓库 `dist` 最终保留 canonical 内置扩展和 bundled 用户脚本，生成物未纳入 Git。

生产 Key 鉴权、远程 CI/CodeQL、精确 Chromium 116 / Firefox 140 与 Firefox Android 142 未运行：本次使用本地当前桌面浏览器，没有启用受保护生产验收或外部 Android 环境。对应发布门禁保持原样；canonical 合成图验证不评价真实验证码准确率。

本轮不提交、推送、发布或部署，不访问受保护生产模型。历史审计的测试数、版本和结论保留原日期含义。
