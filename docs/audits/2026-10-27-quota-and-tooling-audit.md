# 2026-10-27 额度、取消与工具链全仓复核

基线 `b136102`，开始时工作区干净，main 比 origin/main 领先两个提交。按模块并行审阅最新第一方源码、注释、测试与文档，并核对依赖实际用途；保留第三方 Runtime、模型身份、历史审计证据和既有安全边界。基线有 451 个跟踪文件，其中 148 份运行时源码。

## 范围与发现

| 范围                             | 结果                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| browser-core，51 份源码          | 复核 DOM/提交、生命周期、推理 top-N 与 RGBA 转换、流、缓存、历史及面板；现有优化和边界保留，无新增运行时修改                                                 |
| userscript，27 份源码及构建/测试 | 修复构建测试继承外部输出路径；菜单验证失败与取消测试改用 GM 存储并精简重复构造                                                                               |
| extension，52 份源码             | 修复成功消息交付后、调用返回前的取消/销毁竞态；销毁后不再进行图片编码                                                                                        |
| extension scripts                | 补齐 `.html/.htm` 大小写审计；模型先检查文件长度；合并基准身份、计数与 ZIP fixture 构造                                                                      |
| Model Worker，11 份源码          | 存储读取后重新判断 UTC 月份与 TTL；公开额度响应只投影契约字段                                                                                                |
| shared，7 份源码                 | 复核答案、令牌、模型与 ORT 纯契约，无需修改                                                                                                                  |
| 根 scripts / CI / 配置           | 共用 Markdown 围栏扫描器、优化重复标题锚点、补齐临时目录清理；核对检查链、发布授权、Action 固定与依赖策略                                                    |
| 文档                             | 同步服务/扩展架构、HTTP、验证、文档规则、AGENTS 与导航；新增[决定](../decisions/implemented/bug-fix/2026-10-27-quota-boundaries-and-audit-simplification.md) |

## 缺陷证据与精简

- 真实 Durable Object 的 status/reserve/confirm 跨月等待及 confirm 跨 TTL 共四项回归先失败；修改后使用读取完成时的当前时间。
- GET/POST 额度内部响应额外字段两项回归先失败；显式投影后不再泄露额外字段或覆盖 `enabled`。
- 扩展 prepare/detect 与 abort/destroy 四种响应交付时序，基线三项失败；修改后均拒绝已失效调用。
- 用户脚本构建测试在基线覆盖三个外部哨兵产物文件且测试退出失败；隔离环境变量后测试通过、哨兵保持原内容。继承无效 Runtime override 的负向环境也通过。
- Worker 删除一条重复的 uppercase token 测试；保留的 uppercase Authorization Bearer 用例继续断言 200 和真实正文，并额外覆盖 scheme 大小写。
- 用户脚本三个验证失败场景改为参数化，不减少场景；取消场景仍独立验证 GM 未写入/删除。Release 篡改 ZIP 继续执行实际归档和身份检查，只移除重复构造器。
- 基准仍由逐样本校验拒绝正确性失败，保留成功次数、错误次数及摘要字节数；删除未消费的单次耗时数组，不改变测量口径。

文档围栏沿用字符、长度、info string 和裸关闭行规则；笔记注释与围栏互不泄漏。既有混合围栏、伪关闭、注释与封印回归继续保护三个调用方。重复标题锚点保留显式后缀碰撞行为，1000 份确定性混合标题输入与基线逐项一致。

## 局部算法验证

标题锚点旧算法为每个重复标题从零查找后缀；新算法保存每个 base 的下一个候选，重复标题从二次方搜索降为线性推进。用 Node.js 24.22.1 分别加载基线与当前函数，预热各五次后交替执行九批，比较同一输入的中位耗时：

| 相同标题数量 | 基线          | 修改后    |
| ------------ | ------------- | --------- |
| 100          | 2.724 ms      | 0.323 ms  |
| 10,000       | 12,783.208 ms | 18.515 ms |

这是重复标题压力输入下的锚点生成测量；项目整题推理算法本轮保持不变。临时基准位于仓库外，并验证 1000 份混合普通/显式后缀/中文标题的输出完全一致。

## 依赖

冻结安装通过，包含开发依赖的 `pnpm audit --json` 返回 0 个已知漏洞公告，传递依赖共 363 项。核对 ORT、esbuild、fflate、jsdom/Playwright、Cloudflare 工具、Vitest/coverage、TypeScript CLI/API、ESLint 与 Prettier 的直接调用或命令用途，没有新增可安全删除项；清单和锁文件不变。

Python 哈希锁八项与 pip 26.2.0 逐版本查询 PyPI JSON，`vulnerabilities` 均为空；这是该接口的公告范围。本轮未重建 ORT、替换模型或迁移已弃用的 Cloudflare pool。

## 验证

使用 mise 固定工具链。先运行模块定向回归，再以本机资源设置执行一次完整检查：

```bash
PNPM_CONFIG_WORKSPACE_CONCURRENCY=1 taskset -c 0-2 mise exec -- pnpm check
```

未修改默认测试并发、超时、coverage include 或门槛，没有新增 skip/todo。完整检查通过 1,405 项 Vitest、383 项根级 Node 测试，以及包内 Node/覆盖率、格式、lint、类型、文档、架构、危险调用、扩展打包和构建。

| 验证                      | 结果                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| 冻结安装、npm/Python 公告 | 通过；公告结果见依赖章节                                                                            |
| Action pin、diff          | 通过                                                                                                |
| 用户脚本双 profile        | default 206644 字节、bundled 156578 字节，各自预算通过；前者未压缩、后者压缩                        |
| 用户脚本 E2E              | Chromium 10 项通过                                                                                  |
| 扩展 content fixture      | 自动/手动、单次识别提交、历史、fieldset 恢复、action 变化、BFCache、JPX 连续三轮通过                |
| remote load-only          | Chromium 156.0.8078.47 与 Firefox 153.0 通过                                                        |
| benchmark:ci              | 四种场景共 1600 次操作（含预热），测量样本 1200 次成功、0 错误；JSON/CSV 校验通过                   |
| packaged fixture          | 双浏览器真实 ORT 推理、ZIP 校验与会话重建通过；Chromium 另验证后台重启、旧 epoch 取消与空闲回收重建 |

canonical 内置包复用本地固定模型，Chromium 156.0.8078.47 与 Firefox 153.0 均完成真实推理和会话重建，无 Key、无随机回退。两种模式的 schema 2 证据均为 passed，tree.fileCount 为正整数，归档长度与 SHA-256 已再次对应仓库外保留 ZIP。

Worker 测试使用 test-kv/test-bucket，生成配置已按仓库外备份逐字节恢复。Firefox 使用已安装的 Playwright Firefox 与核对版本后的 geckodriver 0.37.1。内置包、浏览器证据、基准结果和日志保存在仓库外临时目录，不纳入 Git。仓库 dist 最终保留 remote 扩展与 bundled 用户脚本。

补齐报告后，文档回归 204 项、格式、文档门禁、Action pin 与 diff 检查通过。

未运行生产 Key 鉴权、远程 CI/CodeQL、精确最低浏览器版本或 Firefox Android 验收：本机只有上述当前桌面浏览器，未启用受保护生产环境。未提交、推送、发布或部署。
