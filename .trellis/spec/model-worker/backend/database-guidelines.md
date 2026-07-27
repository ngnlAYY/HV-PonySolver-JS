# KV / R2 Storage Guidelines（无传统数据库）

## Overview

Model Worker 没有 D1、SQL、ORM、schema migration 或 transaction。运行时 persistence 只有两个最小只读 ports：

- `ModelKeyStore.get(key): Promise<string | null>`：Cloudflare KV authorization marker。
- `ModelBucket.get(key): Promise<R2ObjectBody | null>`：Cloudflare R2 real/decoy model object。

定义见 `apps/model-worker/src/worker-types.ts`。不要杜撰 repository、table 或 migration pattern。

## KV Authorization Contract

1. 只从 `Authorization: Bearer <token>` 读取 token；query string 不授权真实模型。
2. Shared contract 要求 64 位 hex，并按 canonical lowercase → original historical case → uppercase fallback 生成去重 lookup keys。
3. `apps/model-worker/src/model-access.ts` 依次读取 KV；任一结果 **不是 `null`** 即授权 `real`。Marker 内容本身不表达额外权限。
4. 缺失/非法/KV miss 根据 `INVALID_KEY_MODE` 选择 `decoy` 或 `forbidden`。

Token 看起来像 hex digest，但源码没有声明它是 SHA-256 hash；规范和实现都不能擅自赋予这种语义。

## R2 Selection Contract

- `real` 使用 `REAL_MODEL_OBJECT_KEY`；`decoy` 使用 `DECOY_MODEL_OBJECT_KEY`。
- 每次请求只读取已选中的 object。选中 object 缺失返回 500，不回退到另一个 object。
- `HEAD` 仍读取 object metadata/header，只是不返回 body。
- Worker 不上传、修改或删除 R2 object；artifact 发布属于受控运维流程。

真实实现：`apps/model-worker/src/model-response.ts` 的 `createModelResponse`。

## Binding / Config Contract

固定 binding 名：

- KV：`MODEL_KEYS`
- R2：`MODEL_BUCKET`

`wrangler.template.toml` 是源。Renderer/guard 必须确认 resource value 格式、binding 名、正确的 `[[kv_namespaces]]` / `[[r2_buckets]]` section、无重复和无未解析 placeholder；deploy/production 禁止 test placeholders。

## Forbidden / Common Mistakes

- 把 Key 放 URL/query、日志、fixture、task artifact 或聊天。
- 只查询 lowercase key，破坏 historical mixed/uppercase KV entry compatibility。
- 根据 marker 字符串内容增加未定义权限；当前只区分 `null`/非 `null`。
- Selected real miss 时偷偷回退 decoy，或 selected decoy miss 时回退 real。
- 交换 KV/R2 binding section 或直接编辑生成的 `wrangler.toml`。
- 在 request path 增加 KV/R2 writes，除非先重新设计安全与运维边界。

## Tests / Validation

- `apps/model-worker/test/index.test.ts` 覆盖 Bearer、case lookup、real/decoy/forbidden、R2 selection/miss。
- `apps/model-worker/scripts/render-wrangler-config.test.mjs` 覆盖 renderer/guard 与错误 section。

```bash
corepack pnpm --filter @hv-pony-solver/shared test
corepack pnpm --filter @hv-pony-solver/model-worker test
```
