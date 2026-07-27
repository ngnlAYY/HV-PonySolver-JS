# Model Worker Backend Guidelines

## Overview

`@hv-pony-solver/model-worker` 是 Cloudflare Worker backend。规范覆盖 Fetch API request lifecycle、env normalization、Bearer/KV authorization、R2 real/decoy selection、CORS/no-store、安全响应、Wrangler config 和部署后公开契约验收。

事实优先级：当前源码与测试 > package/config/workflow > README/ops 文档 > Trellis 模板。若文档与源码冲突，先验证并修正文档，不让实现迎合过期描述。

## Guidelines Index

| Guide                                           | Description                                                   | Status    |
| ----------------------------------------------- | ------------------------------------------------------------- | --------- |
| [Directory Structure](./directory-structure.md) | Worker runtime、scripts、tests 与 Wrangler source/生成物边界  | Completed |
| [KV/R2 Storage](./database-guidelines.md)       | 无 ORM/SQL；只读 KV authorization 与 R2 model selection       | Completed |
| [Error Handling](./error-handling.md)           | HTTP status、统一 500、CORS/no-store/nosniff                  | Completed |
| [Logging Guidelines](./logging-guidelines.md)   | Runtime 无应用日志；运维输出与 secret redaction               | Completed |
| [Quality Guidelines](./quality-guidelines.md)   | Cloudflare tests、coverage、docs/config/deployment guardrails | Completed |

## Pre-Development Checklist

按变更范围读取：

1. 路由/path/method/HTTP response/CORS：Directory、Error、Quality。
2. Bearer、token、KV、real/decoy/error mode：KV/R2 Storage、Error、Quality，并读取 Shared token contract。
3. Binding、env var、object key、Wrangler：Directory、KV/R2 Storage、Error、Quality。
4. Logging、diagnostics、deployment checker：Logging、Quality；确认不发送/输出 Key 或 body。
5. 生产部署：读取 `docs/model-worker-ops.md`；dry-run 不等于 deploy，发布后失败不自动回滚。

## Required Commands

```bash
corepack pnpm check:model-worker
corepack pnpm docs:check
corepack pnpm architecture:check
```

跨仓库或 HTTP契约变更最终运行 `corepack pnpm check`。

## Related Specs

- Shared token/model contract：[`../../shared/backend/index.md`](../../shared/backend/index.md)
- Model Worker frontend：[`../frontend/index.md`](../frontend/index.md)（Not applicable）
- Userscript client：[`../../userscript/frontend/index.md`](../../userscript/frontend/index.md)
