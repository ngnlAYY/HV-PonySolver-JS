# 文档维护规则

文档按读者任务组织，源码和测试定义可观察行为。文档要说明如何操作、为什么保持某个边界、改动如何验证；同一精确契约由明确的专题负责，其他页面给出摘要与链接。

## 文档分工

| 位置                             | 负责内容                                    | 更新触发                         |
| -------------------------------- | ------------------------------------------- | -------------------------------- |
| 根 README                        | 产品选择、最短构建、默认行为、导航          | 用户入口或公开行为变化           |
| `usage/`                         | 用户脚本安装、设置、故障排查                | 控件、默认值、错误或使用流程变化 |
| `architecture/`                  | 职责、数据归属、时序、取消和持久化边界      | 跨模块接口或状态所有权变化       |
| `reference/`                     | 精确 HTTP 方法、头、状态码和鉴权            | 路由或协议变化                   |
| `development/`                   | 开发、命令、验证、发布和文档维护            | 工具链、检查或交付流程变化       |
| 四篇既有专题                     | 扩展产物、缓存确认、运行时资产、Worker 运维 | 对应领域契约变化，保留稳定路径   |
| `decisions/<lifecycle>/<class>/` | 决定的动机、备选、代价与验证                | 非平凡决定或原决定理由翻转       |
| `audits/`                        | 带日期的发现、方法、证据和未知项            | 新审计写新记录，不刷新旧结果     |
| 根 AGENTS.md                     | 仓库强约束与交付规则                        | 目录、依赖、工具或关键不变量变化 |

完整入口见[文档导航](../README.md)。原实施计划页只保留历史导航，具体记录在 audits；长期手册不记录一次性通过数、工作区 ahead 状态、PID 或声称未执行的验证。

## 受保护契约归属

[scripts/docs-drift/check-docs-drift.mjs](../../scripts/docs-drift/check-docs-drift.mjs) 对下列正文逐篇检查，不把全部文档拼成一个字符串。某专题缺失契约时，其他页面中的同名词不能替它通过门禁。

| 契约                         | 文档归属                                                  | 源码依据                                            |
| ---------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| 工具版本、根检查链和命令     | [命令参考](commands.md)                                   | 根及工作区 package scripts、engines、packageManager |
| 图片/输出/超时配置           | [浏览器架构](../architecture/browser-runtime.md)          | `inference-config.ts`                               |
| 模型和 ORT 资产身份          | [Runtime 专题](../onnx-runtime.md)                        | shared 模型清单、`ONNX_RUNTIME_ASSETS`              |
| 路由、Bearer、方法和响应头   | [HTTP 参考](../reference/model-worker-http.md)            | Worker router/access/response 源码                  |
| 缓存及确认                   | [缓存专题](../model-cache-strategy.md)                    | Worker 事实与客户端确认契约                         |
| 部署 secrets、dry-run 和发布 | [运维](../model-worker-ops.md)、[发布](releases.md)       | 手动部署 workflow                                   |
| 依赖门禁和集中管理模块       | [整体架构](../architecture/overview.md)                   | 架构检查与权威模块                                  |
| 扩展路径、权限和支持范围     | [扩展专题](../browser-extension.md)、根 README 的产品摘要 | 扩展包、browser-support、EXTENSION_PATHS            |

[documentation-paths.mjs](../../scripts/docs-drift/documentation-paths.mjs) 列出需要校验复制命令的当前维护页；新增带命令的指南时同步加入。行内命令和 shell 代码块会按包清单检查，历史审计与决定记录不参与当前命令存在性校验。

漂移检查包含结构提取和部分关键词检查，不等同全文语义证明。新增契约先写会拒绝实际漂移的回归，再扩展对应事实提取器；不要删除断言或把所有正文拼接来解决失败。

## 按修改类型同步

| 修改                   | 同步范围                                                     |
| ---------------------- | ------------------------------------------------------------ |
| 默认值、模式、提示     | 使用说明、相关平台、设置/面板/答题测试                       |
| 消息、超时、取消、存储 | 对应架构、扩展/缓存专题、协议/事务/并发测试                  |
| 模型、WASM、glue       | 共享和 Runtime 清单、资产专题、Worker 模板、构建与完整性测试 |
| HTTP 或额度            | 接口参考、服务架构、缓存、运维、漂移与 Worker 测试           |
| 工具、命令、CI         | 命令参考、验证/发布手册、AGENTS、工具链与工作流测试          |
| 目录或导出             | 导航、架构、目录页、所有引用、package exports、测试发现      |
| 发布或部署             | 发布/扩展/运维手册、AGENTS、工作流门禁                       |

