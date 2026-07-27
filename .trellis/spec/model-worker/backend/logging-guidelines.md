# Logging Guidelines

## Runtime Reality

Model Worker runtime 当前没有 logging library、log levels 或 structured request logs。`src/**/*.ts` 保持安静；顶层 catch 把异常转成固定 500。全局 ESLint 对普通 TypeScript 启用 `no-console: error`。

不要把通用“每请求记录 debug/info/error”理想写进本项目，也不要直接散落 `console.*`。若未来增加 runtime logging，必须先定义脱敏 schema、采样、retention 和 ESLint 例外。

## Operations / CLI Output

Node 运维脚本可以输出窄范围、非秘密的结果：

- success：attempt、mode、Origin 数量、文件/预算等摘要；
- failure：method、Origin、status/header 差异、timeout/retry count；
- deployment evidence：run URL、head SHA、step status、deployment ID/时间、无 Key CF-Ray。

`apps/model-worker/scripts/check-deployment-contract.mjs` 只发送无 Key `OPTIONS`/`HEAD`，不读取 body；测试断言输出不含 `Authorization`/`Bearer`。

## Never Log

- 真实模型 Key、`Authorization` value、KV lookup key/value；
- Cloudflare credential、生产 namespace ID、bucket credential；
- R2 model body、用户数据、GM/IndexedDB content；
- 带 secret 的 URL/query；
- 能直接暴露 real/decoy selection 的自定义 response header。

非秘密 `deployment_check=<probe-id>` 只标识部署检查，不参与授权；probe ID 本身也不得包含 credential 或用户数据。

## Real Examples

- `eslint.config.js`：普通 TS `no-console: error`。
- `apps/model-worker/scripts/check-deployment-contract.mjs` 的 `runCli`：stdout 摘要与 stderr 错误。
- `apps/model-worker/scripts/check-deployment-contract.test.mjs`：验证 CLI 输出与无 Authorization 请求。
- `docs/model-worker-ops.md`：允许保存的部署证据和禁止项。

## Forbidden / Common Mistakes

- 逐请求记录 URL、headers、access decision、R2 key 或 KV lookup。
- 在 checker 中发送 Key、读取 body 或打印完整 response body。
- 把 dry-run log 当成实际 deployment evidence。
- 为 runtime 临时放宽 `no-console` 而没有单独设计 review。

## Validation

```bash
corepack pnpm lint
corepack pnpm --filter @hv-pony-solver/model-worker test
node --test apps/model-worker/scripts/check-deployment-contract.test.mjs
```
