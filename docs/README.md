# 文档导航

使用产品从[根 README](../README.md)开始；修改项目按下面的任务进入。当前文档依据源码、包配置、资产清单和工作流维护；审计页保留各自日期的历史证据，不代表当前检查结果。

## 按任务阅读

| 任务                   | 主要文档                                                                             | 内容边界                                          |
| ---------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 安装用户脚本、找到菜单 | [用户脚本指南](usage/userscript.md)                                                  | 两种 Runtime profile、安装、输出和 GM 存储        |
| 构建或加载扩展         | [浏览器扩展](browser-extension.md)                                                   | remote/packaged、支持版本、权限、ZIP 与浏览器证据 |
| 调整自动答题或面板     | [设置与行为](usage/settings.md)                                                      | 手动答案、提交安全、可见性、历史和耗时            |
| 排查错误               | [故障排查](usage/troubleshooting.md)                                                 | 运行时、Key、额度、DOM、构建和面板问题            |
| 理解工作区和数据归属   | [整体架构](architecture/overview.md)                                                 | 依赖方向、平台能力、权威模块                      |
| 修改 DOM、推理或面板   | [浏览器核心与用户脚本](architecture/browser-runtime.md)                              | 调度、取消、答案归属、Worker、历史                |
| 修改扩展后台或消息     | [扩展运行时](architecture/extension-runtime.md)                                      | Port、Broker、Offscreen、Host、Key 事务与设置镜像 |
| 修改服务端逻辑         | [Model Worker 架构](architecture/model-service.md)                                   | KV/R2/DO 所有权、预留与确认状态机                 |
| 实现或调试 HTTP 客户端 | [HTTP 契约](reference/model-worker-http.md)                                          | 路由、方法、鉴权、响应矩阵和 CORS                 |
| 修改模型缓存           | [缓存与计次](model-cache-strategy.md)                                                | 实际字节校验、IndexedDB 事务、确认与取消          |
| 更新模型或运行时       | [模型与 ONNX Runtime](onnx-runtime.md)                                               | 资产原子身份、构建、安全清理与采用步骤            |
| 准备开发和测试         | [验证手册](development/verification.md)、[命令参考](development/commands.md)         | 工具链、测试绑定、最小验证、完整检查              |
| 新增模块或移动文件     | [贡献规范](development/contributing.md)、[目录组织](development/directory-layout.md) | 类型、注释、资源清理、导出和路径联动              |
| 发布客户端             | [CI 与发布](development/releases.md)                                                 | artifact、Release、CodeQL 与受保护证据            |
| 部署或回滚 Worker      | [运维手册](model-worker-ops.md)                                                      | 配置、R2、环境门禁、公开探测及持久状态            |
| 修改文档               | [文档维护](development/documentation.md)                                             | 契约归属、链接、漂移与决策记录                    |

## 文档结构

```text
README.md                         产品入口
AGENTS.md                         仓库开发与交付约束
docs/
├── README.md                      按任务导航
├── usage/                         安装、设置、故障排查
├── architecture/                  实现职责、时序与所有权
├── reference/                     精确 HTTP 契约
├── development/                   开发、命令、验证、发布、文档维护
├── decisions/<lifecycle>/<class>/ 决定、理由、备选与后果
├── audits/                        带日期的历史发现与验证证据
├── browser-extension.md           扩展产品与打包契约
├── model-cache-strategy.md         缓存及确认契约
├── model-worker-ops.md             Worker 运维
└── onnx-runtime.md                 模型和运行时资产
```

四篇原有专题保留路径。Runtime 随附 README 位于 `apps/userscript/vendor/onnxruntime/README.md`，与资产专题同步维护，单独检查格式。第三方压缩代码和许可证不按说明文档重写。

## 决策与历史

本次[文档重建决定](decisions/implemented/process/2026-09-16-documentation-rebuild.md)说明契约迁移、保留旧专题路径和历史证据分离的理由。决策按生命周期与类别检索，不另建 INDEX。

[2026-09-07 仓库审计](audits/2026-09-07-repository-audit.md)记录当时发现，[源码盘点](audits/source-inventory.md)记录当时数量，[优化实施记录](audits/2026-09-07-implementation-record.md)保存迁移和验证。旧[实施入口](development/implementation-plan.md)继续提供导航。这些记录中的通过数、浏览器版本、commit 和未运行项目均保持历史含义。

## 事实来源与检查

客户端版本看各应用 `package.json`；工具链看 `mise.toml`；包命令和格式规则看根 `package.json`；资产看 shared 与 Runtime 清单；部署配置看 `wrangler.template.toml`。详细映射见[架构权威模块表](architecture/overview.md#权威模块与变更入口)。

文档检查使用 `mise exec -- pnpm docs:check`，受保护事实逐篇校验，本地链接与决策结构一起检查。完整文档验证命令及 vendor 例外见[维护规则](development/documentation.md#验证文档修改)。通过这些检查不能替代业务测试、浏览器 E2E 或线上服务验收。
