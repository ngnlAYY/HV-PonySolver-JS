# Shared Backend / Contract Guidelines

## Overview

`@hv-pony-solver/shared` 是跨 runtime 的纯 TypeScript 契约包。它由 Userscript 和 Model Worker 共同依赖，但不依赖任何 app、DOM、Cloudflare binding、storage 或 logger。

公开内容只有三类：

- answer code/class mapping；
- canonical model filename/version/integrity manifest；
- model access token validation/normalization/lookup keys。

## Guidelines Index

| Guide                                             | Description                                            | Status    |
| ------------------------------------------------- | ------------------------------------------------------ | --------- |
| [Directory Structure](./directory-structure.md)   | Pure contract modules、exports 与 dependency direction | Completed |
| [Persistence Ownership](./database-guidelines.md) | Shared 无数据库；KV/R2/IndexedDB 由 app 层拥有         | Completed |
| [Error Handling](./error-handling.md)             | Sentinel returns 与 consumer-owned policy              | Completed |
| [Quality Guidelines](./quality-guidelines.md)     | Manifest/token/type/testing/coverage contracts         | Completed |
| [Logging Guidelines](./logging-guidelines.md)     | Shared 无日志与 secret redaction boundary              | Completed |

## Pre-Development Checklist

按变更范围读取：

1. 修改 `src/index.ts`、增加 module 或改变 app 依赖：读取 Directory Structure 与 Quality。
2. 修改 `MODEL_FILENAME`、`MODEL_VERSION`、`MODEL_INTEGRITY`：读取 Quality、Error Handling，并同步检查 Userscript、Model Worker、docs drift 与 release scripts。
3. 修改 token pattern、normalization 或 lookup key顺序：读取 Quality、Error Handling，并运行 Shared 与 Model Worker tests。
4. 任何 persistence、logging、HTTP 或 UI 需求：先读取对应 owner boundary；通常不应在 shared 实现。

## Required Commands

```bash
corepack pnpm check:shared
corepack pnpm architecture:check
```

跨 app 契约变化最终运行：

```bash
corepack pnpm check
```

## Related Owners

- Userscript UI/storage/Worker：[Userscript frontend specs](../../userscript/frontend/index.md)
- Cloudflare HTTP/KV/R2：[Model Worker backend specs](../../model-worker/backend/index.md)
- 架构 guard：`scripts/check-architecture-boundaries.mjs`
- 编译约束：`tsconfig.base.json`、`packages/shared/tsconfig.json`
