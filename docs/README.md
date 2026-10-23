# 文档导航

安装与构建从[根 README](../README.md)开始。当前手册以源码、包配置、资产清单和工作流为准；审计与决策中的验证结果保留原日期含义。

## 按任务阅读

| 任务            | 文档                                                                                   | 负责内容                               |
| --------------- | -------------------------------------------------------------------------------------- | -------------------------------------- |
| 安装用户脚本    | [用户脚本指南](usage/userscript.md)                                                    | Runtime profile、安装、菜单、GM 存储   |
| 构建或加载扩展  | [浏览器扩展](browser-extension.md)                                                     | remote/packaged、权限、ZIP、支持范围   |
| 调整答题和面板  | [设置与行为](usage/settings.md)                                                        | 默认值、手动答案、历史与耗时           |
| 排查错误        | [故障排查](usage/troubleshooting.md)                                                   | 加载、Key、额度、DOM、面板             |
| 理解工作区      | [整体架构](architecture/overview.md)                                                   | 依赖方向、数据归属、权威模块           |
| 修改 DOM 或推理 | [浏览器运行时](architecture/browser-runtime.md)                                        | 调度、取消、答案、Worker、历史         |
| 修改扩展后台    | [扩展运行时](architecture/extension-runtime.md)                                        | Port、Broker、Host、Key 事务、设置镜像 |
| 修改模型服务    | [服务架构](architecture/model-service.md)、[HTTP 契约](reference/model-worker-http.md) | KV/R2/DO、路由、响应与 CORS            |
| 修改缓存或资产  | [缓存与计次](model-cache-strategy.md)、[Runtime](onnx-runtime.md)                      | 完整性、事务、确认、模型与运行时更新   |
| 开发和验证      | [验证手册](development/verification.md)、[命令参考](development/commands.md)           | 工具链、测试配置、检查与证据边界       |
| 新增或移动模块  | [贡献规范](development/contributing.md)、[目录组织](development/directory-layout.md)   | 类型、注释、导出、路径联动             |
| 发布或部署      | [CI 与发布](development/releases.md)、[Worker 运维](model-worker-ops.md)               | 客户端发布、部署、回滚与门禁           |
| 维护文档        | [文档规则](development/documentation.md)、[AGENTS](../AGENTS.md)                       | 契约归属、链接、决策与交付约束         |

## 文档结构

`usage/` 放使用说明，`architecture/` 放实现职责与时序，`reference/` 放精确协议，`development/` 放开发与发布流程。扩展、缓存、Runtime、Worker 运维四篇专题保留现有路径；完整目录见[目录组织](development/directory-layout.md)。

`decisions/<lifecycle>/<class>/` 记录决定、备选与后果，不另建 INDEX；`audits/` 保存带日期的证据。Runtime 随附 [README](../apps/userscript/vendor/onnxruntime/README.md) 与资产专题同步维护，并单独检查格式；第三方压缩代码和许可证保持原样。

## 决策与历史

[文档重建决定](decisions/implemented/process/2026-09-16-documentation-rebuild.md)说明契约归属与稳定路径。最新修复见[提交地址、编码长度与跨世界边界](decisions/implemented/bug-fix/2026-10-23-audit-boundaries-and-encoding.md)；此前的[生命周期、清除准入与响应资源](decisions/implemented/bug-fix/2026-10-22-audit-lifecycle-and-admission.md)、[取消交接与有界读取](decisions/implemented/bug-fix/2026-10-22-audit-resource-and-ordering.md)及[取消收尾、静态校验与 CI 恢复](decisions/implemented/bug-fix/2026-10-22-audit-cancellation-and-ci.md)保留原证据。其余记录按主题检索 [decisions](decisions/)，原验证结果保留各自日期含义。

| 历史记录                                                                 | 内容                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [2026-09-07 仓库审计](audits/2026-09-07-repository-audit.md)             | 初次维护结构发现与后续处理状态                                               |
| [源码盘点](audits/source-inventory.md)                                   | 审计前与 `ef5efc9` 的文件数量和统计口径                                      |
| [优化实施](audits/2026-09-07-implementation-record.md)                   | 迁移、根配置精简与验收；[旧入口](development/implementation-plan.md)继续导航 |
| [2026-09-29 Web 与扩展审计](audits/2026-09-29-web-extension-audit.md)    | 有界流、生命周期、校验、MV3 与未验证范围                                     |
| [同日依赖补丁复核](audits/2026-09-29-dependency-security-remediation.md) | Vitest/undici 补丁与当时的复验                                               |

## 事实来源与检查

版本看应用 `package.json`，工具链看 `mise.toml`，命令与格式看根 `package.json`，资产看 shared/Runtime 清单，部署看 `wrangler.template.toml`。详细入口见[权威模块表](architecture/overview.md#权威模块与变更入口)。

`mise exec -- pnpm docs:check` 逐篇检查受保护事实、本地链接和决策结构。完整命令与 vendor 例外见[文档验证](development/documentation.md#验证文档修改)；文档通过不代替业务测试、浏览器 E2E 或线上验收。
