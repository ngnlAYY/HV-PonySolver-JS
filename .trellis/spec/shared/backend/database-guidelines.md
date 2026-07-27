# Persistence Ownership（无数据库实现）

## Overview

Shared package没有 ORM、SQL、D1、migration、transaction 或 storage adapter。它只定义可以跨 app 使用的值、类型与 pure functions；持久化由 consumer 拥有。

## Owner Matrix

| Data / state                        | Owner        | Real implementation                                                    |
| ----------------------------------- | ------------ | ---------------------------------------------------------------------- |
| Model access authorization marker   | Model Worker | `apps/model-worker/src/model-access.ts` 通过 `ModelKeyStore` 读取 KV   |
| Real/decoy model bytes              | Model Worker | `apps/model-worker/src/model-response.ts` 通过 `ModelBucket` 读取 R2   |
| Userscript settings / candidate Key | Userscript   | `apps/userscript/src/userscript/gm-bridge.ts` 与 model settings        |
| Downloaded model cache              | Userscript   | `apps/userscript/src/model/model-cache.ts`（IndexedDB）                |
| Canonical manifest/token rules      | Shared       | `packages/shared/src/model.ts`、`packages/shared/src/token.ts`，无 I/O |

`apps/model-worker/src/worker-types.ts` 的 KV/R2 interfaces 是 runtime port；不要把 Cloudflare binding 移到 shared，因为 shared 的 consumers 不共享该 runtime。

## Required Patterns

- Shared 接收 plain input，返回 plain immutable-view data、`null`、`undefined` 或 readonly arrays。
- Consumer 在 storage boundary 做 I/O、retry、HTTP/UI mapping 与错误策略。
- 模型 artifact 变化通过 shared manifest version/byteLength/SHA-256 表达，不通过 database migration。

## Forbidden Patterns

- 在 shared 中访问 `process.env`、`globalThis`, GM API、IndexedDB、KV、R2 或 network。
- 为了“通用化”把 `ModelKeyStore`、R2 object、IDB transaction 或 secret搬进 shared。
- 添加 ORM/schema/migration 指南；本项目没有这些实现。
- 在 shared cache token、model bytes 或 app state。

## Validation

```bash
corepack pnpm check:shared
corepack pnpm architecture:check
```

若新增 I/O，视为 package boundary 变更，必须先重新设计 owner，而不是直接扩展此层。
