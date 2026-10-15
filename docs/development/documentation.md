# 文档维护规则

按读者任务组织文档，以源码和测试核对行为。同一精确契约只在所属专题维护，其他页面给摘要与链接；历史结果保留日期，不作为当前验证证据。

## 文档分工

| 位置                             | 内容                               | 更新触发                     |
| -------------------------------- | ---------------------------------- | ---------------------------- |
| 根 README                        | 产品选择、最短构建、默认体验和入口 | 客户端入口或公开行为变化     |
| `usage/`                         | 安装、设置、排错                   | 控件、默认值、错误和流程变化 |
| `architecture/`                  | 职责、所有权、时序、取消与持久化   | 跨模块接口或状态变化         |
| `reference/`                     | 精确 HTTP 方法、头、状态码、鉴权   | 协议变化                     |
| `development/`                   | 开发、命令、验证、发布、文档规则   | 工具链或交付流程变化         |
| 四篇既有专题                     | 扩展、缓存、Runtime、Worker 运维   | 对应契约变化，保持稳定路径   |
| `decisions/<lifecycle>/<class>/` | 动机、决定、备选、代价与验证       | 非平凡决定或理由翻转         |
| `audits/`                        | 带日期的发现、方法、证据与未知项   | 新审计另写，不刷新旧结果     |
| 根 AGENTS                        | 开发与交付强约束                   | 目录、依赖、工具或不变量变化 |

入口见[文档导航](../README.md)。实施计划页仅作历史导航；长期手册不堆积一次性通过数、ahead 状态、PID 或未执行的验证。

## 受保护契约归属

[漂移检查](../../scripts/docs-drift/check-docs-drift.mjs)逐篇验证，不拼接全部正文；其他页面的同名词不能补足所属专题的缺项。

| 契约                       | 所属文档                                             | 事实来源                                       |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| 工具版本、检查链、命令     | [命令参考](commands.md)                              | package scripts、engines、packageManager、mise |
| 图片、输出、超时配置       | [浏览器架构](../architecture/browser-runtime.md)     | `inference-config.ts`                          |
| 模型/ORT 资产身份          | [Runtime](../onnx-runtime.md)                        | shared 与 `ONNX_RUNTIME_ASSETS` 清单           |
| 路由、Bearer、方法、响应头 | [HTTP 参考](../reference/model-worker-http.md)       | Worker router/access/response                  |
| 缓存与确认                 | [缓存专题](../model-cache-strategy.md)               | Worker 与客户端事务契约                        |
| secrets、dry-run、发布     | [运维](../model-worker-ops.md)、[发布](releases.md)  | 手动部署 workflow                              |
| 依赖和权威模块             | [整体架构](../architecture/overview.md)              | 架构门禁与源码                                 |
| 扩展路径、权限、支持范围   | [扩展专题](../browser-extension.md)、README 产品摘要 | 扩展包、browser-support、`EXTENSION_PATHS`     |

[documentation-paths.mjs](../../scripts/docs-drift/documentation-paths.mjs)列出当前命令维护页；新增带命令的指南须加入。校验按包清单核对行内命令与 shell 代码块，历史审计和决定不参与当前命令存在性检查。

新增契约先写能拒绝实际漂移的回归，再扩展事实提取器；不删断言以适应正文。类型后缀按完整 TypeScript initializer 判定，`as`/`satisfies` 后接运行时运算不得当字面量；HTTP 状态读取完整数字实参，不接受数字前缀。回归修改 fixture 源码前后都断言预期锚点和变体存在，避免迁移后替换空跑。R2 上传直接检查复制命令：必须显式选远程 R2，并从 `apps/model-worker` 定位 `../../other/` 对应资产；相邻文字不能补足缺失的 `--remote`、错误路径或覆盖远程选择的额外参数。结构/关键词检查不能证明全文语义正确。

## 按修改类型同步

| 修改                   | 同步范围                                                  |
| ---------------------- | --------------------------------------------------------- |
| 默认值、模式、提示     | 使用页、相关平台、设置/面板/答题测试                      |
| 消息、超时、取消、存储 | 对应架构、扩展/缓存专题、协议/事务/并发测试               |
| 模型、WASM、glue       | 共享/Runtime 清单、资产专题、Worker 模板、构建/完整性测试 |
| HTTP、额度             | HTTP、服务架构、缓存、运维、漂移/Worker 测试              |
| 工具、命令、CI         | 命令、验证/发布、AGENTS、工具链/工作流测试                |
| 目录、导出             | 导航、架构、目录页、引用、exports、测试发现               |
| 发布、部署             | 发布/扩展/运维、AGENTS、工作流门禁                        |

