# 目录组织与新增文件规则

文件按职责归属，移动时同步调用者、工具和文档。工作区职责见[整体架构](../architecture/overview.md)，命令见[命令参考](commands.md)。

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
├── browser-core/src/{app,captcha,inference,model,persistence,platform,status-panel,utils}/
└── shared/src/{index,answer,model,ort-assets,ort-model,ort-runtime,token}.ts
scripts/
├── checks/       架构、浏览器危险调用、包体预算
├── ci/           Action、工具版本、工作流契约
├── docs-drift/   事实提取、文档检查及 test/ 回归
├── e2e/          仓库级用户脚本 E2E 入口
├── lib/          CLI、direct-run、源码收集等共享工具
├── model/        模型 manifest 与 release notes
└── ort-runtime/  ORT 构建、清理保护和锁定依赖
```

根与扩展 scripts 各按七个职责目录组织，不向两级 scripts 根重新平铺入口。benchmark 的配置、统计、比较、CSV 与执行器分别维护，测试靠近职责；根与扩展 Node 测试均使用带引号的 `scripts/**/*.test.mjs` 递归发现。

browser-core 业务域与测试目录镜像；用户脚本保留 GM、Blob Worker、Key 和设置等薄适配器。根配置各司其职：`package.json` 管包命令/格式/包管理器，`mise.toml` 管版本，`eslint.config.mjs` 管 lint，`tsconfig.base.json` 管编译选项，`.prettierignore` 管格式忽略；不恢复重复的 Prettier 或 Vitest workspace 配置。

扩展生成物按 `background/`、`content/`、`options/`、`runtime/` 分组，`offscreen/` 仅 Chromium，`model/` 仅内置模型。入口由 [EXTENSION_PATHS](../../apps/extension/src/platform/extension-paths.ts) 集中维护，完整输出及 ZIP 约定见[扩展产物](../browser-extension.md#build-outputs-and-local-loading)。

## 迁移历史

旧路径和迁移表保留在[2026-09-07 实施记录](../audits/2026-09-07-implementation-record.md)，不作当前命令入口。包脚本提供稳定入口，源码不保留永久旧路径转发壳。

## 协议和测试目录

扩展 `src/protocol/` 按以下职责维护：

| 文件                     | 职责                                                   |
| ------------------------ | ------------------------------------------------------ |
| `protocol-validation.ts` | 常量、基础结构与通用 guard                             |
| `port-messages.ts`       | 内容/设置 Port 请求、响应、状态及凭证消息              |
| `offscreen-messages.ts`  | Chromium Offscreen claim、request、cancel、idle 与状态 |
| `image-payload.ts`       | 图片 MIME/Base64 上限和编解码                          |
| `messages.ts`            | 稳定聚合入口，显式 re-export                           |

聚合协议仍可从 `test/protocol/messages.test.ts` 验证；新测试靠近实际职责，不把实现重新塞回聚合入口。

Worker 集成测试位于 `apps/model-worker/test/`，按 HTTP/CORS、模型/Runtime 完整性、quota HTTP、Durable Object 和失败/超时分文件；复用 `helpers/` fixture，不重新合成一个大测试文件。

## 共享包导出边界

browser-core 与 shared 的 `package.json` 只导出根入口和经过调用者盘点的稳定子路径。文件存在不代表公开接口；新增导出先确认消费者和测试，不恢复 `./*` 通配导出，也不用深层相对路径绕开边界。见[依赖关系](../architecture/overview.md#依赖关系)与[核心目录导航](../architecture/browser-runtime.md#目录导航)。

## 拆分模块的边界

按状态所有权与回归边界拆分，不按文件数或目录对称性拆分。Broker、Offscreen、模型缓存和 Worker 客户端仍协调跨阶段状态、取消与资源，进一步拆分须先证明边界清晰。Worker 与 shared 不为形式继续加层；用户脚本平台适配器保留其平台语义，纯重导出只有在迁移调用者并确认无公共用途后才删除。

## 每次移动或新增需要核对

- 导入、动态导入、`new URL`、`import.meta.dirname`、shell 相对路径。
- package exports、TypeScript 解析及调用者的值/类型依赖。
- 包脚本、CI、Node 测试发现、Vitest include 和 coverage glob。
- 构建产物、fixture、模型/Runtime、证据路径与文档链接/漂移读取路径。

先跑受影响的类型和定向测试，再检查架构、文档及构建；浏览器和受保护鉴权按[验证矩阵](verification.md#按修改区域选择验证)补证据。

## 文档与决策目录

`docs/usage` 放使用流程，`architecture` 放实现，`reference` 放精确协议，`development` 放开发/发布，`audits` 放带日期证据，`decisions` 按生命周期/类别放决定。四篇既有专题保留路径；入口见[文档导航](../README.md)，联动规则见[文档维护](documentation.md)。

笔记校验归 `scripts/docs-drift/notes/`，回归归 `scripts/docs-drift/test/`。下载模型、config、dist 和浏览器证据均不作为普通源码提交。
