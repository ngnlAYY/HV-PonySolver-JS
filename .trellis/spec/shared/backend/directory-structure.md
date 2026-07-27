# Directory Structure

## Scope

Shared package只放稳定、纯净、可跨 runtime 导入的 canonical boundary contracts；它不要求每个 export 都被两个 app 直接 import，但拒绝单 app orchestration、UI/HTTP/storage implementation。公开 API 从 `src/index.ts` 显式 re-export；不要使用 barrel glob 或把 app helper搬入 shared。

## Actual Layout

```text
packages/shared/
├── src/
│   ├── index.ts        # public export surface
│   ├── answer.ts       # answer tuple、AnswerCode、class-id mapping
│   ├── model.ts        # canonical model filename/version/integrity
│   └── token.ts        # token pattern、normalization、lookup keys
├── test/
│   ├── model.test.ts
│   └── token.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Module Rules

- 一个文件拥有一个小型契约域；文件名为 lower-kebab-case，export 使用领域名词。
- `src/index.ts` 是唯一 package public surface。新增 module 时显式 `export * from './module'`，并检查两个 consumer 的影响。
- Shared 不拥有 app orchestration。HTTP response、DOM、GM API、IndexedDB、KV/R2 都留在各自 app。
- Shared 没有 runtime dependency；保持 ES2022-only 编译环境（`packages/shared/tsconfig.json`）。

## Dependency Direction

```text
apps/userscript ─┐
                 ├──> packages/shared
apps/model-worker┘
```

禁止反向或 app-to-app import。`scripts/check-architecture-boundaries.mjs` 检查 runtime import；review 仍必须检查 type-only import，因为当前 guard 会跳过它。

## Real Examples

- `packages/shared/src/model.ts` 定义 manifest，`apps/userscript/src/model/model-config.ts` 与 `apps/model-worker/src/env.ts` 消费它，而不是复制字面量。
- `packages/shared/src/token.ts` 定义 normalization/lookup，`apps/model-worker/src/model-access.ts` 只组合授权策略。
- `packages/shared/src/answer.ts` 定义 tuple/mapping，`apps/userscript/src/inference/yolo-output-parser.ts` 与 `apps/userscript/src/captcha/answer-submitter.ts` 消费它。

## Common Mistakes

- 在 shared 中导入 `apps/...`，即使只是 type。
- 为单一 app 的 helper 建 shared module，导致 runtime boundary 泄漏。
- 在 app 内重新声明 filename、version、hash、token regex 或 answer union。
- 把 `src/index.ts` 变成包含逻辑的 composition root；它只做 exports。

## Validation

```bash
corepack pnpm --filter @hv-pony-solver/shared typecheck
corepack pnpm architecture:check
corepack pnpm lint
```
