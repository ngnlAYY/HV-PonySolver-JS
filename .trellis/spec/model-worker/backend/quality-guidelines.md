# Quality Guidelines

## TypeScript / Formatting

全仓 `tsconfig.base.json` 启用 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`isolatedModules`。Model Worker 使用 ES2022 + Cloudflare Worker types，不使用 UI framework。

ESLint 禁 explicit `any`、普通 TS `console`；未使用参数只允许 `_` prefix。Prettier 使用无分号、单引号、trailing comma、`printWidth: 120`。

## Test Architecture

- `apps/model-worker/vitest.config.ts` 使用 `@cloudflare/vitest-pool-workers`，通过真实 Worker `fetch` 入口测试，不以普通 Node mock server替代。
- `test/index.test.ts` 覆盖 HTTP/Bearer/CORS/KV/R2；`test/env.test.ts` 覆盖 normalization。
- `test/helpers/model-worker-fixture.ts` 提供内存 KV/R2 fixture，不含生产 Key/resource ID。
- Package `test` 还运行 Wrangler renderer/guard 与 deployment checker 的 node:test。
- Vitest 自动在隔离 `.wrangler/vitest/` 生成 test config；运行 package test 不要求手工生成生产 `wrangler.toml`。

Coverage thresholds：lines/functions/statements 100%，branches 90%。

## Required HTTP Regression Matrix

改变 route、access 或 response 时覆盖：

- Bearer-only；query key 不授权；64-hex 与 historical case lookup。
- `real` / `decoy` / `forbidden`，`INVALID_KEY_MODE=decoy|error`。
- `GET` / `HEAD` / `OPTIONS`、404/405/403/500。
- `Allow: GET, HEAD, OPTIONS`。
- 无 Origin、两个 allowlisted Origin、未知 Origin。
- `Vary: Origin` append/de-dup。
- 全路径 `Cache-Control: no-store` 与 `X-Content-Type-Options: nosniff`。
- R2 `httpEtag` 与 selected-object miss 不回退。
- Missing/invalid env 与 KV/R2 exception 的通用 500。

## Wrangler Render / Deploy Guard

`wrangler.template.toml` 是源。Production/deploy 必须拒绝：

- `test-kv` / `test-bucket` placeholders；
- unresolved `${...}`；
- 非法 KV namespace ID、bucket name、quote/backslash/control characters；
- duplicate assignments、错误 binding name 或错误 KV/R2 section；
- 不支持的 `INVALID_KEY_MODE`。

Vitest render 固定使用 test mode/isolated placeholders，不能被外层 deploy env污染。

使用 pnpm 10 部署必须写：

```bash
corepack pnpm --filter @hv-pony-solver/model-worker run deploy
```

不能省略 `run`。

## Post-Deploy Contract

`.github/workflows/deploy-cloudflare-model-worker.yml` 中：

- dry-run success 不等于已发布；只有 `publish_model_worker=true` 才执行 deploy。
- Checker 只在 deploy 条件满足后运行，不接收 Cloudflare credential/KV/R2 ID/模型 Key。
- 对两个允许 Origin 发送无 Authorization、无 body 的 OPTIONS/HEAD。
- OPTIONS 精确验证 204、Origin、methods、Authorization header、`no-store`、`Vary`；HEAD 按 mode验证 200/403 和 headers。
- 每请求默认 10 秒 timeout；默认 13 attempts、5 秒间隔，提供 60 秒有限 edge propagation window。
- Checker failure 使 job 失败，但部署可能已经发生；不自动回滚或第二次部署。
- 公开 checker 不证明真实 Key、KV entry、real R2 body 或 SHA-256 正确。

## Docs / Architecture Gates

- `docs:check` 从源码提取 Bearer、query denial、methods、CORS、`no-store` 与 R2 miss contract。
- `architecture:check` 防止 Model Worker/Userscript runtime import 越界和 Shared 反向依赖。
- HTTP契约变化必须同步 source、tests、README/ops 和 checker，而不是只改一层。

## Forbidden / Common Mistakes

- 恢复 `public, max-age=86400`，删除 OPTIONS，或把 405 Allow写回 `GET, HEAD`。
- 允许 query string Key、记录 Key、用真实 production resource 做 fixture。
- 通过编辑生成的 `wrangler.toml` 绕过 template/guard。
- 让 deploy/production 接受 test placeholders。
- 用 `continue-on-error` 放过 post-deploy contract。
- 把无 Key decoy HEAD 200 当成真实模型授权证据。
- Checker 失败后假定“没有部署”并自动回滚。
- 只通过 typecheck，不补 Cloudflare/Node behavior tests。

## Validation

```bash
corepack pnpm --filter @hv-pony-solver/model-worker typecheck
corepack pnpm --filter @hv-pony-solver/model-worker test
corepack pnpm --filter @hv-pony-solver/model-worker test:coverage
corepack pnpm --filter @hv-pony-solver/model-worker build
corepack pnpm docs:check
corepack pnpm architecture:check
```

最终运行 `corepack pnpm check`。

## Code Review Checklist

- [ ] Route/access/response 是否留在正确 module？
- [ ] HTTP status、CORS、`no-store`、`Vary`、`nosniff` 与 docs一致？
- [ ] Bearer/KV/R2/invalid-mode 和 selected miss branches 是否测试？
- [ ] Env/template/guard 是否同步，且无 test/production resource leak？
- [ ] 没有 Key/body/credential 写入 URL、log、fixture 或 task artifact？
- [ ] Deploy 与 post-deploy checker 条件一致，且失败不自动回滚？
- [ ] Package gate、docs/architecture 和完整 `pnpm check` 是否通过？
