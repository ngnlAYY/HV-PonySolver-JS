# Quality Guidelines

## Core Contracts

### Canonical model manifest

`packages/shared/src/model.ts` 是 filename、public path、version、byteLength 与 SHA-256 的唯一来源：

- `DEFAULT_PUBLIC_MODEL_PATH` 从 `MODEL_FILENAME` 派生，不重复字面量。
- `MODEL_INTEGRITY` 保持直接 object literal + `as const`；repo parser 依赖此 canonical source shape。
- 模型 bytes 变化必须同时验证 byteLength/SHA-256 并 bump `MODEL_VERSION`，使 IndexedDB cache失效。
- Apps 通过 import 消费，不复制 manifest。

Consumers/guards：`apps/userscript/src/model/model-config.ts`、`apps/model-worker/src/env.ts`、`scripts/model-manifest.mjs`、`scripts/model-manifest.test.mjs`、`scripts/docs-drift/model-manifest-docs.mjs`。

### Token contract

`packages/shared/src/token.ts` 的实际顺序不可随意改变：

1. `MODEL_ACCESS_TOKEN_PATTERN` 精确接受 64 位 hex。
2. `isModelAccessToken` 是不 trim 的 type guard。
3. 外部输入使用 `normalizeModelAccessToken`：trim → validate → lowercase；invalid 返回 `null`。
4. `getModelAccessTokenLookupKeys` 返回 canonical lowercase → historical original case → uppercase fallback，去重且为 `readonly string[]`。

Bearer/query policy 由 Model Worker 拥有，但不得绕过 shared normalizer。不要把 query string 当授权来源。

### Answer contract

`packages/shared/src/answer.ts` 中 `ANSWER_CODES as const` 同时是 runtime 顺序和 `AnswerCode` union 的唯一来源；`answerCodeForClassId` 依靠安全索引返回 `AnswerCode | undefined`。

禁止另写 union、switch 或 duplicate array。重排答案需要同步模型 class order与 consumer tests。

## Type Safety

全仓继承 `tsconfig.base.json`：

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `isolatedModules`

Shared 使用 `as const`、literal-derived unions、type guards 和 readonly return types。它们是 compile-time immutable view，不要声称对象在 runtime deep-frozen。

ESLint 禁止 explicit `any`；不要用宽泛 `string`、non-null assertion 或 type cast绕开契约。

## Testing Requirements

`packages/shared/vitest.config.ts` 对 lines/functions/branches/statements 全部要求 100%。

- `test/model.test.ts` 固定 canonical path/version/byteLength/hash。
- `test/token.test.ts` 覆盖大小写、空白、null/undefined、长度边界、非 hex、lookup 顺序与去重。
- Answer 当前由 Userscript parser/submitter tests 跨层覆盖；不要杜撰不存在的 shared answer unit test。若增加复杂 answer 逻辑，应在 shared 补直接测试。

改 shared contract 最少运行：

```bash
corepack pnpm check:shared
```

涉及 consumer/manifest 时追加：

```bash
corepack pnpm check:userscript
corepack pnpm check:model-worker
corepack pnpm docs:check
corepack pnpm architecture:check
```

最终运行 `corepack pnpm check`。

## Forbidden Patterns / Common Mistakes

- Apps 复制 filename/version/hash/token regex/answer codes。
- 只改 model hash/byteLength 而不 bump version，或关闭完整性校验接受 drift。
- 把 manifest 改成函数调用、拼接或 computed expression，导致窄范围 parser 失效。
- 删除 historical-case lookup fallback 或改变顺序，破坏现有 KV entries。
- 将普通 invalid token 变成 exception，或记录 token。
- Shared 导入 app、DOM、Cloudflare runtime、storage 或 logger。
- 把 TypeScript `readonly`/`as const` 描述成 runtime deep freeze。

## Code Review Checklist

- [ ] 新常量/函数是否属于稳定、纯净、可跨 runtime 导入的 canonical boundary contract，而非单 app orchestration/helper？
- [ ] `src/index.ts` 是否显式导出且没有 app 反向依赖？
- [ ] canonical source shape 是否仍被 model/docs scripts解析？
- [ ] valid、invalid、empty、boundary、ordering/compatibility 是否有测试？
- [ ] consumer tests 与 docs drift 是否同步？
- [ ] 没有 Key、credential、model body 或 app-specific I/O？