README 只同步用户入口摘要；精确哈希、配置字段和协议矩阵留在权威专题。精简可合并复述，不删前提、失败路径、安全边界或未验证项；旧审计中的数字、版本、commit 和结论仍属于原验证时点。

## 决策笔记

可交付笔记放在 `docs/decisions/`；`.agents` 是被忽略的本地工具目录。沿用 `write-notes-like-deepseek` 的生命周期、六类分类与结构，取舍见[重建决定](../decisions/implemented/process/2026-09-16-documentation-rebuild.md)。

行为、架构、跨文件契约、工具流程、测试策略和落盘/网络/配置格式变化须更新已有决定或新增笔记；排版、错字和机械修改无需立 Note。路径为 `decisions/{proposed,implemented,rejected,archived}/{feature,bug-fix,simplification,architecture,process,testing}/yyyy-mm-dd-topic.md`，仅建使用的目录，不建 INDEX。

前三行固定为标题、空行、状态；首节必须是 Problem，并保留 Alternatives considered：

```markdown
# Agent Note: 决定标题

Status: implemented

## Problem

触发条件与问题。

## Decision

当前决定、边界和原因。

## Alternatives considered

真实备选的优势与未采用原因。

## Consequences

收益、代价、上限与重新评估条件。
```

- proposed 写 Proposal、Acceptance criteria、Risks；实施同批移入 implemented，改为 Decision，将计划与风险折入后果/验证。
- 事实变化原地更新，决定或理由翻转另写并互链。rejected 的 Status 行带原因，无防坑价值的记录不保留。
- 落笔前检索活跃 lifecycle，记录无关、部分重叠、完全吸收或过时提案的处理；[笔记检查](../../scripts/docs-drift/verify-notes.mjs)验证结构，不能代替取舍审阅。

```bash
rg --hidden --glob '!docs/decisions/archived/**' '机制名或关键词' docs/decisions/
```

仅归档已完成且参考价值低的 implemented：在 Status 后紧邻加 `Archived: YYYY-MM-DD`，移入 archived 对应类别，再执行 `AGENT_NOTE_ROOT=docs/decisions mise exec -- node scripts/docs-drift/notes/verify-archived-agent-notes.ts --write` 追加封印；不改写既有封印。

笔记根及其祖先、归档目录/Markdown/manifest 必须为实际目录或普通文件，拒绝 symlink。包装器和直接入口都检查路径，不能因链接走出仓库而把 Git 基线校验降为可选；CI 事件 JSON 解析失败只报告固定错误，不回显内容。清单严格检查版本、归档相对 Markdown 路径、SHA-256；逐条读取并重算，路径存在或扫描命中不等于有效。缺失归档目录可选，但已有清单或路径异常时 `--write` 必须失败且不改清单。Git 仓库内直接验证/封印也先解析 `AGENT_NOTE_ARCHIVE_BASE_REF`（默认 HEAD）为可用 commit，再检查该树是否缺清单；无效引用、非 commit 或 Git 读取失败不能冒充首次封印。

CI guardrails 读取完整 Git 历史，PR 对比 base SHA，push 对比 before SHA，不用本次 HEAD 冒充变更前状态；本地及无前后版本对的手动校验使用 HEAD。

## 链接、示例与证据

使用相对 Markdown 链接；符号写在链接旁，不依赖易漂移行号。文件须存在，改标题后检查入站锚点。命令说明执行目录、前提、产物和证明范围；构建互相覆盖时分别展示“构建 → 对应测试”。

离线、公开探测、受保护鉴权和发布证据分别记录。示例只用明确占位符或约定测试绑定；Key、Bearer、凭据、真实绑定不进入文档、日志或 CLI 参数，由受保护环境提供。

## 验证文档修改

仓库根执行：

```bash
mise exec -- pnpm format:check
mise exec -- pnpm docs:check
mise exec -- node --test "scripts/docs-drift/test/*.test.mjs"
git diff --check
```

`docs:check` 包含事实、链接、笔记校验；回归对缺项、错误事实、无效提取和失效链接作故障注入。修改检查器还需 lint 和相关根级测试。

链接门禁检查内联 Markdown 的文件、目录、标题及 symlink 真实目标，缺失/不可扫描根失败；跳过 fenced code、行内代码、外部 URL 和声明的生成目录。不验证外站，也不完整解析 reference-style/HTML 链接或全部 Markdown 扩展。

Runtime 随附 README 不在默认格式/链接门禁内，修改后另核对资产、相对路径，并运行：

```bash
mise exec -- pnpm exec prettier --check --ignore-path /dev/null apps/userscript/vendor/onnxruntime/README.md
```

此 POSIX/Git Bash 命令只对指定 README 绕过忽略规则。交付列明实际通过与未运行项；文档通过不代表业务、真实鉴权或线上部署通过。
