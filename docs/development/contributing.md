# 开发约定、代码风格与注释

本页说明日常修改方法；产品和安全约束见[根 AGENTS.md](../../AGENTS.md)，环境与检查见[验证手册](verification.md)，文件放置见[目录组织](directory-layout.md)。

## 开始一次修改

先运行 `git status --short --branch`，保留已有改动，阅读 README、相关专题和测试，明确预期行为、影响平台与验证结果。仓库存在 `.codegraph/` 时，定位代码和调用关系先用 `codegraph_explore` 或 `codegraph explore`，再补读未覆盖内容；事实以当前源码和配置为准。

## TypeScript 与模块接口

[tsconfig.base.json](../../tsconfig.base.json) 开启严格类型、索引读取检查和精确可选属性。跨网络、消息、存储与 DOM 的输入从 `unknown` 开始验证，优先控制流收窄；类型断言必须有已执行的运行时检查支撑。

保持 ESM，类型使用 `import type`，跨包使用显式 package 子路径。`shared` 不依赖平台或应用，browser-core 通过应用入口注入平台能力；不以深层相对路径绕过接口和架构门禁。

先复用已有取消、错误、Fetch、存储、请求结算、资产和超时模块。复用前核对语义：可重复查询与会确认下载的操作不能共用无条件重试。

## 格式与命名

Prettier 规则由根 [package.json](../../package.json) 定义，ESLint 使用 [flat config](../../eslint.config.mjs)。沿用 kebab-case 文件名、PascalCase 类型/类和 camelCase 函数/变量；协议字段与 HTTP 头保留标准名称。

只检查、格式化本次文件：

```bash
mise exec -- pnpm exec prettier --check docs/README.md docs/development/contributing.md
```

修正时将 `--check` 换为 `--write`。根 `pnpm format` 会写全仓，避免带入无关 diff。`.gitignore` 与 [`.prettierignore`](../../.prettierignore) 排除生成物、第三方压缩资产及 pnpm 锁文件；无对应解析器的格式由专门配置检查负责。

使用工具原生配置发现：Prettier 读根包字段，ESLint 保留独立配置，工作区各用 `vitest.config.ts`；不再增加重复 Prettier 或根 Vitest workspace 配置。工具版本和共享编译选项分别归 `mise.toml`、`tsconfig.base.json`。

## 注释应该解释什么

注释记录代码表面看不出的约束，公开接口有所有权、副作用、取消、异常或前提时补简短 TSDoc：

| 场景       | 应说明的内容                          | 参考                                                                         |
| ---------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| 字节转移   | detach 时机、所有权、并发消费者       | [模型缓存](../../packages/browser-core/src/model/model-cache.ts)             |
| IndexedDB  | 事务提交点、迟到写入/确认身份         | [模型 store](../../packages/browser-core/src/model/indexeddb-model-store.ts) |
| 取消与超时 | 取消责任、监听清理、旧响应失效        | [请求生命周期](../../apps/extension/src/protocol/request-lifecycle.ts)       |
| 页面操作   | 再查表单/checkbox 身份的原因          | [答案提交器](../../packages/browser-core/src/captcha/answer-submitter.ts)    |
| 平台差异   | GM/WebExtension 语义及 Key 的存储边界 | [GM bridge](../../apps/userscript/src/userscript/gm-bridge.ts)               |
| 缓存与额度 | 下载、事务、确认各自何时成功          | [缓存专题](../model-cache-strategy.md)                                       |
| 构建与发布 | 资产和证据如何绑定待发布包            | [构建审计](../../apps/extension/scripts/build/inventory.mjs)                 |

详细时序放架构文档；简单 getter、类型别名和 re-export 无需凑注释。新增说明以中文为主，不批量翻译准确英文。删除逐行复述和过期说明，保留防坑原因；不复制完整哈希、行号、秘密或短期测试数。

## 异步资源与错误

监听器、定时器、Worker、Port 和事务都应明确创建/销毁者，覆盖成功、失败、取消、超时与销毁的清理。先发布 pending 状态，再启动可能同步取消的操作；旧任务结束不能覆盖新状态。

HTTP 拒绝、超时、完整性失败、额度不足和断连保留不同语义。用户提示用中文，内部错误保留诊断原因，但 Key、内部对象身份和敏感配置不进入日志、UI 或响应。Fetch 复用既有解析函数，保留正确接收者。

## 测试与重构

行为变化用可观察结果验证，目录移动和职责拆分保留原回归。取消、幂等、事务和来源校验不能仅靠“调用了新函数”证明；按[验证矩阵](verification.md#按修改区域选择验证)补对应浏览器证据。纯文档执行格式、链接、漂移和 diff 检查，无需新增业务测试。

## 决策记录

非平凡行为、架构、跨文件契约、工具、测试策略和数据格式变化须写入或同步 `docs/decisions/<lifecycle>/<class>/`。先检索活跃记录，说明备选、代价与验证；事实变化原地更新，理由翻转另写并互链，机械修改不立 Note。格式见[文档维护](documentation.md#决策笔记)。

## 交付

按[文档联动表](documentation.md#按修改类型同步)同步公开变化。交付说明目的、主要文件、实测结果及限制；commit、push、发布和部署仅在用户明确要求时执行。
