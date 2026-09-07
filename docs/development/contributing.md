# 开发约定、代码风格与注释

本页把[根 AGENTS.md](../../AGENTS.md)的开发约束落实为日常修改方法。行为、资产和安全不变量仍以根约束及各专题为准。

## 开始一次修改

先运行 `git status --short --branch`，阅读任务相关源码、测试和[整体架构](../architecture/overview.md)，确认是否已有未提交修改。先界定预期行为、受影响平台和可观察的验证结果，再确定改动文件。

环境安装和命令矩阵见[开发与验证](verification.md)。目录放置规则见[目录方案](directory-layout.md)。仓库已有索引时可以用 CodeGraph 查找调用关系；源码和配置仍是当前行为的依据。

## TypeScript 与模块接口

[tsconfig.base.json](../../tsconfig.base.json)开启严格类型、索引读取检查和精确可选属性。优先通过控制流收窄表达已验证事实，跨网络、消息、存储和 DOM 的输入从 `unknown` 开始校验。断言用于描述已有运行时保证；新增断言时应能指明保证来自哪条检查，而不能用断言代替检查。

类型导入使用 `import type`，值导入只包含运行时需要的符号。保持 ESM 和现有 package 子路径导入，不使用深层相对路径绕过包接口。`shared` 不依赖应用或平台；共享核心的依赖注入由应用入口完成。

默认复用现有能力：取消竞态、错误格式化、Fetch 接收者、存储接口、请求结算、资产清单和超时配置均已有入口。评估复用时先比较语义，例如“可重复查询”和“可能产生下载确认的操作”不能仅因都是 HTTP 请求而共享无条件重试策略。

## 格式与命名

格式由根 [package.json](../../package.json) 的 `prettier` 字段定义：无分号、单引号、尾逗号和现有行宽。ESLint 规则见 [eslint.config.mjs](../../eslint.config.mjs)。领域文件沿用 kebab-case；类和类型使用 PascalCase，函数及局部变量使用 camelCase，协议字段和 HTTP 头保留标准名称。

只格式化修改文件，例如：

```bash
mise exec -- pnpm exec prettier --check docs/README.md docs/development/contributing.md
```

需要修正格式时，对明确列出的文件使用 `--write`。`pnpm format:check` 已纳入 `check:quick` 和 CI，只读检查第一方文件；`.gitignore` 与 [`.prettierignore`](../../.prettierignore) 排除生成目录、第三方压缩资产和 pnpm 锁文件。根 `pnpm format` 仍是全仓写操作，日常修改优先明确列出文件，避免带入无关 diff。Prettier 与 ESLint 检查的是不同规则；不支持的格式（如当前未配置解析器的 TOML）由相应配置校验负责。

根配置使用工具的原生发现方式：Prettier 从 `package.json#prettier` 读取静态规则，ESLint 保留独立 flat config；不在命令中重复传入这些规则。各工作区通过自己的 `vitest.config.ts` 运行测试，由根 `pnpm -r test` 调度，无需额外根 Vitest workspace 配置。工具链与共享编译选项分别保留在 `mise.toml` 和 `tsconfig.base.json`。配置位置参考 [Prettier 官方说明](https://prettier.io/docs/configuration.html)和 [ESLint flat config 说明](https://eslint.org/docs/latest/use/configure/configuration-files)。

## 注释应该解释什么

优先记录代码表面看不出的契约：

| 场景             | 注释应回答的问题                                            | 本仓库参考                                                                   |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ArrayBuffer 转移 | 谁拥有字节？返回后是否可能 detach？并发消费者能否共享？     | [模型缓存](../../packages/browser-core/src/model/model-cache.ts)             |
| IndexedDB 写入   | 哪个事务事件才代表成功？迟到写入/确认如何核对身份？         | [模型 store](../../packages/browser-core/src/model/indexeddb-model-store.ts) |
| 取消与超时       | 哪个对象负责取消？何时清理监听器？旧响应如何被忽略？        | [请求生命周期](../../apps/extension/src/protocol/request-lifecycle.ts)       |
| 页面操作         | 为什么需要再次检查表单和 checkbox 身份？                    | [答案提交器](../../packages/browser-core/src/captcha/answer-submitter.ts)    |
| 平台适配         | browser/chrome 或 GM 的差异是什么？降级为什么不适用于 Key？ | [GM bridge](../../apps/userscript/src/userscript/gm-bridge.ts)               |
| 缓存/额度        | “下载成功”“事务成功”和“确认成功”分别在哪一步成立？          | [缓存专题](../model-cache-strategy.md)                                       |
| 构建/运维        | 为什么拒绝重定向、脏 checkout、错误模型或未绑定的发布证据？ | [扩展构建审计](../../apps/extension/scripts/build/inventory.mjs)             |

公开函数或接口有所有权、副作用、取消语义、异常或前置条件时，添加简短 TSDoc。简单类型别名、显然的 getter 和纯 re-export 不需要凑注释。文件注释用于交代领域职责和非显然边界；详细跨模块流程放在架构文档并相互链接。

新增说明以清晰中文为主，协议术语保留英文；现有准确的英文注释不需要为了统一语言批量翻译。删除过期和逐行复述的注释，保留可诊断的历史原因。不要在注释中复制完整哈希、会漂移的行号、秘密或短期测试结果。

## 异步资源与错误

异步接口应明确谁创建、谁销毁资源。新增监听器、定时器、Worker、Port 或事务时，检查成功、失败、取消、超时和销毁路径的清理。先发布 pending 状态再开始可同步触发取消的操作，沿用已有生命周期工具；旧任务结束不能覆盖新任务的状态。

HTTP 拒绝、超时、完整性失败、额度不足和浏览器断连应保留各自语义。面向用户的消息使用中文，内部错误保留足够上下文；Key、对象身份和敏感配置不进入日志、UI 或响应。保持 Fetch 的正确接收者，优先复用已有 Fetch 解析函数。

## 测试与重构

行为变化先增加或调整能观察结果的定向测试。目录移动或纯职责拆分先保留已有回归行为，再逐组迁移；对于取消、幂等、事务和来源校验，不能用只检查新函数被调用的测试替代行为证据。

类型与单元测试不能证明实际浏览器生命周期、用户脚本管理器或远程鉴权。修改这些边界时按[验证手册](verification.md)补充对应 E2E，并准确记录环境和未覆盖项。纯文档补全不需要新增业务测试，但应执行格式、链接、漂移和 diff 检查。

## 交付

修改公开行为或命令时按[文档联动表](documentation.md#按修改类型同步)更新说明。交付记录包含修改目的、文件、验证结果和剩余限制。提交与推送需有明确用户要求；审计、文档补全和本地验证不自动包含提交、发布或部署。
