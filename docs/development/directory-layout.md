# 目录组织与新增文件规则

本页回答文件应放在哪里、哪些边界需要保持、移动文件后要联动什么。具体命令见[命令参考](commands.md)，模块时序见[架构导航](../architecture/overview.md)。

## 当前组织

```text
apps/
├── extension/
│   ├── src/{background,content,host,offscreen,options,platform,protocol}/
│   ├── scripts/{build,benchmark,browser,e2e,fixtures,model,release}/
│   └── test/{background,content,host,offscreen,options,platform,protocol}/
├── model-worker/{src,test,scripts}/
└── userscript/{src/{app,captcha,inference,model,persistence,status-panel,userscript},scripts,test}
packages/
├── browser-core/src/{app,captcha,inference,model,persistence,platform,status-panel,utils}
└── shared/src/{answer,model,ort-assets,ort-model,ort-runtime,token}.ts
scripts/
├── checks/       架构、浏览器危险调用、包体预算
├── ci/           Action、版本、工作流契约
├── docs-drift/   文档检查、事实提取器和文档检查测试
├── e2e/          仓库级用户脚本 E2E 入口
├── lib/          CLI、direct-run、源码收集等共享工具
├── model/        模型 manifest 与 release notes
└── ort-runtime/ ORT 构建、构建根保护和锁定依赖
```

根与扩展脚本各按七个职责目录组织。`apps/extension/scripts/benchmark/` 进一步把参数契约、统计、比较、CSV 输出和产品/runner 分开；这几个文件共同定义基准证据格式，不应重新合并成单一脚本。

核心业务目录已经按领域分组。`browser-core/src` 的 `app`、`captcha`、`inference`、`model`、`persistence`、`platform`、`status-panel`、`utils` 与对应测试目录保持镜像；用户脚本的薄适配器继续按 `app`、`captcha`、`inference`、`model`、`persistence`、`status-panel`、`userscript` 分组。大协调模块是否继续拆分，要以状态所有权和测试边界为准，不按文件数量机械拆分。

根配置保持按工具职责分开：`package.json` 提供 workspace 脚本、Prettier 规则和包管理器声明，`mise.toml` 固定 Node.js/pnpm，`eslint.config.mjs` 提供全仓库 flat config，`tsconfig.base.json` 提供共享 TypeScript 选项，`.prettierignore` 定义生成物和第三方资产的格式忽略边界。已删除的独立 Prettier 配置和 Vitest workspace 不应重新引入。

扩展的生成目录和 ZIP 按 `background/`、`content/`、`options/`、`offscreen/`、`runtime/`、`model/` 组织，其中 `offscreen/` 仅用于 Chromium，`model/` 仅用于内置模型版；完整结构见[扩展产物说明](../browser-extension.md#build-outputs-and-local-loading)。入口路径由 [`EXTENSION_PATHS`](../../apps/extension/src/platform/extension-paths.ts) 统一维护；输出根、`chromium/`、`firefox/` 和 ZIP 名称保持原约定。

## 迁移历史

旧路径与逐文件迁移表保留在[2026-09-07 实施记录](../audits/2026-09-07-implementation-record.md)，不作为当前可执行入口。包命令提供稳定入口，源码不保留永久旧路径转发壳。

## 协议和测试目录

扩展协议已从一个大文件拆成职责明确的模块：

- `protocol-validation.ts`：协议常量、基础结构和通用 guard。
- `port-messages.ts`：内容/设置 Port 的请求、响应、状态和凭证消息。
- `offscreen-messages.ts`：Chromium Offscreen claim、request、cancel、idle 和状态消息。
- `image-payload.ts`：图片 MIME/Base64 上限、编码和解码。
- `messages.ts`：稳定聚合入口，继续为调用方提供显式 re-export。

测试仍可从 `test/protocol/messages.test.ts` 验证聚合协议，但新增测试应靠近实际职责；不要重新把所有 guard 和 payload 实现塞回聚合入口。

Model Worker 的集成测试也已按行为拆分：

- `apps/model-worker/test/http-cors.test.ts`：路由方法、CORS 和响应头。
- `model-runtime-assets.test.ts`：模型/Runtime 对象和完整性。
- `quota-http.test.ts`：公开 quota HTTP 契约。
- `model-download-quota.test.ts`：Durable Object reserve/confirm/状态。
- `failure-timeout.test.ts` 与 `request-timeout.test.ts`：失败关闭、依赖超时和取消。

## 共享包导出边界

`packages/browser-core/package.json` 与 `packages/shared/package.json` 已从 `./*` 通配导出改为显式公开根入口和经过调用者盘点的稳定子路径。新增模块不能因为文件存在就自动成为公共接口；先确认消费者、补测试，再在 exports 中列出稳定入口。详情见[整体架构的导出边界](../architecture/overview.md#依赖关系)和[浏览器运行时维护指南](../architecture/browser-runtime.md#目录导航)。

## 拆分模块的边界

协议拆分已经完成，benchmark 和 Worker 测试也已经按职责拆分。Broker、Offscreen、核心模型缓存和 Worker 客户端仍保留当前组合结构：它们拥有跨阶段状态、取消和资源所有权，尚未具备足够清晰的独立边界。未来如能先锁定状态所有权和回归测试，再评估细分；不要为了目录对称性机械拆分。

同理，`apps/model-worker/src` 和 `packages/shared/src` 当前规模适中，不需要继续增加层级。用户脚本中的 GM、Blob Worker、Key 和设置适配器具有平台语义，应继续保留；纯重导出只有在调用者迁移并确认没有公共用途后才能删除。

## 每次移动或新增需要核对

- 相对导入、动态导入、`new URL`、`import.meta.dirname` 和 shell 相对路径。
- package exports、TypeScript 模块解析、应用/测试的 type-only 与值导入。
- package scripts、GitHub Actions、显式 Node 测试列表、Vitest include 和 coverage glob。
- 构建输出、fixture、模型/Runtime 资产和证据路径。
- 文档相对链接、文档漂移读取路径和生成文件引用。

先运行受影响的定向测试和类型检查，再运行架构、文档和构建门禁。完整验收、浏览器多引擎和受保护鉴权证据仍按各自文档矩阵执行。

## 文档与决策目录

`docs/usage` 放用户流程，`architecture` 放实现时序，`reference` 放精确协议，`development` 放开发与发布，`audits` 放带日期证据，`decisions` 按生命周期/类别放决定。四篇既有专题保留路径，导航在 [docs/README.md](../README.md)。维护规则见[文档说明](documentation.md)。

笔记校验位于 `scripts/docs-drift/notes/`，测试仍归 `scripts/docs-drift/test/`。不要为新脚本在两级 scripts 根平铺入口，也不要把下载模型、config、dist 或浏览器证据当作源码。
