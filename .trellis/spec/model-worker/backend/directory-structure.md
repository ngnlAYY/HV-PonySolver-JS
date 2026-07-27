# Directory Structure

## Actual Layout

```text
apps/model-worker/
├── src/
│   ├── index.ts              # Fetch 入口、env normalization、最终 500 boundary
│   ├── env.ts                # Env -> NormalizedEnv validation
│   ├── request-router.ts     # pathname、OPTIONS、method routing
│   ├── model-access.ts       # Bearer parse、KV lookup、access decision
│   ├── model-response.ts     # R2 selection、HTTP/CORS/security headers
│   └── worker-types.ts       # Env、KV/R2 minimal ports
├── test/
│   ├── index.test.ts
│   ├── env.test.ts
│   └── helpers/model-worker-fixture.ts
├── scripts/
│   ├── wrangler-config-renderer.mjs
│   ├── wrangler-config-guard.mjs
│   ├── render-wrangler-config.mjs
│   ├── validate-wrangler-config.mjs
│   └── check-deployment-contract.mjs
├── wrangler.template.toml    # version-controlled source
├── vitest.config.ts
└── package.json
```

`wrangler.toml` 与 `.wrangler/` 是生成物，不是 source of truth，不得提交。

## Responsibility Rules

- `index.ts` 保持薄：只调用 `normalizeEnv`、`handleRequest`，并把未处理异常转成通用 500。
- 新 pathname/method 逻辑放 `request-router.ts`。
- Bearer/KV access policy 放 `model-access.ts`；跨 app token规则放 `packages/shared`。
- CORS、cache、安全 header、R2 response 放 `model-response.ts`。
- 新 binding/var 同时更新 `worker-types.ts`、`env.ts`、`wrangler.template.toml`、renderer/guard 和 tests。
- 发布/渲染/公开 probe 放 `scripts/*.mjs`，不混入 Worker runtime。

## Real Examples

- `apps/model-worker/src/index.ts` 的 `fetch` 入口只做 normalization/router/catch。
- `apps/model-worker/src/request-router.ts` 的 `handleRequest` 依次处理 path、OPTIONS、method 与 access decision。
- `apps/model-worker/src/model-response.ts` 集中维护 model/text/preflight headers。
- `scripts/check-architecture-boundaries.mjs` 禁止 Model Worker 与 Userscript 相互 import，并禁止 Shared 反向 import apps。

## Naming / Module Conventions

- TypeScript runtime 文件使用 lower-kebab-case；函数名按动作表达：`normalizeEnv`、`handleRequest`、`selectModelAccess`、`createModelResponse`。
- Runtime ports/types 集中于 `worker-types.ts`；仅局部使用的辅助类型留在所属 module。
- Node ESM scripts 使用 `.mjs`，可测试逻辑 export，direct-run CLI 保持薄。

## Forbidden / Common Mistakes

- 为套用通用 backend 模板新增 controller/service/repository/ORM 层。
- 把 route、authorization 或 header logic 重新塞进 `index.ts`。
- Model Worker import Userscript，或把单 app internal type 无条件移入 Shared。
- 手工编辑/提交生成的 `wrangler.toml`。
- 把 `.mjs` 运维脚本打入 Worker runtime。
- 仅因图谱社区低内聚拆 module；按已存在的职责边界拆分。

## Validation

```bash
corepack pnpm --filter @hv-pony-solver/model-worker typecheck
corepack pnpm --filter @hv-pony-solver/model-worker test
corepack pnpm architecture:check
```
