# Type Safety（不适用）

Model Worker 没有单独的 frontend type layer。Cloudflare `Env`、normalized env、KV/R2 interface 与 invalid-key mode 都定义在 backend：

- `apps/model-worker/src/worker-types.ts`
- `apps/model-worker/src/env.ts`
- `apps/model-worker/tsconfig.json`

请使用 [`../backend/quality-guidelines.md`](../backend/quality-guidelines.md) 中的 TypeScript 与 runtime validation 规则。不要创建 frontend props、hook state 或 UI event 类型。
