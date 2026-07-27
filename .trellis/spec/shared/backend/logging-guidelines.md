# Logging Guidelines（Shared 不记录日志）

## Overview

Shared package没有 logger，也不调用 `console.*`。它是 pure contract 层；logging、redaction 与运维上下文由 app/CLI owner 处理。全局 ESLint 对 TypeScript 启用 `no-console: error`，shared 没有例外。

## Required Behavior

- 普通无效 input 使用 typed sentinel，不记录 warning/error。
- 需要诊断时由调用方记录不含秘密的 context；不要为此给 shared 增加 logger dependency。
- Release/verification scripts 可以输出 canonical model metadata 和校验结果，但仍不得输出 Key、credential 或 model body。

## Never Log

- model access token 或 `Authorization` value；
- KV key/value、namespace ID、Cloudflare credential；
- model binary/body；
- Userscript 用户输入、GM storage 或 IndexedDB content。

## Real Boundaries

- `packages/shared/src/token.ts` 对 invalid token 返回 `null`/`[]`，不打印 token。
- `scripts/model-release-notes.mjs` 读取公开 canonical manifest 生成说明，不访问 Cloudflare。
- `apps/model-worker/scripts/check-deployment-contract.mjs` 只输出 method、Origin、status/header 差异与非秘密 probe context。

## Validation

```bash
corepack pnpm lint
```

Review 还必须搜索间接 logger/import；不能只依赖 `no-console`。
