# 当前目录组织与迁移记录

本页描述 2026-09-07 审计后的实际目录。两级 `scripts` 已按职责完成迁移，应用命令仍保持原有 npm/pnpm 名称；旧路径只作为迁移记录保留在下表，不是当前可用入口。

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

扩展脚本迁移后共有 7 个职责目录，根脚本迁移后共有 7 个职责目录；两级合计 54 个脚本/测试文件完成迁移。`apps/extension/scripts/benchmark/` 进一步把参数契约、统计、比较、CSV 输出和产品/runner 分开；这几个文件共同定义基准证据格式，不应重新合并成单一脚本。

核心业务目录已经按领域分组。`browser-core/src` 的 `app`、`captcha`、`inference`、`model`、`persistence`、`platform`、`status-panel`、`utils` 与对应测试目录保持镜像；用户脚本的薄适配器继续按 `app`、`captcha`、`inference`、`model`、`persistence`、`status-panel`、`userscript` 分组。大协调模块是否继续拆分，要以状态所有权和测试边界为准，不按文件数量机械拆分。

根配置保持按工具职责分开：`package.json` 提供 workspace 脚本、Prettier 规则和包管理器声明，`mise.toml` 固定 Node.js/pnpm，`eslint.config.mjs` 提供全仓库 flat config，`tsconfig.base.json` 提供共享 TypeScript 选项，`.prettierignore` 定义生成物和第三方资产的格式忽略边界。已删除的独立 Prettier 配置和 Vitest workspace 不应重新引入。

## 扩展脚本迁移映射

下表是已完成的“迁移前名称 → 当前路径”。同名测试随被测模块移动；应用包的 scripts 字段继续提供稳定命令名。

| 迁移前                                                                             | 当前路径                            | 保留的边界                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------- |
| `scripts/build-extension*`、`build-packaged-fixture`                               | `apps/extension/scripts/build/`     | 构建目标、资产、策略、清理和 fixture 身份           |
| `benchmark-compare`、`benchmark-contract`、`benchmark-product`、`benchmark-runner` | `apps/extension/scripts/benchmark/` | 参数契约、统计、比较、CSV、CI/full/product 成本含义 |
| `browser-support`、`install-geckodriver`、`webdriver`、`product-cache/client`      | `apps/extension/scripts/browser/`   | 浏览器版本、驱动完整性和浏览器辅助客户端            |
| `chromium-*`、`firefox-*`、`packaged-smoke-artifact`、`packaged-e2e-evidence`      | `apps/extension/scripts/e2e/`       | load-only、内容、内置模型、artifact 证据的不同门禁  |
| `generate-packaged-fixture`、fixture identity、requirements lock                   | `apps/extension/scripts/fixtures/`  | 固定依赖、fixture 身份和生成物目录                  |
| `download-canonical-model`                                                         | `apps/extension/scripts/model/`     | 受保护模型下载与完整性                              |
| `release-gate`                                                                     | `apps/extension/scripts/release/`   | 发布对象、commit、浏览器和 Android 证据绑定         |

## 根脚本迁移映射

| 迁移前                                                                        | 当前路径               | 备注                                                    |
| ----------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------- |
| `check-architecture-boundaries`、`check-browser-sinks`、`check-bundle-budget` | `scripts/checks/`      | 测试同目录；包命令保持不变                              |
| `assert-pinned-actions`、workflow/版本契约测试                                | `scripts/ci/`          | 只保留 CI/版本门禁职责                                  |
| `check-docs-drift`、事实提取器、文档链接检查                                  | `scripts/docs-drift/`  | 大型领域测试拆至同目录，链接测试位于 `docs-drift/test/` |
| `model-manifest`、`model-release-notes`                                       | `scripts/model/`       | 模型发布辅助                                            |
| ORT 构建、清理、构建根和依赖锁定                                              | `scripts/ort-runtime/` | 保留构建根安全边界                                      |
| `run-userscript-e2e`                                                          | `scripts/e2e/`         | 仓库级用户脚本 E2E                                      |
| `cli`、`direct-run`、`source-files`、字符串工具                               | `scripts/lib/`         | 仅放跨脚本小型共享工具                                  |

迁移没有留下永久旧路径转发壳。需要查命令时以根/应用 `package.json` 为准；需要查实现时以当前路径为准。

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

## 仍保留的未来评估项

协议拆分已经完成，benchmark 和 Worker 测试也已经按职责拆分。Broker、Offscreen、核心模型缓存和 Worker 客户端仍保留当前组合结构：它们拥有跨阶段状态、取消和资源所有权，尚未具备足够清晰的独立边界。未来如能先锁定状态所有权和回归测试，再评估细分；不要为了目录对称性机械拆分。

同理，`apps/model-worker/src` 和 `packages/shared/src` 当前规模适中，不需要继续增加层级。用户脚本中的 GM、Blob Worker、Key 和设置适配器具有平台语义，应继续保留；纯重导出只有在调用者迁移并确认没有公共用途后才能删除。

## 每次移动或新增需要核对

- 相对导入、动态导入、`new URL`、`import.meta.dirname` 和 shell 相对路径。
- package exports、TypeScript 模块解析、应用/测试的 type-only 与值导入。
- package scripts、GitHub Actions、显式 Node 测试列表、Vitest include 和 coverage glob。
- 构建输出、fixture、模型/Runtime 资产和证据路径。
- 文档相对链接、文档漂移读取路径和生成文件引用。

先运行受影响的定向测试和类型检查，再运行架构、文档和构建门禁。完整验收、浏览器多引擎和受保护鉴权证据仍按各自文档矩阵执行。
