# Hook Guidelines（不适用）

Model Worker 没有 React/Vue hooks。`apps/model-worker/src/index.ts` 的 `fetch` handler 与 `apps/model-worker/src/request-router.ts` 的请求路由是 backend 生命周期，不应改写为 `use*` hook。

- 不引入 React Query、SWR 或 frontend data-fetching abstraction。
- 共享请求逻辑使用普通函数和显式参数。
- HTTP、KV/R2 与部署规则见 [`../backend/index.md`](../backend/index.md)。
