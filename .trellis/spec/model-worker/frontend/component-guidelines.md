# Component Guidelines（不适用）

Model Worker 不构建或渲染 UI 组件。HTTP response 由 `apps/model-worker/src/model-response.ts` 创建，属于 backend response contract，不是 frontend component。

- 不引入 React/Vue/Svelte 或 JSX。
- 不把 HTTP response helper 描述成“组件”。
- 用户可见设置与状态 UI 属于 `apps/userscript/src/status-panel/` 和 `apps/userscript/src/model/model-settings.ts`。

Model Worker 变更请读取 [`../backend/index.md`](../backend/index.md)。