README 只同步影响入口和默认体验的摘要。精确哈希与配置字段在所属专题展示，其他页面优先链接权威清单。历史审计中的旧值保留日期语境。

## 决策笔记

本仓库的可交付笔记根为 `docs/decisions/`：AGENTS 要求维护资料按 docs 主题归档，`.agents` 是被忽略的本地工具目录。采用 `write-notes-like-deepseek` 的生命周期/分类与格式；具体取舍见[重建决定](../decisions/implemented/process/2026-09-16-documentation-rebuild.md)。

重要改动必须带决定记录或同步已有记录：行为、架构、跨文件契约、流程工具、测试策略、落盘/网络/配置格式都属于非平凡改动。纯排版、错字、样式或无跨文件影响的机械修改不立 Note。

路径为 `decisions/{proposed,implemented,rejected,archived}/{feature,bug-fix,simplification,architecture,process,testing}/yyyy-mm-dd-topic.md`，只创建实际使用的目录，不建 INDEX。前三行固定为标题、空行、状态；正文首节为 Problem，并且必须有 Alternatives considered。

```markdown
# Agent Note: 决定标题

Status: implemented

## Problem

独立描述触发条件和问题。

## Decision

用现在时说明当前决定、边界和原因。

## Alternatives considered

真实考虑的备选，先写其优势，再说明未选原因。

## Consequences

收益、代价、上限和重新评估条件。
```

新想法在 proposed 中写 Proposal、Acceptance criteria、Risks；落实时同批移到 implemented，改成 Decision，把计划和风险折入当前后果/验证。事实变化原地更新；决定或理由翻转时另写新篇并互链，不把旧理由改成相反意思。rejected 的 Status 行必须带原因；没有防坑价值的记录不保留。只归档已完成且参考价值低的 implemented，归档文件以 manifest 哈希封印，不修改旧封印。

落笔前按关键词搜索所有活跃 lifecycle，明确无关、部分重叠、完全吸收或过时提案，并把处理结果记录在新篇。可使用：

```bash
rg --hidden --glob '!docs/decisions/archived/**' '机制名或关键词' docs/decisions/
```

笔记结构和状态由[笔记校验入口](../../scripts/docs-drift/verify-notes.mjs)检查；取舍是否真实、理由是否充分和代价是否明确仍需审阅。归档时在 `Status: implemented` 后紧邻写入 `Archived: YYYY-MM-DD`，移动到 archived 的对应类别，再运行 `AGENT_NOTE_ROOT=docs/decisions mise exec -- node scripts/docs-drift/notes/verify-archived-agent-notes.ts --write` 追加封印。只允许新增封印，不能改写既有项。CI guardrails 使用完整 Git 历史，PR 比较 base SHA、push 比较 before SHA，不能使用本次 HEAD 冒充变更前状态；本地与无前后版本对的手动校验使用 HEAD。

## 链接、示例与证据

使用相对 Markdown 链接，文件路径必须存在；符号写在链接旁，不依赖易漂移行号。标题改名后检查所有入站锚点。命令写明执行目录、准备条件、产物与证明范围；不同构建互相覆盖时分别展示“构建 → 对应测试”，不要把所有命令拼成一个可误运行的流水线。

离线测试、公开线上探测、受保护鉴权与真实发布分开说明。Key、Bearer、Cloudflare 凭据、真实绑定标识不进入例子、日志或文档。示例只使用清晰占位符或约定的测试绑定；输入秘密由受保护环境提供，不放入 CLI 参数。

## 验证文档修改

在仓库根目录执行：

```bash
mise exec -- pnpm format:check
mise exec -- pnpm docs:check
mise exec -- node --test "scripts/docs-drift/test/*.test.mjs"
git diff --check
```

`docs:check` 执行事实漂移、文件/目录/标题链接和笔记校验；测试对缺项、错误事实、无效来源提取与失效链接作故障注入。改动检查器还需运行 lint 与相关根级测试。

链接检查支持项目使用的内联 Markdown 链接，跳过 fenced code、行内代码、外部 URL 和声明的生成目录，复核符号链接真实目标；不存在或不可扫描的根失败。它不验证外部网站可用性，也不完整解析 reference-style/HTML 链接和所有 Markdown 扩展。

Runtime 随附 README 不在默认格式/链接门禁内，修改后单独核对资产与相对路径，并执行：

```bash
mise exec -- pnpm exec prettier --check --ignore-path /dev/null apps/userscript/vendor/onnxruntime/README.md
```

这条 POSIX/Git Bash 命令只对指定 README 绕过忽略规则，不重新格式化第三方压缩资产。交付时列出实际通过项和未运行项，不把文档通过解释为业务、真实鉴权或线上部署通过。
