# Hook Guidelines（不适用）

Shared package 没有 React/Vue hooks，也不执行 data fetching 或 lifecycle side effects。

- 新共享行为使用普通 pure function，不使用 `use*` 命名伪装 framework hook。
- 网络、GM storage、IndexedDB、KV 和 R2 都由 app 层拥有。
- Pure function 与 dependency direction 规则见 [`../backend/quality-guidelines.md`](../backend/quality-guidelines.md)。
