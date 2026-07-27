# Error Handling

## Overview

Shared 不生成 HTTP response、UI message 或 logs，也没有自定义 Error class。普通不可信输入使用 typed sentinel 返回；consumer 决定业务策略。Canonical manifest parser 等构建期严格错误位于 package 外的 repo scripts。

## Sentinel Contracts

| Function                        | Invalid / boundary result          | Consumer behavior              |
| ------------------------------- | ---------------------------------- | ------------------------------ |
| `answerCodeForClassId`          | 越界返回 `undefined`               | YOLO parser 跳过无效 class id  |
| `normalizeModelAccessToken`     | missing、空、非 64-hex 返回 `null` | Worker 进入 decoy/error policy |
| `getModelAccessTokenLookupKeys` | 非法 token 返回 `[]`               | Worker 不查询 KV，视为未授权   |

真实实现：`packages/shared/src/answer.ts`、`packages/shared/src/token.ts`；策略映射见 `apps/model-worker/src/model-access.ts` 与 `apps/userscript/src/inference/yolo-output-parser.ts`。

## Required Patterns

- 可预期的外部无效值返回现有 sentinel，不为普通 invalid token 抛异常。
- Type guard 只做 narrow；normalizer 负责 `trim()`、validation 与 canonical lowercase。
- Shared 不 catch 后吞掉 programmer/config errors；构建脚本 `scripts/model-manifest.mjs` 对 malformed canonical source 严格失败。
- Consumer 负责把 sentinel 转成 decoy/403、skip detection 或 UI状态。

## Forbidden Patterns

- 在 shared 中创建 `Response`、DOM error 或 Cloudflare exception。
- 让 shared 决定 `decoy` vs `403`，或写用户文案。
- 捕获 manifest/contract failure 后返回默认值，掩盖发布 drift。
- 用 non-null assertion 绕过 `noUncheckedIndexedAccess` 的 `undefined`。
- 在 Error message 中包含真实 token、model bytes 或 credential。

## Tests

- Sentinel 的 valid/invalid/empty/boundary 分支必须有 Vitest coverage。
- 改 token error semantics 时同时运行 Model Worker tests。
- 改 answer mapping 时同时运行 Userscript parser/submitter tests。

```bash
corepack pnpm --filter @hv-pony-solver/shared test
corepack pnpm --filter @hv-pony-solver/model-worker test
corepack pnpm --filter @hv-pony-solver/userscript test
```
