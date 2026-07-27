# Directory Structure（不适用）

Shared package 没有 frontend 目录。`packages/shared/src/` 只包含跨 workspace 的纯 TypeScript 契约，按 [`../backend/directory-structure.md`](../backend/directory-structure.md) 组织。

- `packages/shared/src/model.ts`：canonical model manifest。
- `packages/shared/src/token.ts`：token normalization 与 lookup keys。
- `packages/shared/src/index.ts`：公开 export surface。

不要创建 `components/`、`hooks/`、`styles/` 或 framework-specific frontend 目录。
