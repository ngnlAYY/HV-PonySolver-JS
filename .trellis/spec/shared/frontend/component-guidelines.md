# Component Guidelines（不适用）

Shared package 不包含 UI components、props、styles 或 accessibility behavior。它只导出 pure data/functions/types。

- Model UI 属于 `apps/userscript/src/model/model-settings.ts`。
- Status UI 属于 `apps/userscript/src/status-panel/`。
- Shared manifest 与 token contract 见 [`../backend/index.md`](../backend/index.md)。

禁止从 shared 导入 DOM API、JSX 或 UI framework，以免破坏跨 runtime 复用。
