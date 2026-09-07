# 文档导航

本文是维护者文档入口。安装、功能、构建产物与公开命令从[项目 README](../README.md)开始；需要修改源码时，按下面的任务选择专题。

目录和门禁优化已完成并记录在[审计优化实施记录](development/implementation-plan.md)。本页及架构、开发、运行时专题描述当前实现；`audits/` 保留审计时的数字和发现，并标明后续处理状态。

## 按任务查阅

| 要做什么                       | 先读                                                    | 再看                                                  |
| ------------------------------ | ------------------------------------------------------- | ----------------------------------------------------- |
| 理解整个项目的职责和数据流     | [整体架构](architecture/overview.md)                    | 各工作区 `package.json` 与入口文件                    |
| 修改识别、勾选、提交或状态面板 | [浏览器核心与用户脚本](architecture/browser-runtime.md) | `packages/browser-core/test` 的对应领域               |
| 修改扩展消息、后台、设置或存储 | [扩展运行时](architecture/extension-runtime.md)         | [扩展产品、安全与发布契约](browser-extension.md)      |
| 修改模型路由、鉴权或下载额度   | [Model Worker 与 shared](architecture/model-service.md) | [模型缓存策略](model-cache-strategy.md)               |
| 准备开发环境、选择验证命令     | [开发与验证](development/verification.md)               | [贡献、代码风格与注释](development/contributing.md)   |
| 整理目录、拆分职责集中的模块   | [目录组织与维护](development/directory-layout.md)       | [历史仓库审计](audits/2026-09-07-repository-audit.md) |
| 补充或更新文档                 | [文档维护规则](development/documentation.md)            | 下方权威来源说明                                      |
| 更新模型或定制运行时资产       | [ONNX Runtime](onnx-runtime.md)                         | [模型缓存策略](model-cache-strategy.md)与共享资产清单 |
| 部署、探测或回滚 Model Worker  | [Worker 运维](model-worker-ops.md)                      | [服务端架构](architecture/model-service.md)           |
| 查看历史审计及后续处理状态     | [审计报告](audits/2026-09-07-repository-audit.md)       | [文件盘点](audits/source-inventory.md)                |

## 文档分组

```text
docs/
├── README.md                   文档入口
├── architecture/               模块职责、数据流与生命周期
├── development/                开发、验证、风格和目录维护
├── audits/                     有日期与验证边界的审计快照
├── browser-extension.md        扩展产品、安全和发布契约
├── model-cache-strategy.md      缓存与下载确认契约
├── model-worker-ops.md          部署、探测和回滚
└── onnx-runtime.md              运行时供应链与资产复现
```

现有四篇专题保留原路径，维持 README、漂移检查及外部链接的可用性。新增文档进入主题目录；审计数字保存在快照中，避免让每篇维护手册都重复维护文件数和测试数。

项目维护的运行时随附说明还包括 `apps/userscript/vendor/onnxruntime/README.md`，用于记录精简 glue/WASM 的配对和采用步骤；它与本目录的 ONNX Runtime 专题一同更新。第三方压缩代码和许可证的维护边界与项目说明文档分别处理。

## 权威来源

源码定义实现，测试锁定可观察契约；文档解释使用方法、原因和维护路径。客户端版本以各应用的 `package.json` 为准，工具版本以 `mise.toml` 为准，格式规则以根 `package.json#prettier` 和 `eslint.config.mjs` 为准，资产身份以共享清单及用户脚本 Runtime 清单为准，部署配置以 `wrangler.template.toml` 为准。

详细对应关系见[整体架构的权威模块表](architecture/overview.md#权威模块与变更入口)。发现文档与源码不一致时，应沿源码和测试核实，不应只修改文档让漂移检查通过。

## 修改后的文档检查

在仓库根目录执行：

```bash
mise exec -- pnpm format:check
mise exec -- pnpm docs:check
mise exec -- node --test "scripts/docs-drift/test/*.test.mjs"
git diff --check
```

这些命令验证格式、受保护契约、本地链接和检查器回归，不执行模型下载或部署。vendor 中的项目 Runtime README 需要单独核对，检查范围和其他边界见[文档维护规则](development/documentation.md#验证文档修改)。
