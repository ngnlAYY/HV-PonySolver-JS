# State Management（不适用）

Model Worker 没有 frontend local/global state store。请求状态由每次 Fetch API调用携带；持久化读取来自 Cloudflare KV 与 R2。

真实边界：

- `apps/model-worker/src/model-access.ts` 只读取 KV 授权标记。
- `apps/model-worker/src/model-response.ts` 只读取选中的 R2 object。
- `apps/model-worker/src/env.ts` 在请求入口归一化 bindings 与 vars。

不要引入 Redux、Zustand 或 module-level mutable request state。KV/R2 规则见 [`../backend/database-guidelines.md`](../backend/database-guidelines.md)。
